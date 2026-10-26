// ═══════════════════════════════════════════════════════════════════════════
// Outbox offline-first con FEFO.
// La venta offline se guarda local y al reconectar recalcula FEFO contra el
// stock MÁS RECIENTE de la nube (aplica delta, no pisa cantidad vieja).
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { OutboxItem, CartItem, Lote } from '../types';
import { payloadVenta, calcularFefo } from './ventas-engine';

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
}

// Pago de fiado encolado offline (idempotente por pagoId).
export interface OfflinePagoPayload {
  pagoId: string;
  deudaId: string;
  comercioId: string;
  monto: number;
  usuario: string | null;
  fecha: number;
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

export async function flushOutbox(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let processed = 0;
  try {
    const items: OutboxItem[] = await idbGetAll('outbox');
    items.sort((a, b) => a.createdAt - b.createdAt);
    for (const item of items) {
      if (item.bloqueado) continue; // en cuarentena: no se reintenta hasta acción manual
      try {
        if (item.kind === 'venta')      await syncVentaOffline(item.payload as OfflineVentaPayload);
        if (item.kind === 'anulacion')  await syncAnulacionOffline(item.payload as OfflineAnulacionPayload);
        if (item.kind === 'pago_fiado') await syncPagoOffline(item.payload as OfflinePagoPayload);
        // La venta ya quedó en el servidor: borrar su copia local para que no siga
        // contando en "ventas de hoy" offline los días siguientes (store 'ventas').
        if (item.kind === 'venta') await idbDelete('ventas', (item.payload as OfflineVentaPayload).ventaId);
        await idbDelete('outbox', item.id!);
        processed++;
      } catch (err) {
        // NUNCA se borra una venta no confirmada: se pone en cuarentena (se conserva).
        const msg = err instanceof Error ? err.message : String(err);
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
  const { error } = await supabase.rpc('anular_venta', {
    p: { venta_id: p.ventaId, comercio_id: p.comercioId, usuario: p.usuario },
  });
  if (error) throw new Error(error.message);
}

// Pago de fiado: idempotente por pago_id (on conflict do nothing en el server).
async function syncPagoOffline(p: OfflinePagoPayload): Promise<void> {
  const { error } = await supabase.rpc('registrar_pago_fiado', {
    p: {
      pago_id: p.pagoId, deuda_id: p.deudaId, comercio_id: p.comercioId,
      monto: p.monto, usuario: p.usuario, fecha: new Date(p.fecha).toISOString(),
    },
  });
  if (error) throw new Error(error.message);
}

// ─── Cache catálogo + lotes para vender offline ───────────────────────────────
// Una sola transacción: si la app se cierra a mitad de camino, IndexedDB
// descarta todo y queda el catálogo anterior (nunca uno vacío o a medias).
export async function cacheCatalogo(productos: unknown[], lotes: unknown[]): Promise<void> {
  await openDB();
  await new Promise<void>((res, rej) => {
    const t = db!.transaction(['productos', 'lotes'], 'readwrite');
    const sp = t.objectStore('productos');
    const sl = t.objectStore('lotes');
    sp.clear(); sl.clear();
    for (const p of productos) sp.put(p);
    for (const l of lotes)     sl.put(l);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

/**
 * Descuenta del cache local de lotes lo vendido offline (FEFO, igual que el server),
 * para que el stock mostrado no quede viejo hasta reconectar. Devuelve solo los
 * lotes que cambiaron. Al sincronizar, el server recalcula y el cache se reemplaza.
 */
export function descontarLotesLocales(lotes: Lote[], cart: CartItem[]): Lote[] {
  const cambiados: Lote[] = [];
  for (const item of cart) {
    const delProducto = lotes
      .filter(l => l.producto_id === item.productoId && !l.retirado && l.cantidad > 0)
      .sort((a, b) => (a.fecha_vencimiento ?? '9999').localeCompare(b.fecha_vencimiento ?? '9999'));
    for (const d of calcularFefo(delProducto, item.qty)) {
      const lote = delProducto.find(l => l.id === d.loteId)!;
      lote.cantidad = d.cantidadNueva;
      if (!cambiados.includes(lote)) cambiados.push(lote);
    }
  }
  return cambiados;
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
