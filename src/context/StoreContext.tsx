import React, { createContext, useContext, useReducer, useEffect, ReactNode, useCallback, useMemo, useState, useRef } from 'react';
import { formatearPlata } from '../lib/numeros';
import {
  Producto, Lote, Sucursal, Movimiento,
  NivelAlerta, Resumen, ProductoConLotes, LoteConProducto,
  PerdidaMensual, DistribucionCategoria, DiaVencimiento,
} from '../types';
import { haptic } from '../utils/haptics';
import { useAuth } from './AuthContext';
import {
  abrirDB, guardarYEncolar, getMeta, setMeta, limpiarTodoLocal, podarMovimientos,
  cargarProductos, cargarLotes, cargarSucursales, cargarMovimientos,
  obtenerPendientes, obtenerBloqueados, reintentarBloqueados,
} from '../lib/localDb';
import type { TablaSync } from '../lib/localDb';
import { sincronizar, CambiosBajados, sinCambios } from '../lib/sync';
import { aplicarPorId, sumarMovimientos } from '../lib/aplicarCambios';
import { supabaseConfigurado } from '../lib/supabase';
import { almacenGet, almacenSet } from '../lib/almacen';
import { diasRestantes, calcularNivelAlerta as _calcNivel, ordenNivel, etiquetaNivel, fechaLocalISO } from '../lib/vencimientos';
import { DescuentoConfig } from '../lib/liquidacion';
import { camposDeCopia } from '../lib/copia';
import { sincronizarNotificaciones } from '../lib/notificaciones';
import { EVENTO_VENTA_PENDIENTE, leerUnidadesPendientes } from '../ventas/lib/outbox';

// ─── Settings locales ───────────────────────────────────────────────────────
const LS_PREFIX = 'stockly:';
export function getSetting(k: string, def = ''): string {
  return almacenGet(LS_PREFIX + k, def);
}
export function setSetting(k: string, v: string): void {
  almacenSet(LS_PREFIX + k, v);
}

/** Ajustes avisa que cambiaron los umbrales o descuentos: los niveles se recalculan. */
export const EVENTO_UMBRALES = 'stockly:umbrales';
export const UMBRAL_AVISO = () => parseInt(getSetting('umbral-aviso', '60'), 10) || 60;
export const UMBRAL_URGENTE = () => parseInt(getSetting('umbral-urgente', '30'), 10) || 30;
export const UMBRAL_CRITICO = () => parseInt(getSetting('umbral-critico', '7'), 10) || 7;
export const DIAS_AVISO_DEFAULT = () => parseInt(getSetting('dias-aviso-default', '15'), 10) || 15;
export const CATEGORIAS = () =>
  getSetting('categorias', 'Lácteos\nBebidas\nAlmacén\nLimpieza\nMedicamentos\nFiambres\nPanadería\nSnacks\nOtros')
    .split('\n').map(c => c.trim()).filter(Boolean);

