// ═══════════════════════════════════════════════════════════════════════════
// Outbox offline-first con FEFO.
// La venta offline se guarda local y al reconectar recalcula FEFO contra el
// stock MÁS RECIENTE de la nube (aplica delta, no pisa cantidad vieja).
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { OutboxItem, CartItem } from '../types';
import { payloadVenta } from './ventas-engine';
import { formatearPlata } from '../../lib/numeros';

const DB_NAME = 'ventas-db';
const DB_VER  = 1;
let db: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (db) { res(db); return; }
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = (e) => {
      const d = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains('productos')) d.createObjectStore('productos', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('lotes'))     d.createObjectStore('lotes',     { keyPath: 'id' });
      if (!d.objectStoreNames.contains('ventas'))    d.createObjectStore('ventas',    { keyPath: 'id' });
      if (!d.objectStoreNames.contains('deudas'))    d.createObjectStore('deudas',    { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings'))  d.createObjectStore('settings',  { keyPath: 'k' });
      if (!d.objectStoreNames.contains('outbox'))    d.createObjectStore('outbox',    { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = (e) => { db = (e.target as IDBOpenDBRequest).result; res(db!); };
    r.onerror   = () => rej(r.error);
  });
}

const tx = (s: string, m: IDBTransactionMode = 'readonly') => db!.transaction(s, m).objectStore(s);
export const idbGetAll = <T,>(s: string): Promise<T[]> =>
  new Promise((res, rej) => { const r = tx(s).getAll(); r.onsuccess = () => res(r.result as T[]); r.onerror = () => rej(r.error); });
export const idbGet = <T,>(s: string, k: IDBValidKey): Promise<T|undefined> =>
  new Promise((res, rej) => { const r = tx(s).get(k); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error); });
