// ═══════════════════════════════════════════════════════════════════════════
// Estado de ventas con FEFO. La venta descuenta stock real de lotes.
// ═══════════════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { Producto, Lote, CartItem, OutboxItem } from '../types';
import { useAuth } from './AuthContext';
import {
  buscarProductoPorCodigo, buscarProductosPorNombre, lotesDisponibles,
  stockTotal, aplicarVentaOnline, uuid,
} from '../lib/ventas-engine';
import {
  openDB, enqueueOutbox, flushOutbox, cacheCatalogo, idbGetAll,
  idbPut, OfflineVentaPayload, reintentarBloqueados, descontarLotesLocales, esErrorPermanente,
} from '../lib/outbox';
import { supabase } from '../lib/supabase';
import { useStore } from '../../context/StoreContext';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

async function hapticOk()  { try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch { /* no-op */ } }
async function hapticTap() { try { await Haptics.impact({ style: ImpactStyle.Light });  } catch { /* no-op */ } }

export const formatMoney = (n: number) => {
  const v = Number(n);
  const d = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2; // "$1.000" se lee mejor que "$1.000,00"
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: 2 });
};

interface VentasState {
  cart: CartItem[];
  outboxLen: number;
  bloqueados: number; // ventas que el servidor rechazó (cuarentena): no se mandan solas
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
  | { type: 'SET_LOADING'; payload: boolean };

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
  confirmarVenta: (opts: { metodoPago: string; cliente: string; fiado: boolean; descuento: number; usuario?: string | null }) =>
    Promise<{ ok: boolean; msg: string; ventaId?: string }>;
  sincronizar: () => Promise<void>;
}

const Ctx = createContext<VentasCtx | undefined>(undefined);

const init: VentasState = { cart: [], outboxLen: 0, bloqueados: 0, isOnline: navigator.onLine, loading: true };