// Descuentos de liquidación FEFO (%) configurables por comercio.
const descPct = (k: string, def: number) => {
  const n = parseInt(getSetting(k, String(def)), 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : def;
};
export const DESC_CRITICO = () => descPct('desc-critico', 40);
export const DESC_URGENTE = () => descPct('desc-urgente', 20);
export const DESC_AVISO   = () => descPct('desc-aviso', 10);
/** Config de descuentos actual (para pasar a sugerirLiquidacion). */
export function descuentoConfig(): DescuentoConfig {
  return { critico: DESC_CRITICO(), urgente: DESC_URGENTE(), aviso: DESC_AVISO() };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// diasRestantes/ordenNivel/etiquetaNivel viven en lib/vencimientos.ts (puro, testeable).
// Se re-exportan acá para no romper imports existentes.
export { diasRestantes, ordenNivel, etiquetaNivel };

// Wrapper: inyecta los umbrales configurables del comercio en la lógica pura.
export function calcularNivelAlerta(fechaVencimiento: string, diasAviso?: number): NivelAlerta {
  return _calcNivel(
    fechaVencimiento,
    { critico: UMBRAL_CRITICO(), urgente: UMBRAL_URGENTE(), aviso: UMBRAL_AVISO() },
    diasAviso,
  );
}
export function colorNivel(n: NivelAlerta): string { return `var(--level-${n}-fg)`; }
export function formatearFecha(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
export const formatearMoneda = formatearPlata;
export function textoEstado(fechaVencimiento: string): string {
  const d = diasRestantes(fechaVencimiento);
  if (d < 0) return `Vencido hace ${-d} día${-d === 1 ? '' : 's'}`;
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  return `Vence en ${d} días`;
}

const hoyISO = () => fechaLocalISO();

/** Crear fechas para cada lote en cada cambio pesaba con miles de lotes, y fechas distintas hay pocas. */
function nivelesConMemoria() {
  const niveles = new Map<string, NivelAlerta>();
  return (fecha: string, diasAviso?: number): NivelAlerta => {
    const k = `${fecha}|${diasAviso ?? ''}`;
    let n = niveles.get(k);
    if (!n) { n = calcularNivelAlerta(fecha, diasAviso); niveles.set(k, n); }
    return n;
  };
}

const CAMPOS_PRODUCTO = ['nombre', 'codigoBarras', 'categoria', 'precio', 'diasAvisoDefault', 'proveedor', 'stockMinimo', 'costo', 'fotoUrl'];
const CAMPOS_LOTE = ['fechaVencimiento', 'diasAviso', 'fechaIngreso', 'proveedor', 'numeroLote'];
/** Lo que cambió entre dos versiones de un registro (lo vacío va como null, para poder borrarlo en el servidor). */
function camposCambiados(antes: object | undefined, ahora: object, campos: string[]): Record<string, unknown> {
  const a = (antes ?? {}) as Record<string, unknown>, b = ahora as Record<string, unknown>;
  return Object.fromEntries(campos.filter(k => (a[k] ?? null) !== (b[k] ?? null)).map(k => [k, b[k] ?? null]));
}


// ─── Estado ─────────────────────────────────────────────────────────────────
interface State {
  productos: Producto[];
  inactivos: Producto[]; // dados de baja: no se muestran, pero lo que se perdió de ellos sigue valiendo plata
  lotes: Lote[];
  sucursales: Sucursal[];
  movimientos: Movimiento[];
  sucursalActivaId: string;
  loaded: boolean;
  pendientesSync: number;
  bloqueadosSync: number;
}
type Action =
  | { type: 'INIT'; productos: Producto[]; inactivos: Producto[]; lotes: Lote[]; sucursales: Sucursal[]; movimientos: Movimiento[]; sucursalActivaId: string }
  | { type: 'APLICAR_CAMBIOS'; cambios: CambiosBajados }
  | { type: 'SET_SUCURSAL_ACTIVA'; id: string }
  | { type: 'UPSERT_PRODUCTO'; producto: Producto }
  | { type: 'REMOVE_PRODUCTO'; id: string }
  | { type: 'UPSERT_LOTE'; lote: Lote }
  | { type: 'REMOVE_LOTE'; id: string }
  | { type: 'UPSERT_SUCURSAL'; sucursal: Sucursal }
  | { type: 'PREPEND_MOVIMIENTO'; movimiento: Movimiento }
  | { type: 'SET_PENDIENTES'; n: number }
  | { type: 'SET_BLOQUEADOS'; n: number };

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'INIT': return { ...state, ...a, loaded: true };
    case 'APLICAR_CAMBIOS': {
      const c = a.cambios;
      const productos = aplicarPorId<Producto>(state.productos, c.productos, p => p.activo);
      const inactivos = aplicarPorId<Producto>(state.inactivos, c.productos, p => !p.activo);
      const lotes = aplicarPorId<Lote>(state.lotes, c.lotes, l => !l.retirado);
      const sucursales = aplicarPorId<Sucursal>(state.sucursales, c.sucursales, s => s.activa);
      const movimientos = sumarMovimientos<Movimiento>(state.movimientos, c.movimientos);
      if (productos === state.productos && inactivos === state.inactivos && lotes === state.lotes
        && sucursales === state.sucursales && movimientos === state.movimientos) return state; // nada cambió: no se redibuja
      const sucursalActivaId = sucursales.some(s => s.id === state.sucursalActivaId) ? state.sucursalActivaId : sucursales[0]?.id || '';
      return { ...state, productos, inactivos, lotes, sucursales, movimientos, sucursalActivaId };
    }
    case 'SET_SUCURSAL_ACTIVA': return { ...state, sucursalActivaId: a.id };
    case 'UPSERT_PRODUCTO': {
      const ex = state.productos.some(p => p.id === a.producto.id);
      return { ...state, productos: ex ? state.productos.map(p => p.id === a.producto.id ? a.producto : p) : [...state.productos, a.producto] };
    }
    case 'REMOVE_PRODUCTO': return { ...state, productos: state.productos.filter(p => p.id !== a.id) };
    case 'UPSERT_LOTE': {
      const ex = state.lotes.some(l => l.id === a.lote.id);
      return { ...state, lotes: ex ? state.lotes.map(l => l.id === a.lote.id ? a.lote : l) : [...state.lotes, a.lote] };
    }
    case 'REMOVE_LOTE': return { ...state, lotes: state.lotes.filter(l => l.id !== a.id) };
    case 'UPSERT_SUCURSAL': {
      const ex = state.sucursales.some(s => s.id === a.sucursal.id);
      return { ...state, sucursales: ex ? state.sucursales.map(s => s.id === a.sucursal.id ? a.sucursal : s) : [...state.sucursales, a.sucursal] };
    }
    case 'PREPEND_MOVIMIENTO': return { ...state, movimientos: [a.movimiento, ...state.movimientos] };
    case 'SET_PENDIENTES': return state.pendientesSync === a.n ? state : { ...state, pendientesSync: a.n };
    case 'SET_BLOQUEADOS': return state.bloqueadosSync === a.n ? state : { ...state, bloqueadosSync: a.n };
    default: return state;
  }
}

interface StoreContextValue {
  state: State;
  sincronizarAhora: () => Promise<void>;
  reintentarFallidos: () => Promise<void>;
  estadoNube: { configurado: boolean; ultimoError: string | null; ultimaSyncOk: string | null };
  addProducto: (p: Omit<Producto, 'id' | 'fechaCreacion' | 'activo' | 'comercioId'>) => Promise<string | null>;
  updateProducto: (p: Producto, original?: Producto) => Promise<void>;
  deleteProducto: (id: string) => Promise<void>;
  buscarProductoPorCodigo: (codigo: string) => Producto | undefined;
  addLote: (l: Omit<Lote, 'id' | 'fechaIngreso' | 'retirado' | 'comercioId'>) => Promise<string | null>;
  updateLote: (l: Lote, original?: Lote) => Promise<void>;
  ajustarLotes: (nuevos: Lote[]) => Promise<void>;
  retirarLote: (id: string, tipo: 'retiro_venta' | 'retiro_vencido' | 'retiro_roto', cantidad?: number, notas?: string) => Promise<void>;
  addSucursal: (s: Omit<Sucursal, 'id' | 'activa' | 'comercioId'>) => Promise<string | null>;
  updateSucursal: (s: Sucursal) => Promise<void>;
  setSucursalActiva: (id: string) => void;
  productosConLotes: () => ProductoConLotes[];
  lotesEnriquecidos: () => LoteConProducto[];
  resumen: () => Resumen;
  fefoSugeridos: (productoId: string) => Lote[];
  perdidasPorMes: (meses?: number) => PerdidaMensual[];
  distribucionPorCategoria: () => DistribucionCategoria[];
  vencimientosDelMes: (anio: number, mes: number) => Map<string, DiaVencimiento>;
  exportarBackup: () => string;
  importarBackup: (json: string) => Promise<{ ok: number; error: number }>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { comercio, miembro, cajeroEnTurno } = useAuth();
  const [state, dispatch] = useReducer(reducer, {
    productos: [], inactivos: [], lotes: [], sucursales: [], movimientos: [],
    sucursalActivaId: '', loaded: false, pendientesSync: 0, bloqueadosSync: 0,
  });
  const [sincronizando, setSincronizando] = useState(false);
  const sincronizandoRef = useRef(false);
  const [estadoNube, setEstadoNube] = useState<{ configurado: boolean; ultimoError: string | null; ultimaSyncOk: string | null }>({
    configurado: supabaseConfigurado,
    ultimoError: null,
    ultimaSyncOk: null,
  });
  // Mantener el ref en sync con el estado, para usarlo en intervalos sin recrearlos
  useEffect(() => { sincronizandoRef.current = sincronizando; }, [sincronizando]);
  const estadoNubeRef = useRef(estadoNube);
  useEffect(() => { estadoNubeRef.current = estadoNube; }, [estadoNube]);

  const comercioId = comercio?.id;
  const usuario = cajeroEnTurno || miembro?.nombre || 'Usuario'; // en la tablet: quien tiene el turno

  const refrescarPendientes = useCallback(async () => {
    const p = await obtenerPendientes();
    dispatch({ type: 'SET_PENDIENTES', n: p.length });
    const b = await obtenerBloqueados();
    dispatch({ type: 'SET_BLOQUEADOS', n: b.length });
  }, []);

  // Los niveles dependen del día: con la tablet prendida toda la noche, lo que venció seguía "Crítico" hasta la primera venta.
  const [hoy, setHoy] = useState(hoyISO);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const programar = () => {
      const medianoche = new Date();
      medianoche.setHours(24, 0, 5, 0);
      t = setTimeout(() => { setHoy(hoyISO()); programar(); }, medianoche.getTime() - Date.now());
    };
    programar();
    const alVolver = () => { if (!document.hidden) setHoy(hoyISO()); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', alVolver); };
  }, []);

  // Cambian los umbrales en Ajustes → se recalculan los niveles (antes hacía falta reabrir la app).
  const [umbralesN, setUmbralesN] = useState(0);
  useEffect(() => {
    const f = () => setUmbralesN(n => n + 1);
    window.addEventListener(EVENTO_UMBRALES, f);
    return () => window.removeEventListener(EVENTO_UMBRALES, f);
  }, []);

  // Vendido en Vender que todavía no subió (sin internet): se descuenta del total de cada producto.
  const [vendidoSinSubir, setVendidoSinSubir] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    const leer = () => { leerUnidadesPendientes(state.sucursalActivaId).then(setVendidoSinSubir, () => { /* */ }); };
    leer();
    window.addEventListener(EVENTO_VENTA_PENDIENTE, leer);
    return () => window.removeEventListener(EVENTO_VENTA_PENDIENTE, leer);
  }, [state.sucursalActivaId]);

  // Recargar estado desde IndexedDB (fuente de verdad local)
  const recargarLocal = useCallback(async () => {
    const [productos, lotes, sucursales, movimientos] = await Promise.all([
      cargarProductos(), cargarLotes(), cargarSucursales(), cargarMovimientos(),
    ]);
    const activos = productos.filter(p => p.activo);
    const lotesActivos = lotes.filter(l => !l.retirado);
    const sucursalesActivas = sucursales.filter(s => s.activa);
    movimientos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)); // más nuevo primero (localeCompare era 2,5 veces más lento)

    const guardada = getSetting('sucursal-activa', '');
    const sucursalActivaId = sucursalesActivas.find(s => s.id === guardada)?.id || sucursalesActivas[0]?.id || '';
    // Se leen junto con los lotes: si una venta acaba de subir, sale de la cola y entra a los lotes a la vez.
    setVendidoSinSubir(await leerUnidadesPendientes(sucursalActivaId).catch(() => new Map<string, number>()));

    dispatch({
      type: 'INIT',
      productos: activos, inactivos: productos.filter(p => !p.activo), lotes: lotesActivos,
      sucursales: sucursalesActivas, movimientos, sucursalActivaId,
    });
  }, []);

  // Sincroniza y aplica solo lo que bajó, sobre lo que ya está en memoria: antes cada venta, propia o de otro equipo,
  // releía todo el almacenamiento local y redibujaba todas las pantallas.
  const sucursalActivaRef = useRef('');
  sucursalActivaRef.current = state.sucursalActivaId;
  const aplicarCambios = useCallback(async (cambios: CambiosBajados) => {
    if (sinCambios(cambios)) return;
    // Se leen junto con los lotes: si una venta acaba de subir, sale de la cola y entra a los lotes a la vez.
    setVendidoSinSubir(await leerUnidadesPendientes(sucursalActivaRef.current).catch(() => new Map<string, number>()));
    dispatch({ type: 'APLICAR_CAMBIOS', cambios });
  }, []);
  const sincronizarYRecargar = useCallback(async (id: string) => {
    // Productos y compras se aplican apenas bajan, sin esperar los movimientos (que llegan al final).
    const res = await sincronizar(id, c => { void aplicarCambios(c); });
    if (res.cambios) await aplicarCambios(res.cambios);
    await refrescarPendientes();
    return res;
  }, [refrescarPendientes, aplicarCambios]);

  // ─── Init: abrir DB local, cargar, y sincronizar si hay internet ──────────
  useEffect(() => {
    if (!comercioId) {
      // Sin comercio aún (puede estar cargando la sesión o falló sin caché).
      // Abrimos la DB y marcamos como cargado para no quedar en skeleton infinito.
      (async () => {
        try { await abrirDB(); await recargarLocal(); } catch { /* */ }
      })();
      return;
    }
    (async () => {
      await abrirDB();
      // Lo guardado en el equipo es de una sola cuenta. Si la sesión se cortó sola y entra otra, veía los productos de
      // la anterior y su cola se subía dentro del comercio nuevo.
      const deQuien = await getMeta('comercio-datos');
      if (deQuien && deQuien !== comercioId) await limpiarTodoLocal().catch(() => { /* */ });
      if (deQuien !== comercioId) await setMeta('comercio-datos', comercioId);
      await recargarLocal();   // mostrar lo local YA (instantáneo)
      await refrescarPendientes();
      // Una vez por día, en segundo plano: los movimientos viejos ya están en el servidor.
      if ((await getMeta('poda-movimientos')) !== hoyISO()) {
        setMeta('poda-movimientos', hoyISO()).then(() => podarMovimientos()).catch(() => { /* */ });
      }

      // Sincronizar en segundo plano si hay internet
      if (navigator.onLine) {
        setSincronizando(true);
        try {
          await sincronizarYRecargar(comercioId);
        } catch (e) {
          console.warn('Sync inicial falló', e);
        } finally {
          setSincronizando(false);
        }
      }
    })();
  }, [comercioId, recargarLocal, refrescarPendientes, sincronizarYRecargar]);

  // ─── Sincronizar cuando vuelve internet ───────────────────────────────────
  useEffect(() => {
    if (!comercioId) return;
    const alVolver = async () => {
      setSincronizando(true);
      try {
        await sincronizarYRecargar(comercioId);
      } finally {
        setSincronizando(false);
      }
    };
    window.addEventListener('online', alVolver);
    return () => window.removeEventListener('online', alVolver);
  }, [comercioId, sincronizarYRecargar]);

  // ─── Sincronización periódica: cada 30 s con la app a la vista ─────────────
  // En segundo plano no gasta batería ni datos (al volver sincroniza de una). Si falla (Wi-Fi sin salida),
  // espera cada vez más, hasta 10 min: antes reintentaba cada 30 s y en una hora mandaba todo a cuarentena.
  useEffect(() => {
    if (!comercioId) return;
    let espera = 0;
    let proximo = 0;
    const ciclo = async () => {
      if (!navigator.onLine || document.hidden || sincronizandoRef.current || Date.now() < proximo) return;
      let error: string | null | undefined;
      try { error = (await sincronizarYRecargar(comercioId)).error; } catch (e) { error = String(e); }
      espera = error ? Math.min(Math.max(espera * 2, 30000), 600000) : 0;
      proximo = Date.now() + espera;
    };
    const intervalo = setInterval(ciclo, 30000);
    const alVolverALaApp = () => { if (!document.hidden) { proximo = 0; ciclo(); } };
    document.addEventListener('visibilitychange', alVolverALaApp);
    return () => { clearInterval(intervalo); document.removeEventListener('visibilitychange', alVolverALaApp); };
  }, [comercioId, sincronizarYRecargar]);

  // Sin cortar si ya hay una en curso: lib/sync encadena UNA pasada más. Antes un cambio hecho mientras
  // sincronizaba esperaba al ciclo de 30 s (y una venta recién subida no se veía en Mercadería).
  const enVuelo = useRef(0);
  const sincronizarAhora = useCallback(async () => {
    if (!comercioId || !navigator.onLine) return;
    enVuelo.current++;
    sincronizandoRef.current = true;
    setSincronizando(true);
    try {
      const res = await sincronizarYRecargar(comercioId);
      // Solo si cambia el error: la hora de la última sincronización sola no vale redibujar toda la app.
      if (res.error !== estadoNubeRef.current.ultimoError || !estadoNubeRef.current.ultimaSyncOk) {
        setEstadoNube({
          configurado: supabaseConfigurado,
          ultimoError: res.error,
          ultimaSyncOk: res.error ? estadoNubeRef.current.ultimaSyncOk : new Date().toISOString(),
        });
      }
    } finally {
      if (--enVuelo.current === 0) {
        sincronizandoRef.current = false;
        setSincronizando(false);
      }
    }
  }, [comercioId, sincronizarYRecargar]);

  // Saca de cuarentena los cambios fallidos y reintenta sincronizarlos.
  const reintentarFallidos = useCallback(async () => {
    await reintentarBloqueados();
    await refrescarPendientes();
    await sincronizarAhora();
  }, [refrescarPendientes, sincronizarAhora]);

  // ─── Escritura: SIEMPRE local primero + encolar ───────────────────────────

  // comoAjuste=true → el cambio de stock se aplica por DELTA atómico (RPC ajustar_stock),
  // no por upsert de la fila (así no pisa la cantidad que descontó la app de Ventas).
  // `ademas`: lo que se guarda en la misma transacción que el movimiento (el lote que cambió y su cambio).
  const registrarMovimiento = useCallback(async (m: Omit<Movimiento, 'id' | 'fecha' | 'usuario' | 'comercioId'>, comoAjuste = false,
    ademas?: Parameters<typeof guardarYEncolar>[3]) => {
    if (!comercioId) return;
    const mov: Movimiento = {
      ...m, id: crypto.randomUUID(), comercioId,
      fecha: new Date().toISOString(), usuario,
    };
    await guardarYEncolar('movimientos', mov, {
      tabla: comoAjuste && mov.loteId ? 'ajuste_stock' : 'movimientos', operacion: 'insert', registroId: mov.id!, payload: mov,
    }, ademas);
    dispatch({ type: 'PREPEND_MOVIMIENTO', movimiento: mov });
    await refrescarPendientes();
  }, [comercioId, usuario, refrescarPendientes]);

  const addProducto = useCallback(async (p: Omit<Producto, 'id' | 'fechaCreacion' | 'activo' | 'comercioId'>) => {
    if (!comercioId) return null;
    const prod: Producto = {
      ...p, id: crypto.randomUUID(), comercioId,
      fechaCreacion: hoyISO(), activo: true,
    };
    await guardarYEncolar('productos', prod, { tabla: 'productos', operacion: 'insert', registroId: prod.id!, payload: prod });
    dispatch({ type: 'UPSERT_PRODUCTO', producto: prod });
    await registrarMovimiento({ productoId: prod.id!, sucursalId: state.sucursalActivaId, tipo: 'creacion', cantidad: 0, cantidadAnterior: 0, cantidadNueva: 0, notas: `Producto "${p.nombre}" creado` });
    sincronizarAhora();
    return prod.id!;
  }, [comercioId, state.sucursalActivaId, registrarMovimiento, sincronizarAhora]);

  // `original`: como estaba al abrir el formulario. Si otro equipo cambió el precio mientras tanto, guardar acá solo
  // la categoría no le vuelve el precio atrás.
  const updateProducto = useCallback(async (p: Producto, original?: Producto) => {
    // Solo los campos que cambiaron: si otro equipo cambió otro campo del mismo producto, no se lo pisa.
    const parche = camposCambiados(original ?? state.productos.find(x => x.id === p.id), p, CAMPOS_PRODUCTO);
    if (Object.keys(parche).length > 0) {
      await guardarYEncolar('productos', p, { tabla: 'productos', operacion: 'update', registroId: p.id!, payload: parche });
    }
    dispatch({ type: 'UPSERT_PRODUCTO', producto: p });
    await refrescarPendientes();
    sincronizarAhora();
  }, [state.productos, refrescarPendientes, sincronizarAhora]);

  const deleteProducto = useCallback(async (id: string) => {
    await guardarYEncolar('productos', null, { tabla: 'productos', operacion: 'delete', registroId: id, payload: { id } });
    dispatch({ type: 'REMOVE_PRODUCTO', id });
    await refrescarPendientes();
    sincronizarAhora();
  }, [refrescarPendientes, sincronizarAhora]);

  const buscarProductoPorCodigo = useCallback((codigo: string) =>
    state.productos.find(p => p.codigoBarras === codigo), [state.productos]);

  const addLote = useCallback(async (l: Omit<Lote, 'id' | 'fechaIngreso' | 'retirado' | 'comercioId'>) => {
    if (!comercioId) return null;
    const lote: Lote = {
      ...l, id: crypto.randomUUID(), comercioId,
      fechaIngreso: hoyISO(), retirado: false,
    };
    await guardarYEncolar('lotes', lote, { tabla: 'lotes', operacion: 'insert', registroId: lote.id!, payload: lote });
    dispatch({ type: 'UPSERT_LOTE', lote });
    haptic.success();
    await registrarMovimiento({ loteId: lote.id, productoId: l.productoId, sucursalId: l.sucursalId, tipo: 'ingreso', cantidad: l.cantidad, cantidadAnterior: 0, cantidadNueva: l.cantidad, notas: `Ingreso de ${l.cantidad} unid.` });
    sincronizarAhora();
    return lote.id!;
  }, [comercioId, registrarMovimiento, sincronizarAhora]);

  const updateLote = useCallback(async (l: Lote, original?: Lote) => {
    const anterior = state.lotes.find(x => x.id === l.id);
    const diff = l.cantidad - (anterior?.cantidad || 0);
    // Solo lo que cambió: si solo cambió la cantidad no se sube la fila (pisaba una fecha corregida en otro equipo).
    const parche = camposCambiados(original ?? anterior, l, CAMPOS_LOTE);
    const cambio = Object.keys(parche).length > 0
      ? [{ tabla: 'lotes' as const, operacion: 'update' as const, registroId: l.id!, payload: parche }] : [];
    // El ajuste, el lote y su cambio en una sola transacción: si la app se corta, queda todo o nada.
    if (diff !== 0) {
      await registrarMovimiento({ loteId: l.id, productoId: l.productoId, sucursalId: l.sucursalId, tipo: 'ajuste', cantidad: diff, cantidadAnterior: anterior?.cantidad || 0, cantidadNueva: l.cantidad, notas: `Ajuste (${diff > 0 ? '+' : ''}${diff})` },
        true, { filas: [['lotes', l]], items: cambio });
    } else if (cambio.length > 0) {
      await guardarYEncolar('lotes', l, cambio[0]);
    }
    dispatch({ type: 'UPSERT_LOTE', lote: l });
    await refrescarPendientes();
    sincronizarAhora();
  }, [state.lotes, registrarMovimiento, refrescarPendientes, sincronizarAhora]);

  // Conteo de la mercadería: todos los ajustes en una sola transacción y un solo redibujo. Antes, lote por lote, 300
  // diferencias dejaban la pantalla trabada varios minutos.
  const ajustarLotes = useCallback(async (nuevos: Lote[]) => {
    if (!comercioId) return;
    const porId = new Map(state.lotes.map(l => [l.id, l]));
    const movs: Movimiento[] = [];
    const cambiados: Lote[] = [];
    for (const l of nuevos) {
      const ant = porId.get(l.id)?.cantidad ?? 0;
      const diff = l.cantidad - ant;
      if (diff === 0) continue;
      cambiados.push(l);
      movs.push({ id: crypto.randomUUID(), comercioId, fecha: new Date().toISOString(), usuario, loteId: l.id, productoId: l.productoId, sucursalId: l.sucursalId,
        tipo: 'ajuste', cantidad: diff, cantidadAnterior: ant, cantidadNueva: l.cantidad, notas: `Ajuste (${diff > 0 ? '+' : ''}${diff})` });
    }
    if (movs.length === 0) return;
    const items = movs.map(m => ({ tabla: 'ajuste_stock' as const, operacion: 'insert' as const, registroId: m.id!, payload: m }));
    await guardarYEncolar('movimientos', movs[0], items[0], {
      filas: [...movs.slice(1).map((m): [TablaSync, object] => ['movimientos', m]), ...cambiados.map((l): [TablaSync, object] => ['lotes', l])],
      items: items.slice(1),
    });
    dispatch({ type: 'APLICAR_CAMBIOS', cambios: { productos: [], sucursales: [], lotes: cambiados, movimientos: movs } });
    await refrescarPendientes();
    sincronizarAhora();
  }, [comercioId, usuario, state.lotes, refrescarPendientes, sincronizarAhora]);

  const retirarLote = useCallback(async (id: string, tipo: 'retiro_venta' | 'retiro_vencido' | 'retiro_roto', cantidad?: number, notas?: string) => {
    const lote = state.lotes.find(l => l.id === id);
    if (!lote) return;
    const cantARetirar = cantidad ?? lote.cantidad;
    const cantNueva = Math.max(0, lote.cantidad - cantARetirar);
    const retirado = cantNueva === 0;
    const actualizado: Lote = { ...lote, cantidad: cantNueva, retirado };

    // El retiro se sincroniza por delta atómico (ajuste_stock), no por upsert de cantidad. El lote, el
    // movimiento y el ajuste van en una sola transacción: si la app se corta, queda todo o nada.
    await registrarMovimiento({ loteId: id, productoId: lote.productoId, sucursalId: lote.sucursalId, tipo, cantidad: -cantARetirar, cantidadAnterior: lote.cantidad, cantidadNueva: cantNueva, notas },
      true, { filas: [['lotes', actualizado]] });
    haptic.medium();
    if (retirado) dispatch({ type: 'REMOVE_LOTE', id });
    else dispatch({ type: 'UPSERT_LOTE', lote: actualizado });
    sincronizarAhora();
  }, [state.lotes, registrarMovimiento, sincronizarAhora]);

  const addSucursal = useCallback(async (s: Omit<Sucursal, 'id' | 'activa' | 'comercioId'>) => {
    if (!comercioId) return null;
    const suc: Sucursal = { ...s, id: crypto.randomUUID(), comercioId, activa: true };
    await guardarYEncolar('sucursales', suc, { tabla: 'sucursales', operacion: 'insert', registroId: suc.id!, payload: suc });
    dispatch({ type: 'UPSERT_SUCURSAL', sucursal: suc });
    await refrescarPendientes();
    // Sincronizar en segundo plano SIN recargar el estado completo de inmediato
    // (recargar pisaría la sucursal recién creada si el put aún no se commiteó).
    // El sync periódico de 30s ya la subirá y bajará de forma consistente.
    if (navigator.onLine && comercioId) {
      sincronizar(comercioId).then(() => refrescarPendientes()).catch(() => { /* */ });
    }
    return suc.id!;
  }, [comercioId, refrescarPendientes]);

  const updateSucursal = useCallback(async (s: Sucursal) => {
    // Solo lo que cambió: renombrar sin internet un local que otro equipo borró lo revivía.
    const parche = camposCambiados(state.sucursales.find(x => x.id === s.id), s, ['nombre', 'direccion', 'activa']);
    await guardarYEncolar('sucursales', s, { tabla: 'sucursales', operacion: 'update', registroId: s.id!, payload: parche });
    dispatch({ type: 'UPSERT_SUCURSAL', sucursal: s });
    await refrescarPendientes();
    sincronizarAhora();
  }, [state.sucursales, refrescarPendientes, sincronizarAhora]);

  const setSucursalActiva = useCallback((id: string) => {
    setSetting('sucursal-activa', id);
    dispatch({ type: 'SET_SUCURSAL_ACTIVA', id });
  }, []);

  // ─── Vistas calculadas (idénticas a la versión cloud) ─────────────────────
  // Se calculan UNA vez por cambio de datos y las comparten todas las pantallas (Ionic
  // deja montadas varias). Con índices: antes cada producto recorría todos los lotes y
  // cada lote buscaba su producto, O(productos × lotes). No mutar los arreglos devueltos.
  const lotesDeSucursal = useMemo(
    () => state.lotes.filter(l => l.sucursalId === state.sucursalActivaId),
    [state.lotes, state.sucursalActivaId]);
  const lotesPorProducto = useMemo(() => {
    const m = new Map<string, Lote[]>();
    for (const l of lotesDeSucursal) {
      const a = m.get(l.productoId);
      if (a) a.push(l); else m.set(l.productoId, [l]);
    }
    return m;
  }, [lotesDeSucursal]);

  const productosConLotesCalc = useMemo((): ProductoConLotes[] => {
    const nivelDe = nivelesConMemoria();
    return state.productos.map(producto => {
      const lotes = lotesPorProducto.get(producto.id!) ?? [];
      const cantidadTotal = lotes.reduce((s, l) => s + l.cantidad, 0) - (vendidoSinSubir.get(producto.id!) ?? 0); // con negativos: vendido sin stock
      let nivelPeor: NivelAlerta = 'ok';
      let proxVenc: string | undefined;
      for (const l of lotes) {
        if (l.cantidad <= 0) continue; // un lote vacío o en negativo no vence
        const n = nivelDe(l.fechaVencimiento, l.diasAviso);
        if (ordenNivel(n) < ordenNivel(nivelPeor)) nivelPeor = n;
        if (!proxVenc || l.fechaVencimiento < proxVenc) proxVenc = l.fechaVencimiento;
      }
      // Lo que falta (en negativo) no resta plata del inventario: la misma cuenta en Inicio, Mercadería, Reportes y el Excel.
      return { producto, lotes, cantidadTotal, valorTotal: Math.max(0, cantidadTotal) * producto.precio, nivelPeor, proximoVencimiento: proxVenc };
    });
  }, [state.productos, lotesPorProducto, vendidoSinSubir, umbralesN, hoy]);
  const productosConLotes = useCallback(() => productosConLotesCalc, [productosConLotesCalc]);

  const lotesEnriquecidosCalc = useMemo((): LoteConProducto[] => {
    const prodPorId = new Map(state.productos.map(p => [p.id, p]));
    const suc = state.sucursales.find(s => s.id === state.sucursalActivaId);
    const nivelDe = nivelesConMemoria();
    const diasPorFecha = new Map<string, number>();
    const diasDe = (f: string) => { let d = diasPorFecha.get(f); if (d === undefined) { d = diasRestantes(f); diasPorFecha.set(f, d); } return d; };
    // Dar de baja un producto no retira sus lotes: sin este filtro seguían en Inventario y avisos como "(eliminado)".
    return lotesDeSucursal.filter(l => prodPorId.has(l.productoId)).map(l => {
      const prod = prodPorId.get(l.productoId);
      return {
        ...l, productoNombre: prod?.nombre || '(eliminado)', productoCategoria: prod?.categoria || '',
        productoPrecio: prod?.precio || 0, productoProveedor: prod?.proveedor, sucursalNombre: suc?.nombre || '',
        nivelAlerta: l.cantidad > 0 ? nivelDe(l.fechaVencimiento, l.diasAviso) : 'ok',
        diasRestantes: diasDe(l.fechaVencimiento), valorLote: l.cantidad * (prod?.precio || 0),
      };
    });
  }, [lotesDeSucursal, state.productos, state.sucursales, state.sucursalActivaId, umbralesN, hoy]);
  const lotesEnriquecidos = useCallback(() => lotesEnriquecidosCalc, [lotesEnriquecidosCalc]);

  // El aviso de vencimiento se reprograma al arrancar y al salir de la app, que es cuando sirve. Hacerlo en cada venta
  // recorría todos los lotes y llamaba tres veces al sistema.
  const lotesParaAvisos = useRef(lotesEnriquecidos);
  lotesParaAvisos.current = lotesEnriquecidos;
  useEffect(() => {
    if (!state.loaded) return;
    sincronizarNotificaciones(lotesParaAvisos.current());
    const alSalir = () => { if (document.hidden) sincronizarNotificaciones(lotesParaAvisos.current()); };
    document.addEventListener('visibilitychange', alSalir);
    return () => document.removeEventListener('visibilitychange', alSalir);
  }, [state.loaded, state.sucursalActivaId]);

  const resumenCalc = useMemo((): Resumen => {
    const e = lotesEnriquecidosCalc;
    const negativos = productosConLotesCalc.filter(p => p.cantidadTotal < 0);
    const r: Resumen = { productosTotales: productosConLotesCalc.filter(p => p.cantidadTotal > 0).length, lotesTotales: 0, unidadesTotales: 0, valorTotal: 0, lotesVencidos: 0, lotesCriticos: 0, lotesUrgentes: 0, lotesAviso: 0, lotesOk: 0, valorVencido: 0, valorEnRiesgo: 0,
      productosEnNegativo: negativos.length, unidadesFaltantes: negativos.reduce((s, p) => s - p.cantidadTotal, 0) };
    // Valor y unidades, por producto y con lo vendido sin subir: antes Inicio decía una cosa y Mercadería y el Excel otra.
    for (const p of productosConLotesCalc) { r.unidadesTotales += Math.max(0, p.cantidadTotal); r.valorTotal += p.valorTotal; }
    for (const l of e) {
      if (l.cantidad <= 0) continue; // lo que hay en el local: los negativos van aparte
      r.lotesTotales++;
      switch (l.nivelAlerta) {
        case 'vencido': r.lotesVencidos++; r.valorVencido += l.valorLote; break;
        case 'critico': r.lotesCriticos++; r.valorEnRiesgo += l.valorLote; break;
        case 'urgente': r.lotesUrgentes++; r.valorEnRiesgo += l.valorLote; break;
        case 'aviso': r.lotesAviso++; break;
        case 'ok': r.lotesOk++; break;
      }
    }
    return r;
  }, [lotesEnriquecidosCalc, productosConLotesCalc]);
  const resumen = useCallback(() => resumenCalc, [resumenCalc]);

  const fefoSugeridos = useCallback((productoId: string): Lote[] =>
    (lotesPorProducto.get(productoId) ?? []).filter(l => l.cantidad > 0)
      .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento)),
    [lotesPorProducto]);

  const perdidasPorMes = useCallback((meses = 6): PerdidaMensual[] => {
    const ET = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const hoy = new Date();
    const res: PerdidaMensual[] = [];
    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      res.push({ mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, etiqueta: ET[d.getMonth()], valorVencido: 0, valorRoto: 0, unidadesVencidas: 0 });
    }
    const idx = new Map(res.map((r, i) => [r.mes, i]));
    // También los dados de baja: lo tirado de un producto que después se borró sigue siendo plata perdida.
    const prodPorId = new Map([...state.productos, ...state.inactivos].map(p => [p.id, p]));
    for (const m of state.movimientos) {
      if (m.tipo !== 'retiro_vencido' && m.tipo !== 'retiro_roto') continue;
      if (m.sucursalId !== state.sucursalActivaId) continue; // del local elegido, como el resto de Reportes
      const i = idx.get(fechaLocalISO(new Date(m.fecha)).slice(0, 7));
      if (i === undefined) continue;
      const prod = prodPorId.get(m.productoId);
      const valor = Math.abs(m.cantidad) * (prod?.costo || prod?.precio || 0); // al costo: la plata perdida
      if (m.tipo === 'retiro_vencido') { res[i].valorVencido += valor; res[i].unidadesVencidas += Math.abs(m.cantidad); }
      else res[i].valorRoto += valor;
    }
    return res;
  }, [state.movimientos, state.productos, state.inactivos, state.sucursalActivaId]);

  const distribucionPorCategoria = useCallback((): DistribucionCategoria[] => {
    const mapa = new Map<string, DistribucionCategoria>();
    const prodPorId = new Map(state.productos.map(p => [p.id, p]));
    for (const l of state.lotes) {
      if (l.sucursalId !== state.sucursalActivaId || l.cantidad <= 0) continue;
      const prod = prodPorId.get(l.productoId);
      if (!prod) continue;
      const cat = prod.categoria || 'Sin categoría';
      const valor = l.cantidad * prod.precio;
      const ex = mapa.get(cat);
      if (ex) { ex.cantidad += l.cantidad; ex.valor += valor; }
      else mapa.set(cat, { categoria: cat, cantidad: l.cantidad, valor });
    }
    return Array.from(mapa.values()).sort((a, b) => b.valor - a.valor);
  }, [state.lotes, state.productos, state.sucursalActivaId]);

  const vencimientosDelMes = useCallback((anio: number, mes: number): Map<string, DiaVencimiento> => {
    const mapa = new Map<string, DiaVencimiento>();
    const prefijo = `${anio}-${String(mes + 1).padStart(2, '0')}`;
    const nivelDe = nivelesConMemoria();
    for (const l of state.lotes) {
      if (l.sucursalId !== state.sucursalActivaId || l.cantidad <= 0) continue;
      if (!l.fechaVencimiento.startsWith(prefijo)) continue;
      const nivel = nivelDe(l.fechaVencimiento, l.diasAviso);
      const ex = mapa.get(l.fechaVencimiento);
      if (ex) { ex.lotes++; ex.unidades += l.cantidad; if (ordenNivel(nivel) < ordenNivel(ex.nivelPeor)) ex.nivelPeor = nivel; }
      else mapa.set(l.fechaVencimiento, { fecha: l.fechaVencimiento, lotes: 1, unidades: l.cantidad, nivelPeor: nivel });
    }
    return mapa;
  }, [state.lotes, state.sucursalActivaId, umbralesN, hoy]);

  // ─── Backup ────────────────────────────────────────────────────────────
  const exportarBackup = useCallback((): string => {
    return JSON.stringify({
      version: 1,
      comercioId,
      exportadoEl: new Date().toISOString(),
      productos: state.productos,
      lotes: state.lotes,
      sucursales: state.sucursales,
      movimientos: state.movimientos,
    }, null, 2);
  }, [comercioId, state]);

  const importarBackup = useCallback(async (json: string): Promise<{ ok: number; error: number }> => {
    if (!comercioId) return { ok: 0, error: 0 };
    let ok = 0, error = 0;

    let data: any;
    try {
      data = JSON.parse(json);
    } catch {
      return { ok: 0, error: 1 };
    }

    // Helper: importa un array a una tabla, regenerando id y reasignando comercio. Solo los campos conocidos y con
    // el tipo que corresponde: un archivo armado a mano metía cualquier cosa (fotos de otro sitio, `activo`, textos enormes).
    const importarTabla = async (
      tabla: 'productos' | 'sucursales',
      items: any[],
      mapaIds: Map<string, string>
    ) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        try {
          const limpio = camposDeCopia(tabla, item);
          if (!limpio) { error++; continue; }
          const nuevoId = crypto.randomUUID();
          if (typeof item?.id === 'string') mapaIds.set(item.id, nuevoId);
          const registro = tabla === 'productos'
            ? { ...limpio, id: nuevoId, comercioId, activo: true, fechaCreacion: hoyISO() }
            : { ...limpio, id: nuevoId, comercioId, activa: true };
          await guardarYEncolar(tabla, registro, { tabla, operacion: 'insert', registroId: nuevoId, payload: registro });
          ok++;
        } catch {
          error++;
        }
      }
    };

    // Mapas para reconectar relaciones (id viejo → id nuevo)
    const mapaSucursales = new Map<string, string>();
    const mapaProductos = new Map<string, string>();

    // 1. Sucursales primero (los lotes dependen de ellas)
    await importarTabla('sucursales', data.sucursales || [], mapaSucursales);

    // 2. Productos
    await importarTabla('productos', data.productos || [], mapaProductos);

    // 3. Lotes (reconectando producto y sucursal)
    if (Array.isArray(data.lotes)) {
      for (const lote of data.lotes) {
        try {
          const limpio = camposDeCopia('lotes', lote);
          // El lote tiene que ser de un producto de la copia o de uno que ya existe acá.
          const productoId = mapaProductos.get(lote?.productoId) || (state.productos.some(p => p.id === lote?.productoId) ? lote.productoId : '');
          if (!limpio || !productoId) { error++; continue; }
          const nuevoId = crypto.randomUUID();
          const sucursalId = mapaSucursales.get(lote.sucursalId) || state.sucursalActivaId;
          const registro: Lote = {
            ...(limpio as Omit<Lote, 'id' | 'comercioId' | 'productoId' | 'sucursalId' | 'retirado'>),
            id: nuevoId, comercioId, productoId, sucursalId, retirado: false,
          };
          await guardarYEncolar('lotes', registro, { tabla: 'lotes', operacion: 'insert', registroId: nuevoId, payload: registro });
          ok++;
        } catch {
          error++;
        }
      }
    }

    // Recargar estado y sincronizar
    await recargarLocal();
    await refrescarPendientes();
    sincronizarAhora();

    return { ok, error };
  }, [comercioId, state.sucursalActivaId, state.productos, recargarLocal, refrescarPendientes, sincronizarAhora]);

  // Memo: si el proveedor se redibuja sin cambios (p. ej. por la sesión), las pantallas no.
  const valor = useMemo(() => ({
    state, sincronizarAhora, reintentarFallidos, estadoNube,
    addProducto, updateProducto, deleteProducto, buscarProductoPorCodigo,
    addLote, updateLote, ajustarLotes, retirarLote, addSucursal, updateSucursal, setSucursalActiva,
    productosConLotes, lotesEnriquecidos, resumen, fefoSugeridos,
    perdidasPorMes, distribucionPorCategoria, vencimientosDelMes,
    exportarBackup, importarBackup,
  }), [state, sincronizarAhora, reintentarFallidos, estadoNube,
    addProducto, updateProducto, deleteProducto, buscarProductoPorCodigo,
    addLote, updateLote, ajustarLotes, retirarLote, addSucursal, updateSucursal, setSucursalActiva,
    productosConLotes, lotesEnriquecidos, resumen, fefoSugeridos,
    perdidasPorMes, distribucionPorCategoria, vencimientosDelMes,
    exportarBackup, importarBackup]);

  return (
    <StoreContext.Provider value={valor}>
      <SincronizandoContext.Provider value={sincronizando}>{children}</SincronizandoContext.Provider>
    </StoreContext.Provider>
  );
};

// Aparte del resto: cambia al empezar y al terminar cada sincronización (después de cada venta), y dentro del
// contexto principal redibujaba dos veces todas las pantallas abiertas.
const SincronizandoContext = createContext(false);
export const useSincronizando = () => useContext(SincronizandoContext);

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore debe usarse dentro de StoreProvider');
  return ctx;
}