export const idbPut = <T,>(s: string, o: T): Promise<void> =>
  new Promise((res, rej) => { const r = tx(s,'readwrite').put(o); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
export const idbAdd = <T,>(s: string, o: T): Promise<void> =>
  new Promise((res, rej) => { const r = tx(s,'readwrite').add(o); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
export const idbDelete = (s: string, k: IDBValidKey): Promise<void> =>
  new Promise((res, rej) => { const r = tx(s,'readwrite').delete(k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
export const idbClear = (s: string): Promise<void> =>
  new Promise((res, rej) => { const r = tx(s,'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

export async function enqueueOutbox(kind: OutboxItem['kind'], payload: unknown): Promise<void> {
  await idbAdd('outbox', { kind, payload, createdAt: Date.now(), retries: 0 });
  if (kind === 'venta') window.dispatchEvent(new Event(EVENTO_VENTA_PENDIENTE));
}

// ─── Stock único sin internet ─────────────────────────────────────────────────
// Mercadería (StoreContext) descuenta lo vendido que todavía no llegó al servidor. Al subir
// la venta, la cola y los lotes se releen juntos en el mismo sync: nunca cuenta dos veces.
export const EVENTO_VENTA_PENDIENTE = 'stockly:venta-pendiente';

/** Unidades por producto de las ventas encoladas (sin internet o en cuarentena) de una sucursal. */
export function unidadesPendientes(items: OutboxItem[], sucursalId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== 'venta') continue;
    const v = it.payload as OfflineVentaPayload;
    if (v.sucursalId !== sucursalId) continue;
    for (const c of v.cart) {
      if (c.productoId.startsWith('libre-')) continue; // monto suelto: sin stock
      m.set(c.productoId, (m.get(c.productoId) ?? 0) + c.qty);
    }
  }
  return m;
}

export async function leerUnidadesPendientes(sucursalId: string): Promise<Map<string, number>> {
  await openDB();
  return unidadesPendientes(await idbGetAll<OutboxItem>('outbox'), sucursalId);
}

export interface OfflineVentaPayload {
  ventaId: string;
  comercioId: string;
  sucursalId: string;
  usuario: string | null;
  metodoPago: string;
  cliente: string;
  fiado: boolean;
  descuento: number;
  total: number;
  fecha: number;
  cart: CartItem[];
}

// Anulación de venta encolada offline (el RPC es idempotente por venta_id).
export interface OfflineAnulacionPayload {
  ventaId: string;
  comercioId: string;
  usuario: string | null;
  fecha?: number;       // cuándo se devolvió la plata (la salida de caja va ese día, no cuando vuelve la señal)
  sucursalId?: string;  // el local donde se devolvió
}

// Pago de fiado encolado offline (idempotente por pagoId).
export interface OfflinePagoPayload {
  pagoId: string;
  deudaId: string;
  comercioId: string;
  monto: number;
  usuario: string | null;
  fecha: number;
  sucursalId?: string;  // el local donde entró la plata
  cliente?: string;     // para el aviso, si resulta que ya estaba pagado
}

// ─── Plata para devolver ──────────────────────────────────────────────────────
// Lo que se cobró o anuló sin internet y, al subir, resulta que hay que devolverle al cliente. Antes el cobro se
// descartaba sin avisar: la clienta pagaba dos veces y en la caja "sobraba" plata.
export interface AvisoDevolver { id: string; texto: string; monto: number; fecha: number }
const CLAVE_AVISOS = 'avisos-devolver';

export async function leerAvisosDevolver(): Promise<AvisoDevolver[]> {
  await openDB();
  try { return JSON.parse((await getLocalSetting(CLAVE_AVISOS)) || '[]'); } catch { return []; }
}
async function anotarAvisoDevolver(a: AvisoDevolver): Promise<void> {
  const lista = await leerAvisosDevolver();
  if (!lista.some(x => x.id === a.id)) await setLocalSetting(CLAVE_AVISOS, JSON.stringify([...lista, a]));
}
export async function quitarAvisoDevolver(id: string): Promise<void> {
  await setLocalSetting(CLAVE_AVISOS, JSON.stringify((await leerAvisosDevolver()).filter(x => x.id !== id)));
}

// ─── Flush con guarda contra solapamiento ─────────────────────────────────────
let flushing = false;
// Tope ALTO: el transitorio se reintenta muchas veces; el permanente va a cuarentena ya.
const MAX_INTENTOS = 50;

// Errores que no se resuelven reintentando (validación/RLS/constraint) → cuarentena directa.
export function esErrorPermanente(msg?: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return ['no pertenece', 'no autorizado', 'permission denied', 'row-level security',
          'violates', 'duplicate key', 'invalid input', 'constraint', 'inexistente', 'inválid']
    .some(p => m.includes(p));
}

/** Sin señal, Wi-Fi sin salida, servidor que no contesta o sesión cerrada: no es culpa del dato, así que no
 *  cuenta como intento (antes, una hora así mandaba todas las ventas a cuarentena). */
export function esErrorDeRed(msg?: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return ['failed to fetch', 'networkerror', 'network request failed', 'load failed', 'fetch failed',
          'timeout', 'aborted', 'sin sesión'].some(p => m.includes(p));
}

/** `esperan`: productos que todavía no subieron de Mercadería. Sus ventas quedan para la próxima pasada: si llegaban
 *  antes que la mercadería salían como "vendido sin stock" a nombre del cajero, o el servidor las rechazaba. */
export async function flushOutbox(esperan: Set<string> = new Set()): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let processed = 0;
  try {
    // Sin sesión el servidor rechaza todo como "no autorizado" y cada venta se iba a cuarentena. Con tiempo límite: con
    // Wi-Fi sin salida justo cuando toca renovar la sesión, la cola no se volvía a mandar por minutos.
    const sesion = await Promise.race([
      supabase.auth.getSession().then(r => r.data.session),
      new Promise<null>(r => setTimeout(() => r(null), 15000)),
    ]);
    if (!sesion) return 0;
    const items: OutboxItem[] = await idbGetAll('outbox');
    items.sort((a, b) => a.createdAt - b.createdAt);
    for (const item of items) {
      if (item.bloqueado) continue; // en cuarentena: no se reintenta hasta acción manual
      if (item.kind === 'venta' && (item.payload as OfflineVentaPayload).cart.some(c => esperan.has(c.productoId))) continue;
      try {
        // Con tiempo límite: con Wi-Fi sin salida el pedido quedaba colgado y la cola no se volvía a mandar nunca.
        // Si el servidor igual lo aplicó, reintentarlo no duplica (todo va por id).
        await Promise.race([
          (async () => {
            if (item.kind === 'venta')      await syncVentaOffline(item.payload as OfflineVentaPayload);
            if (item.kind === 'anulacion')  await syncAnulacionOffline(item.payload as OfflineAnulacionPayload);
            if (item.kind === 'pago_fiado') await syncPagoOffline(item.payload as OfflinePagoPayload);
            if (item.kind === 'cierre' || item.kind === 'caja_mov') await syncFilaCaja(item.kind, item.payload as FilaCaja);
          })(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timeout (20 s)')), 20000)),
        ]);
        // La venta ya quedó en el servidor: borrar su copia local para que no siga
        // contando en "ventas de hoy" offline los días siguientes (store 'ventas').
        if (item.kind === 'venta') await idbDelete('ventas', (item.payload as OfflineVentaPayload).ventaId);
        await idbDelete('outbox', item.id!);
        processed++;
      } catch (err) {
        // NUNCA se borra una venta no confirmada: se pone en cuarentena (se conserva).
        const msg = err instanceof Error ? err.message : String(err);
        if (esErrorDeRed(msg)) break; // sin red: el resto tampoco va a salir, se reintenta en la próxima
        const retries = item.retries + 1;
        const bloqueado = esErrorPermanente(msg) || retries >= MAX_INTENTOS;
        await idbPut('outbox', { ...item, retries, error: msg, bloqueado });
      }
    }
  } finally {
    flushing = false;
  }
  return processed;
}

// Cantidad de ventas en cuarentena (para mostrar en la UI).
export async function contarBloqueados(): Promise<number> {
  const items: OutboxItem[] = await idbGetAll('outbox');
  return items.filter(i => i.bloqueado).length;
}

// Saca de cuarentena todas las ventas para reintentarlas.
export async function reintentarBloqueados(): Promise<void> {
  const items: OutboxItem[] = await idbGetAll('outbox');
  for (const it of items) {
    if (it.bloqueado) await idbPut('outbox', { ...it, bloqueado: false, retries: 0 });
  }
}

// ─── Sincronizar venta offline vía RPC atómica e idempotente ──────────────────
// Reenvía la venta con su id fijo: la función registrar_venta calcula FEFO contra
// el stock MÁS reciente con lock de filas, y si la venta ya se aplicó (id existe),
// no la reprocesa. Reintentar es seguro: no duplica items ni descuenta de más.
async function syncVentaOffline(p: OfflineVentaPayload): Promise<void> {
  const { error } = await supabase.rpc('registrar_venta', {
    p: payloadVenta(
      {
        comercioId: p.comercioId, sucursalId: p.sucursalId, usuario: p.usuario,
        metodoPago: p.metodoPago, cliente: p.cliente, fiado: p.fiado,
        descuento: p.descuento, cart: p.cart,
      },
      p.ventaId,
      new Date(p.fecha).toISOString(),
    ),
  });
  if (error) throw new Error(error.message);
}

// Anulación: el RPC devuelve `duplicada: true` si ya estaba anulada → reintentar es seguro.
async function syncAnulacionOffline(p: OfflineAnulacionPayload): Promise<void> {
  const { data, error } = await supabase.rpc('anular_venta', {
    p: { venta_id: p.ventaId, comercio_id: p.comercioId, usuario: p.usuario, sucursal_id: p.sucursalId,
         ...(p.fecha ? { fecha: new Date(p.fecha).toISOString() } : {}) },
  });
  if (error) throw new Error(error.message);
  const devuelto = Number((data as { devuelto?: number } | null)?.devuelto ?? 0);
  if (devuelto > 0) {
    await anotarAvisoDevolver({ id: p.ventaId, monto: devuelto, fecha: Date.now(),
      texto: `Venta anulada sin internet: si todavía no lo hiciste, devolvé ${formatearPlata(devuelto)}. Quedó anotado como salida de caja.` });
  }
}

// Pago de fiado: idempotente por pago_id (on conflict do nothing en el server).
async function syncPagoOffline(p: OfflinePagoPayload): Promise<void> {
  const { data, error } = await supabase.rpc('registrar_pago_fiado', {
    p: {
      pago_id: p.pagoId, deuda_id: p.deudaId, comercio_id: p.comercioId, sucursal_id: p.sucursalId,
      monto: p.monto, usuario: p.usuario, fecha: new Date(p.fecha).toISOString(),
    },
  });
  if (error) throw new Error(error.message);
  // El servidor nunca cobra más que el saldo: si otro equipo ya lo cobró, se anotó menos (o nada) y hay que devolver.
  const r = (data ?? {}) as { sin_saldo?: boolean; duplicado?: boolean; cobrado?: number };
  const cobrado = r.sin_saldo ? 0 : r.cobrado;
  if (!r.duplicado && cobrado !== undefined && cobrado < p.monto) {
    const devolver = Math.round((p.monto - cobrado) * 100) / 100;
    await anotarAvisoDevolver({ id: p.pagoId, monto: devolver, fecha: Date.now(),
      texto: `${p.cliente ?? 'Un cliente'} ya había pagado en otro equipo: devolvele ${formatearPlata(devolver)}.` });
  }
}

// ─── Caja: cierres y entradas/salidas de plata ────────────────────────────────
// Antes se mandaban directo y, sin internet, el cierre se perdía y el turno se cerraba igual.
// Llevan id propio: reintentar no duplica (on conflict do nothing).
export type FilaCaja = Record<string, unknown> & { id: string };
const tablaCaja = (k: 'cierre' | 'caja_mov') => (k === 'cierre' ? 'ventas_cierres' : 'ventas_caja_mov');

async function syncFilaCaja(kind: 'cierre' | 'caja_mov', fila: FilaCaja): Promise<void> {
  const { error } = await supabase.from(tablaCaja(kind)).upsert(fila, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/** Con internet va directo; sin internet (o si se corta) queda en la cola y se manda sola. */
export async function guardarFilaCaja(kind: 'cierre' | 'caja_mov', fila: FilaCaja): Promise<{ ok: boolean; enCola?: boolean; error?: string }> {
  if (navigator.onLine) {
    try {
      await syncFilaCaja(kind, fila);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (esErrorPermanente(msg)) return { ok: false, error: msg };
    }
  }
  await openDB();
  await enqueueOutbox(kind, fila);
  return { ok: true, enCola: true };
}

/** Filas de caja que todavía están en la cola (para mostrarlas junto con las del servidor). */
export async function filasCajaEnCola(kind: 'cierre' | 'caja_mov'): Promise<FilaCaja[]> {
  await openDB();
  return (await idbGetAll<OutboxItem>('outbox')).filter(i => i.kind === kind).map(i => i.payload as FilaCaja);
}

/**
 * Ventas locales (offline) que son de HOY según el reloj del dispositivo.
 * La copia offline guarda `fecha` como epoch ms. Se usa solo sin internet; con
 * conexión, "ventas de hoy" sale del servidor filtrada por fecha.
 */
export function ventasLocalesDeHoy<T extends { fecha: number | string }>(items: T[], ahora: Date = new Date()): T[] {
  const inicio = new Date(ahora); inicio.setHours(0, 0, 0, 0);
  const desde = inicio.getTime();
  const hasta = desde + 24 * 60 * 60 * 1000;
  return items.filter((v) => {
    const t = typeof v.fecha === 'number' ? v.fecha : new Date(v.fecha).getTime();
    return Number.isFinite(t) && t >= desde && t < hasta;
  });
}

export async function getLocalSetting(k: string): Promise<string> {
  const r = await idbGet<{ k: string; v: string }>('settings', k);
  return r?.v ?? '';
}
export async function setLocalSetting(k: string, v: string): Promise<void> {
  await idbPut('settings', { k, v });
}
