// ═══════════════════════════════════════════════════════════════════════════
// Estado de ventas con FEFO. La venta descuenta stock real de lotes.
// ═══════════════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { formatearPlata } from '../../lib/numeros';
import { Producto, CartItem, OutboxItem } from '../types';
import { useAuth } from './AuthContext';
import {
  buscarProductoPorCodigo, buscarProductosPorNombre, aplicarVentaOnline, uuid,
} from '../lib/ventas-engine';
import {
  openDB, enqueueOutbox, flushOutbox, idbGetAll, OfflineVentaPayload, reintentarBloqueados, esErrorPermanente,
  AvisoDevolver, leerAvisosDevolver, quitarAvisoDevolver,
} from '../lib/outbox';
import { supabase } from '../lib/supabase';
import { useStore } from '../../context/StoreContext';
import { getAll as stockGetAll, ItemOutbox } from '../../lib/localDb';

/** Productos cargados en Mercadería (o con mercadería cargada) que todavía no llegaron al servidor: una venta de ellos
 *  tiene que esperarlos. Si no, el servidor la rechazaba ("no pertenece") o salía como "vendido sin stock" a nombre del
 *  cajero, aunque la mercadería estaba. */
async function productosSinSubir(): Promise<Set<string>> {
  try {
    const altas = (await stockGetAll<ItemOutbox>('outbox')).filter(i => i.operacion === 'insert');
    return new Set([
      ...altas.filter(i => i.tabla === 'productos').map(i => i.registroId),
      ...altas.filter(i => i.tabla === 'lotes').map(i => i.payload?.productoId as string),
    ]);
  } catch { return new Set(); }
}
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import * as Sentry from '@sentry/react';

async function hapticOk()  { try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch { /* no-op */ } }
async function hapticTap() { try { await Haptics.impact({ style: ImpactStyle.Light });  } catch { /* no-op */ } }

export const formatMoney = formatearPlata;

interface VentasState {
  cart: CartItem[];
  outboxLen: number;
  bloqueados: number; // ventas que el servidor rechazó (cuarentena): no se mandan solas
  avisos: AvisoDevolver[]; // plata para devolverle a un cliente (cobros que resultaron estar pagados)
  isOnline: boolean;
  loading: boolean;
}

type Action =
  | { type: 'ADD_ITEM'; payload: CartItem }
  | { type: 'SET_QTY'; productoId: string; qty: number }
  | { type: 'QUITAR'; productoId: string }
  | { type: 'SET_CART'; payload: CartItem[] }
  | { type: 'SET_OUTBOX'; payload: number }
  | { type: 'SET_BLOQUEADOS'; payload: number }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_AVISOS'; payload: AvisoDevolver[] }
  | { type: 'RESTAR_VENDIDO'; vendido: CartItem[] };

// El carrito cambia SOLO en el reducer, sobre el estado más nuevo: antes cada función armaba
// el carrito con una copia vieja y dos escaneos rápidos con señal lenta se pisaban.
export function reducer(s: VentasState, a: Action): VentasState {
  switch (a.type) {
    case 'ADD_ITEM': {
      const ex = s.cart.some(c => c.productoId === a.payload.productoId);
      return {
        ...s,
        cart: ex
          ? s.cart.map(c => c.productoId === a.payload.productoId ? { ...c, qty: c.qty + a.payload.qty } : c)
          : [...s.cart, a.payload],
      };
    }
    case 'SET_QTY':
      return { ...s, cart: s.cart.map(c => c.productoId === a.productoId ? { ...c, qty: a.qty } : c).filter(c => c.qty > 0) };
    case 'QUITAR':   return { ...s, cart: s.cart.filter(c => c.productoId !== a.productoId) };
    case 'SET_CART': return { ...s, cart: a.payload };
    case 'SET_OUTBOX': return a.payload === s.outboxLen ? s : { ...s, outboxLen: a.payload };
    case 'SET_BLOQUEADOS': return a.payload === s.bloqueados ? s : { ...s, bloqueados: a.payload };
    case 'SET_ONLINE': return { ...s, isOnline: a.payload };
    case 'SET_LOADING': return { ...s, loading: a.payload };
    case 'SET_AVISOS': return { ...s, avisos: a.payload };
    // Solo lo que se vendió: lo escaneado mientras se guardaba la venta (con señal floja, hasta 8 s) es del cliente
    // siguiente, y antes se borraba del carrito sin cobrarse.
    case 'RESTAR_VENDIDO': {
      const vendido = new Map(a.vendido.map(c => [c.productoId, c.qty]));
      return { ...s, cart: s.cart.map(c => ({ ...c, qty: c.qty - (vendido.get(c.productoId) ?? 0) })).filter(c => c.qty > 0) };
    }
    default: return s;
  }
}

