// ═══════════════════════════════════════════════════════════════════════════
// Estado de ventas con FEFO. La venta descuenta stock real de lotes.
// ═══════════════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import { Producto, Lote, CartItem, Venta } from '../types';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import {
  buscarProductoPorCodigo, buscarProductosPorNombre, lotesDisponibles,
  stockTotal, aplicarVentaOnline, uuid,
} from '../lib/ventas-engine';
import {
  openDB, enqueueOutbox, flushOutbox, cacheCatalogo, idbGetAll,
  idbPut, OfflineVentaPayload, reintentarBloqueados, ventasLocalesDeHoy, descontarLotesLocales,
} from '../lib/outbox';
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
  ventasHoy: Venta[];
  outboxLen: number;
  isOnline: boolean;
  loading: boolean;
}

type Action =
  | { type: 'SET_CART'; payload: CartItem[] }
  | { type: 'SET_VENTAS_HOY'; payload: Venta[] }
  | { type: 'SET_OUTBOX'; payload: number }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean };

const init: VentasState = { cart: [], ventasHoy: [], outboxLen: 0, isOnline: navigator.onLine, loading: true };

function reducer(s: VentasState, a: Action): VentasState {
  switch (a.type) {
    case 'SET_CART':       return { ...s, cart: a.payload };
    case 'SET_VENTAS_HOY': return { ...s, ventasHoy: a.payload };
    case 'SET_OUTBOX':     return { ...s, outboxLen: a.payload };
    case 'SET_ONLINE':     return { ...s, isOnline: a.payload };
    case 'SET_LOADING':    return { ...s, loading: a.payload };
    default: return s;
  }
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

export const VentasProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, init);
  const { comercio, sucursalActiva, miembro } = useAuth();
  const lotesCacheRef = React.useRef<Record<string, Lote[]>>({});
  // Tras una venta que llegó al servidor, Mercadería baja el stock nuevo.
  const { sincronizarAhora } = useStore();

  const loadVentasHoy = useCallback(async () => {
    if (!comercio || !navigator.onLine) {
      const locales = await idbGetAll<Venta & { id: string; fecha: number }>('ventas');
      dispatch({ type: 'SET_VENTAS_HOY', payload: ventasLocalesDeHoy(locales) as unknown as Venta[] });
      return;
    }
    const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('ventas_ventas').select('*')
      .eq('comercio_id', comercio.id).gte('fecha', inicioHoy.toISOString())
      .order('fecha', { ascending: false });
    dispatch({ type: 'SET_VENTAS_HOY', payload: (data ?? []) as unknown as Venta[] });
  }, [comercio]);

  const doFlush = useCallback(async () => {
    const n = await flushOutbox();
    const out = await idbGetAll('outbox');
    dispatch({ type: 'SET_OUTBOX', payload: out.length });
    if (n > 0) { loadVentasHoy(); lotesCacheRef.current = {}; sincronizarAhora(); }
  }, [loadVentasHoy, sincronizarAhora]);

  useEffect(() => {
    (async () => {
      await openDB();
      const out = await idbGetAll('outbox');
      dispatch({ type: 'SET_OUTBOX', payload: out.length });
      dispatch({ type: 'SET_LOADING', payload: false });
      if (navigator.onLine) doFlush();
    })();
    const onOnline  = () => { dispatch({ type: 'SET_ONLINE', payload: true }); doFlush(); };
    const onOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [doFlush]);

  useEffect(() => { if (comercio) loadVentasHoy(); }, [comercio, loadVentasHoy]);

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

  // ── Catálogo ───────────────────────────────────────────────────────────────
  const escanear = useCallback(async (codigo: string) => {
    if (!comercio) return { ok: false, msg: 'Sin comercio activo' };
    const prod = navigator.onLine
      ? await buscarProductoPorCodigo(comercio.id, codigo)
      : (await idbGetAll<Producto>('productos')).find(p => p.codigo_barras === codigo) ?? null;
    if (!prod) return { ok: false, msg: `Código no encontrado: ${codigo}` };
    return agregarProducto(prod);
  }, [comercio, sucursalActiva, state.cart]);

  const buscarPorNombre = useCallback(async (q: string) => {
    if (!comercio || q.length < 2) return [];
    if (navigator.onLine) return buscarProductosPorNombre(comercio.id, q);
    const todos = await idbGetAll<Producto>('productos');
    return todos.filter(p => p.nombre.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  }, [comercio]);

  const agregarProducto = useCallback(async (prod: Producto) => {
    if (!comercio || !sucursalActiva) return { ok: false, msg: 'Sin sucursal activa' };
    // cargar lotes (FEFO) y cachear
    let lotes = lotesCacheRef.current[prod.id];
    if (!lotes) {
      lotes = navigator.onLine
        ? await lotesDisponibles(comercio.id, prod.id, sucursalActiva.id)
        : (await idbGetAll<Lote>('lotes')).filter(l => l.producto_id === prod.id && !l.retirado && l.cantidad > 0)
            .sort((a, b) => (a.fecha_vencimiento ?? '9999').localeCompare(b.fecha_vencimiento ?? '9999'));
      lotesCacheRef.current[prod.id] = lotes;
    }
    const disp = stockTotal(lotes);

    const cart = [...state.cart];
    const ex = cart.find(c => c.productoId === prod.id);
    if (ex) {
      ex.qty++;
    } else {
      cart.push({
        productoId: prod.id, nombre: prod.nombre, codigoBarras: prod.codigo_barras,
        precio: prod.precio, qty: 1, stockDisponible: disp,
      });
    }
    dispatch({ type: 'SET_CART', payload: cart });
    hapticTap();
    const aviso = disp <= 0 ? ` (sin stock registrado)` : '';
    return { ok: true, msg: `${prod.nombre} agregado${aviso}` };
  }, [comercio, sucursalActiva, state.cart]);

  // ── Carrito ───────────────────────────────────────────────────────────────
  const setQty = useCallback((productoId: string, qty: number) => {
    const cart = state.cart
      .map(c => c.productoId === productoId ? { ...c, qty: Math.max(0, qty) } : c)
      .filter(c => c.qty > 0);
    dispatch({ type: 'SET_CART', payload: cart });
  }, [state.cart]);

  const quitar = useCallback((productoId: string) => {
    dispatch({ type: 'SET_CART', payload: state.cart.filter(c => c.productoId !== productoId) });
  }, [state.cart]);

  // Venta rápida: agrega una línea de monto libre (sin producto ni stock).
  const agregarMontoLibre = useCallback((monto: number, nombre = 'Venta rápida') => {
    if (!(monto > 0)) return { ok: false, msg: 'Monto inválido' };
    const item: CartItem = {
      productoId: `libre-${Date.now()}`, nombre, codigoBarras: '',
      precio: Math.round(monto * 100) / 100, qty: 1, stockDisponible: 1,
    };
    dispatch({ type: 'SET_CART', payload: [...state.cart, item] });
    hapticTap();
    return { ok: true, msg: `${nombre} agregado` };
  }, [state.cart]);

  const vaciar = useCallback(() => { dispatch({ type: 'SET_CART', payload: [] }); }, []);

  // ── Confirmar venta (FEFO) ───────────────────────────────────────────────────
  const confirmarVenta = useCallback(async (opts: { metodoPago: string; cliente: string; fiado: boolean; descuento: number; usuario?: string | null }) => {
    if (!comercio || !sucursalActiva) return { ok: false, msg: 'Sin sucursal activa' };
    if (state.cart.length === 0) return { ok: false, msg: 'Carrito vacío' };

    // Atribución: el cajero del turno (si hay), si no la cuenta del comercio.
    const usuario  = opts.usuario ?? miembro?.nombre ?? null;
    const subtotal = state.cart.reduce((s, c) => s + c.precio * c.qty, 0);
    const total    = Math.max(0, subtotal - opts.descuento);
    // Un único ventaId para online y offline: si el online llega al server pero se
    // pierde la respuesta, el reintento offline usa el MISMO id y registrar_venta lo
    // detecta como duplicado (no vuelve a vender ni descontar). Cierra el bug F-A.
    const ventaId  = uuid();

    if (navigator.onLine) {
      try {
        // FEFO + descuento de stock se resuelven atómicamente en el servidor (RPC).
        const res = await aplicarVentaOnline({
          comercioId: comercio.id, sucursalId: sucursalActiva.id, usuario,
          metodoPago: opts.metodoPago, cliente: opts.cliente, fiado: opts.fiado,
          descuento: opts.descuento, cart: state.cart, ventaId,
        });
        vaciar(); hapticOk(); loadVentasHoy(); lotesCacheRef.current = {}; sincronizarAhora();
        const aviso = res.faltantes.length > 0
          ? ` (faltó stock de: ${res.faltantes.map(f => f.nombre).join(', ')})`
          : '';
        return { ok: true, msg: 'Venta registrada' + aviso, ventaId: res.ventaId };
      } catch {
        return saveOffline();
      }
    }
    return saveOffline();

    async function saveOffline() {
      const payload: OfflineVentaPayload = {
        ventaId, comercioId: comercio!.id, sucursalId: sucursalActiva!.id, usuario,
        metodoPago: opts.metodoPago, cliente: opts.cliente, fiado: opts.fiado,
        descuento: opts.descuento, total, fecha: Date.now(), cart: state.cart,
      };
      await idbPut('ventas', { id: ventaId, ...payload });
      await enqueueOutbox('venta', payload);
      // Reflejar lo vendido en el stock local (si no, se sigue mostrando el de antes).
      for (const l of descontarLotesLocales(await idbGetAll<Lote>('lotes'), state.cart)) await idbPut('lotes', l);
      lotesCacheRef.current = {};
      const out = await idbGetAll('outbox');
      dispatch({ type: 'SET_OUTBOX', payload: out.length });
      vaciar(); hapticOk();
      return { ok: true, msg: 'Venta guardada (offline, se sincroniza al volver internet)', ventaId };
    }
  }, [comercio, sucursalActiva, miembro, state.cart, vaciar, loadVentasHoy, sincronizarAhora]);

  // El sync manual saca de cuarentena los items bloqueados y reintenta.
  const sincronizar = useCallback(async () => { await reintentarBloqueados(); await doFlush(); }, [doFlush]);

  return (
    <Ctx.Provider value={{ state, escanear, buscarPorNombre, agregarProducto, agregarMontoLibre, setQty, quitar, vaciar, confirmarVenta, sincronizar }}>
      {children}
    </Ctx.Provider>
  );
};

export const useVentas = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useVentas must be inside VentasProvider');
  return ctx;
};