export const VentasProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { comercio, sucursalActiva, miembro } = useAuth();
  const [state, dispatch] = useReducer(reducer, init);
  const lotesCacheRef = useRef<Record<string, Lote[]>>({});
  const cartRef = useRef(state.cart);
  cartRef.current = state.cart;
  // Tras una venta que llegó al servidor, Mercadería baja el stock nuevo.
  const { sincronizarAhora } = useStore();

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
    const n = await flushOutbox();
    const out = await idbGetAll<OutboxItem>('outbox');
    dispatch({ type: 'SET_OUTBOX', payload: out.length });
    dispatch({ type: 'SET_BLOQUEADOS', payload: out.filter(i => i.bloqueado).length });
    if (n > 0) { lotesCacheRef.current = {}; sincronizarAhora(); }
  }, [sincronizarAhora]);

  useEffect(() => {
    (async () => {
      await openDB();
      const out = await idbGetAll<OutboxItem>('outbox');
      dispatch({ type: 'SET_OUTBOX', payload: out.length });
      dispatch({ type: 'SET_BLOQUEADOS', payload: out.filter(i => i.bloqueado).length });
      dispatch({ type: 'SET_LOADING', payload: false });
      if (navigator.onLine) doFlush();
    })();
    const onOnline  = () => { dispatch({ type: 'SET_ONLINE', payload: true }); doFlush(); };
    const onOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Reintento cada 30 s: con señal floja el aviso "online" no llega nunca y las ventas
    // guardadas quedaban en el celular (la caja no cerraba).
    const t = setInterval(() => { if (navigator.onLine) doFlush(); }, 30_000);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [doFlush]);

  // Baja catálogo + lotes de la sucursal (las dos consultas a la vez) para vender offline.
  const refrescarCatalogo = useCallback(async () => {
    if (!comercio || !sucursalActiva) return;
    const [{ data: productos }, { data: lotes }] = await Promise.all([
      supabase.from('productos').select('*').eq('comercio_id', comercio.id).eq('activo', true),
      supabase.from('lotes').select('*').eq('comercio_id', comercio.id)
        .eq('sucursal_id', sucursalActiva.id).eq('retirado', false).gt('cantidad', 0),
    ]);
    if (productos && lotes) await cacheCatalogo(productos, lotes);
  }, [comercio, sucursalActiva]);

  // Precarga al entrar o cambiar de sucursal (limpia el cache FEFO). Espera 2 s para no
  // competir con el arranque de la app (primera pantalla y sync de Stockly).
  useEffect(() => {
    lotesCacheRef.current = {};
    if (!navigator.onLine) return;
    const t = setTimeout(refrescarCatalogo, 2000);
    return () => clearTimeout(t);
  }, [refrescarCatalogo]);

  // Realtime: si Stockly cambia el stock (lotes), refrescar el cache local.
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
          lotesCacheRef.current = {};
          clearTimeout(t);
          t = setTimeout(refrescarCatalogo, 1500);
        }
      )
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(canal); };
  }, [comercio, sucursalActiva, refrescarCatalogo]);

  // ── Catálogo: primero lo guardado en el celular (al instante), después el servidor ──
  const agregarProducto = useCallback(async (prod: Producto) => {
    if (!comercio || !sucursalActiva) return { ok: false, msg: 'Elegí el local en Ajustes para poder vender' };
    let lotes = lotesCacheRef.current[prod.id];
    if (!lotes) {
      lotes = (await idbGetAll<Lote>('lotes')).filter(l => l.producto_id === prod.id && !l.retirado && l.cantidad > 0)
        .sort((a, b) => (a.fecha_vencimiento ?? '9999').localeCompare(b.fecha_vencimiento ?? '9999'));
      // Sin nada guardado (mercadería recién cargada): se pregunta al servidor, sin trabar si no contesta.
      if (lotes.length === 0 && navigator.onLine) {
        lotes = await lotesDisponibles(comercio.id, prod.id, sucursalActiva.id).catch(() => []);
      }
      lotesCacheRef.current[prod.id] = lotes;
    }
    const disp = stockTotal(lotes);
    dispatch({
      type: 'ADD_ITEM',
      payload: { productoId: prod.id, nombre: prod.nombre, codigoBarras: prod.codigo_barras, precio: prod.precio, qty: 1, stockDisponible: disp },
    });
    hapticTap();
    const aviso = disp <= 0 ? ` (sin stock registrado)` : '';
    return { ok: true, msg: `${prod.nombre} agregado${aviso}` };
  }, [comercio, sucursalActiva]);

  const escanear = useCallback(async (codigo: string) => {
    if (!comercio) return { ok: false, msg: 'Sin comercio activo' };
    let prod: Producto | null = (await idbGetAll<Producto>('productos')).find(p => p.codigo_barras === codigo) ?? null;
    if (!prod && navigator.onLine) prod = await buscarProductoPorCodigo(comercio.id, codigo).catch(() => null);
    if (!prod) return { ok: false, msg: `No encontré ese código (${codigo}). Buscalo por nombre o cargalo en Mercadería.` };
    return agregarProducto(prod);
  }, [comercio, agregarProducto]);

  const buscarPorNombre = useCallback(async (q: string) => {
    if (!comercio || q.length < 2) return [];
    const t = q.toLowerCase();
    const locales = (await idbGetAll<Producto>('productos')).filter(p => p.nombre.toLowerCase().includes(t)).slice(0, 8);
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
  const confirmarVenta = useCallback(async (opts: { metodoPago: string; cliente: string; fiado: boolean; descuento: number; usuario?: string | null }) => {
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
        metodoPago: opts.metodoPago, cliente: opts.cliente, fiado: opts.fiado,
        descuento: opts.descuento, total, fecha: Date.now(), cart,
      };
      await enqueueOutbox('venta', payload);
      // Reflejar lo vendido en el stock local (si no, se sigue mostrando el de antes).
      for (const l of descontarLotesLocales(await idbGetAll<Lote>('lotes'), cart)) await idbPut('lotes', l);
      lotesCacheRef.current = {};
      const out = await idbGetAll('outbox');
      dispatch({ type: 'SET_OUTBOX', payload: out.length });
      vaciar(); hapticOk();
      return { ok: true, msg: 'Venta guardada. Se manda sola cuando haya internet.', ventaId };
    };

    if (!navigator.onLine) return saveOffline();
    try {
      // FEFO + descuento de stock se resuelven atómicamente en el servidor (RPC).
      const res = await aplicarVentaOnline({
        comercioId: comercio.id, sucursalId: sucursalActiva.id, usuario,
        metodoPago: opts.metodoPago, cliente: opts.cliente, fiado: opts.fiado,
        descuento: opts.descuento, cart, ventaId,
      });
      vaciar(); hapticOk(); lotesCacheRef.current = {}; sincronizarAhora();
      const aviso = res.faltantes.length > 0
        ? ` (faltó stock de: ${res.faltantes.map(f => f.nombre).join(', ')})`
        : '';
      return { ok: true, msg: 'Venta registrada' + aviso, ventaId: res.ventaId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // El servidor la RECHAZÓ (precio mal, producto borrado): guardarla para después solo la mandaba
      // a cuarentena y la pantalla decía "guardada". Se avisa y el carrito queda para corregir.
      if (esErrorPermanente(msg)) return { ok: false, msg: `La venta no se guardó: ${msg}` };
      return saveOffline(); // sin señal o se cortó: se guarda y se manda después con el mismo id
    }
  }, [comercio, sucursalActiva, miembro, vaciar, sincronizarAhora]);

  // El sync manual saca de cuarentena los items bloqueados y reintenta.
  const sincronizar = useCallback(async () => { await reintentarBloqueados(); await doFlush(); }, [doFlush]);

  const valor = useMemo(() => ({
    state, escanear, buscarPorNombre, agregarProducto, agregarMontoLibre, setQty, quitar, vaciar, confirmarVenta, sincronizar,
  }), [state, escanear, buscarPorNombre, agregarProducto, agregarMontoLibre, setQty, quitar, vaciar, confirmarVenta, sincronizar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
};

export const useVentas = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVentas must be inside VentasProvider');
  return ctx;
};