// El carrito se guarda en el celular: si Android cierra la app mientras se cobra por Mercado Pago
// o se mira WhatsApp, al volver sigue ahí.
const CLAVE_CARRITO = 'ventas:carrito';
function carritoGuardado(comercioId: string | undefined): CartItem[] {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_CARRITO) ?? 'null');
    return g?.comercioId === comercioId && Array.isArray(g.cart) ? g.cart : [];
  } catch { return []; }
}

interface VentasCtx {
  state: VentasState;
  escanear:        (codigo: string) => Promise<{ ok: boolean; msg: string }>;
  buscarPorNombre: (q: string) => Promise<Producto[]>;
  agregarProducto: (p: Producto) => Promise<{ ok: boolean; msg: string }>;
  agregarMontoLibre: (monto: number, nombre?: string) => { ok: boolean; msg: string };
  setQty:    (productoId: string, qty: number) => void;
  quitar:    (productoId: string) => void;
  vaciar:    () => void;
  confirmarVenta: (opts: { metodoPago: string; cliente: string; descuento: number; usuario?: string | null }) =>
    Promise<{ ok: boolean; msg: string; ventaId?: string }>;
  sincronizar: () => Promise<void>;
  marcarDevuelto: (id: string) => Promise<void>;
}

const Ctx = createContext<VentasCtx | undefined>(undefined);

const init: VentasState = { cart: [], outboxLen: 0, bloqueados: 0, avisos: [], isOnline: navigator.onLine, loading: true };

export const VentasProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { comercio, sucursalActiva, miembro } = useAuth();
  const [state, dispatch] = useReducer(reducer, init);
  const cartRef = useRef(state.cart);
  cartRef.current = state.cart;
  // Tras una venta que llegó al servidor, Mercadería baja el stock nuevo.
  const { state: stock, sincronizarAhora, productosConLotes } = useStore();
  // Todo sale de la memoria de Stockly, que ya descuenta lo vendido sin subir: antes cada producto escaneado leía todos
  // los lotes del equipo y cada venta reescribía un catálogo entero aparte.
  const productosRef = useRef(productosConLotes);
  productosRef.current = productosConLotes;

  // Carrito guardado: se recupera al entrar al comercio y se guarda en cada cambio.
  const carritoListo = useRef(false);
  useEffect(() => {
    carritoListo.current = false;
    if (!comercio) return;
    const g = carritoGuardado(comercio.id);
    if (g.length > 0) dispatch({ type: 'SET_CART', payload: g });
    carritoListo.current = true;
  }, [comercio]);
  useEffect(() => {
    if (!carritoListo.current || !comercio) return;
    try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify({ comercioId: comercio.id, cart: state.cart })); } catch { /* sin espacio: sigue en memoria */ }
  }, [state.cart, comercio]);

  const doFlush = useCallback(async () => {
    if ((await productosSinSubir()).size > 0) await sincronizarAhora(); // primero que suban los productos y lotes nuevos
    const n = await flushOutbox(await productosSinSubir());
    const out = await idbGetAll<OutboxItem>('outbox');
    dispatch({ type: 'SET_OUTBOX', payload: out.length });
    dispatch({ type: 'SET_BLOQUEADOS', payload: out.filter(i => i.bloqueado).length });
    if (n > 0) {
      dispatch({ type: 'SET_AVISOS', payload: await leerAvisosDevolver() });
      sincronizarAhora();
    }
  }, [sincronizarAhora]);

  useEffect(() => {
    (async () => {
      await openDB();
      const out = await idbGetAll<OutboxItem>('outbox');
      dispatch({ type: 'SET_OUTBOX', payload: out.length });
      dispatch({ type: 'SET_BLOQUEADOS', payload: out.filter(i => i.bloqueado).length });
      dispatch({ type: 'SET_AVISOS', payload: await leerAvisosDevolver() });
      dispatch({ type: 'SET_LOADING', payload: false });
      if (navigator.onLine) doFlush();
    })();
    const onOnline  = () => { dispatch({ type: 'SET_ONLINE', payload: true }); doFlush(); };
    const onOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Reintento cada 30 s: con señal floja el aviso "online" no llega nunca y las ventas
    // guardadas quedaban en el celular (la caja no cerraba).
    const t = setInterval(() => { if (navigator.onLine && !document.hidden) doFlush(); }, 30_000);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [doFlush]);

  // Realtime: si otro equipo cambia el stock, Stockly baja solo lo nuevo (y eso actualiza el catálogo).
  // No bloquea nada; si Realtime no está activado, simplemente no llega nada.
  useEffect(() => {
    if (!comercio || !sucursalActiva) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const canal = supabase
      .channel(`lotes-${sucursalActiva.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'lotes', filter: `sucursal_id=eq.${sucursalActiva.id}` },
        () => {
          // Una venta toca varios lotes y llega un aviso por cada uno: se refresca una sola vez.
          clearTimeout(t);
          t = setTimeout(() => { sincronizarAhora(); }, 1500);
        }
      )
      // Precios y productos nuevos de otro equipo también: antes se veían recién en el ciclo de 30 s.
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'productos', filter: `comercio_id=eq.${comercio.id}` },
        () => { clearTimeout(t); t = setTimeout(() => { sincronizarAhora(); }, 1500); }
      )
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(canal); };
  }, [comercio, sucursalActiva, sincronizarAhora]);

  // El catálogo ya está en memoria (Stockly): antes cada tecla del buscador leía todos los productos del equipo.
  const catalogoRef = useRef(stock.productos);
  catalogoRef.current = stock.productos;
  const aProductoVenta = (p: (typeof stock.productos)[number], comercioId: string): Producto =>
    ({ id: p.id!, comercio_id: comercioId, nombre: p.nombre, codigo_barras: p.codigoBarras ?? '', categoria: p.categoria, precio: p.precio, activo: true }) as Producto;

  // ── Catálogo: todo de la memoria de Stockly ──
  const agregarProducto = useCallback(async (prod: Producto) => {
    if (!comercio || !sucursalActiva) return { ok: false, msg: 'Elegí el local en Ajustes para poder vender' };
    const enStock = productosRef.current().find(p => p.producto.id === prod.id);
    // Precio y nombre de ahora: "Más vendidos" guarda una copia que puede tener días, y cobraba el precio viejo.
    const precio = enStock?.producto.precio ?? prod.precio;
    const nombre = enStock?.producto.nombre ?? prod.nombre;
    const disp = Math.max(0, enStock?.cantidadTotal ?? 0);
    dispatch({
      type: 'ADD_ITEM',
      payload: { productoId: prod.id, nombre, codigoBarras: prod.codigo_barras, precio, qty: 1, stockDisponible: disp, costo: enStock?.producto.costo },
    });
    hapticTap();
    const aviso = disp <= 0 ? ` (sin stock registrado)` : '';
    return { ok: true, msg: `${nombre} agregado${aviso}` };
  }, [comercio, sucursalActiva]);

  const escanear = useCallback(async (codigo: string) => {
    if (!comercio) return { ok: false, msg: 'Sin comercio activo' };
    const enMemoria = catalogoRef.current.find(p => p.codigoBarras === codigo);
    let prod: Producto | null = enMemoria ? aProductoVenta(enMemoria, comercio.id) : null;
    if (!prod && navigator.onLine) prod = await buscarProductoPorCodigo(comercio.id, codigo).catch(() => null);
    if (!prod) return { ok: false, msg: `No encontré ese código (${codigo}). Buscalo por nombre o cargalo en Mercadería.` };
    return agregarProducto(prod);
  }, [comercio, agregarProducto]);

  const buscarPorNombre = useCallback(async (q: string) => {
    if (!comercio || q.length < 2) return [];
    const t = q.toLowerCase();
    const locales = catalogoRef.current.filter(p => p.nombre.toLowerCase().includes(t)).slice(0, 8).map(p => aProductoVenta(p, comercio.id));
    if (locales.length > 0 || !navigator.onLine) return locales;
    return buscarProductosPorNombre(comercio.id, q).catch(() => []);
  }, [comercio]);

  // ── Carrito ───────────────────────────────────────────────────────────────
  const setQty = useCallback((productoId: string, qty: number) => {
    dispatch({ type: 'SET_QTY', productoId, qty: Math.max(0, qty) });
  }, []);

  const quitar = useCallback((productoId: string) => { dispatch({ type: 'QUITAR', productoId }); }, []);

  // Venta rápida: agrega una línea de monto libre (sin producto ni stock).
  const agregarMontoLibre = useCallback((monto: number, nombre = 'Venta rápida') => {
    if (!(monto > 0)) return { ok: false, msg: 'Poné un monto mayor que 0' };
    dispatch({
      type: 'ADD_ITEM',
      payload: { productoId: `libre-${uuid()}`, nombre, codigoBarras: '', precio: Math.round(monto * 100) / 100, qty: 1, stockDisponible: 1 },
    });
    hapticTap();
    return { ok: true, msg: `${nombre} agregado` };
  }, []);

  const vaciar = useCallback(() => { dispatch({ type: 'SET_CART', payload: [] }); }, []);

  // ── Confirmar venta (FEFO) ───────────────────────────────────────────────────
  const confirmarVenta = useCallback(async (opts: { metodoPago: string; cliente: string; descuento: number; usuario?: string | null }) => {
    if (!comercio || !sucursalActiva) return { ok: false, msg: 'Elegí el local en Ajustes para poder vender' };
    const cart = cartRef.current;
    if (cart.length === 0) return { ok: false, msg: 'El carrito está vacío' };

    // Atribución: el cajero del turno (si hay), si no la cuenta del comercio.
    const usuario  = opts.usuario ?? miembro?.nombre ?? null;
    const subtotal = cart.reduce((s, c) => s + c.precio * c.qty, 0);
    const total    = Math.max(0, subtotal - opts.descuento);
    // Un único ventaId para online y offline: si el online llega al server pero se
    // pierde la respuesta, el reintento offline usa el MISMO id y registrar_venta lo
    // detecta como duplicado (no vuelve a vender ni descontar). Cierra el bug F-A.
    const ventaId  = uuid();

    const saveOffline = async () => {
      const payload: OfflineVentaPayload = {
        ventaId, comercioId: comercio.id, sucursalId: sucursalActiva.id, usuario,
        metodoPago: opts.metodoPago, cliente: opts.cliente, fiado: false,
        descuento: opts.descuento, total, fecha: Date.now(), cart,
      };
      await enqueueOutbox('venta', payload);
      const out = await idbGetAll('outbox');
      dispatch({ type: 'SET_OUTBOX', payload: out.length });
      dispatch({ type: 'RESTAR_VENDIDO', vendido: cart }); hapticOk();
      return { ok: true, msg: 'Venta guardada. Se manda sola cuando haya internet.', ventaId };
    };

    // Sin internet, o con un producto que todavía no subió: se guarda y sale cuando el producto esté arriba.
    const sinSubir = await productosSinSubir();
    if (!navigator.onLine || cart.some(c => sinSubir.has(c.productoId))) return saveOffline();
    try {
      // FEFO + descuento de stock se resuelven atómicamente en el servidor (RPC).
      // Con señal floja no se espera con el cliente adelante: a los 4 s (con 4G lento tarda 1,3 s) se guarda en el
      // celular con el MISMO id (si el servidor la había recibido, el reintento sale duplicado y no descuenta dos veces).
      const res = await Promise.race([
        aplicarVentaOnline({
          comercioId: comercio.id, sucursalId: sucursalActiva.id, usuario,
          metodoPago: opts.metodoPago, cliente: opts.cliente, fiado: false,
          descuento: opts.descuento, cart, ventaId,
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('sin respuesta del servidor')), 4000)),
      ]);
      dispatch({ type: 'RESTAR_VENDIDO', vendido: cart }); hapticOk(); sincronizarAhora();
      const aviso = res.faltantes.length > 0
        ? ` (faltó stock de: ${res.faltantes.map(f => f.nombre).join(', ')})`
        : '';
      return { ok: true, msg: 'Venta registrada' + aviso, ventaId: res.ventaId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // El servidor la RECHAZÓ (precio mal, producto borrado): guardarla para después solo la mandaba
      // a cuarentena y la pantalla decía "guardada". Se avisa y el carrito queda para corregir.
      if (esErrorPermanente(msg)) {
        Sentry.captureMessage(`Venta rechazada: ${msg}`);
        return { ok: false, msg: 'La venta no se guardó: el sistema la rechazó. Revisá los precios del carrito y probá de nuevo. Si sigue, avisale al dueño.' };
      }
      return saveOffline(); // sin señal o se cortó: se guarda y se manda después con el mismo id
    }
  }, [comercio, sucursalActiva, miembro, sincronizarAhora]);

  // El sync manual saca de cuarentena los items bloqueados y reintenta.
  const sincronizar = useCallback(async () => { await reintentarBloqueados(); await doFlush(); }, [doFlush]);

  const marcarDevuelto = useCallback(async (id: string) => {
    await quitarAvisoDevolver(id);
    dispatch({ type: 'SET_AVISOS', payload: await leerAvisosDevolver() });
  }, []);

  const valor = useMemo(() => ({
    state, escanear, buscarPorNombre, agregarProducto, agregarMontoLibre, setQty, quitar, vaciar, confirmarVenta, sincronizar, marcarDevuelto,
  }), [state, escanear, buscarPorNombre, agregarProducto, agregarMontoLibre, setQty, quitar, vaciar, confirmarVenta, sincronizar, marcarDevuelto]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
};

export const useVentas = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVentas must be inside VentasProvider');
  return ctx;
};
