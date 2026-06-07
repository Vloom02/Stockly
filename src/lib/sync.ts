import { supabase } from './supabase';
import {
  obtenerPendientes, quitarDeOutbox, actualizarIntentos,
  put, setMeta, getMeta, ItemOutbox, TablaSync,
} from './localDb';

/**
 * Motor de sincronización offline-first.
 *
 * SUBIR (push): vacía la outbox contra Supabase.
 * BAJAR (pull): trae cambios remotos desde la última sincronización.
 *
 * Estrategia de conflictos: last-write-wins por timestamp.
 * Los movimientos son inmutables (solo insert) → nunca generan conflicto.
 */

const MAX_INTENTOS = 5;

// Mapeo camelCase (app) → snake_case (Supabase)
function aSnake(tabla: TablaSync, payload: any, comercioId: string): any {
  switch (tabla) {
    case 'productos':
      return {
        id: payload.id, comercio_id: comercioId, nombre: payload.nombre,
        codigo_barras: payload.codigoBarras ?? null, categoria: payload.categoria,
        precio: payload.precio, dias_aviso_default: payload.diasAvisoDefault,
        activo: payload.activo ?? true,
      };
    case 'lotes':
      return {
        id: payload.id, comercio_id: comercioId, producto_id: payload.productoId,
        sucursal_id: payload.sucursalId, cantidad: payload.cantidad,
        fecha_vencimiento: payload.fechaVencimiento, dias_aviso: payload.diasAviso,
        fecha_ingreso: payload.fechaIngreso, proveedor: payload.proveedor ?? null,
        numero_lote: payload.numeroLote ?? null, retirado: payload.retirado ?? false,
      };
    case 'sucursales':
      return {
        id: payload.id, comercio_id: comercioId, nombre: payload.nombre,
        direccion: payload.direccion ?? null, activa: payload.activa ?? true,
      };
    case 'movimientos':
      return {
        id: payload.id, comercio_id: comercioId, lote_id: payload.loteId ?? null,
        producto_id: payload.productoId, sucursal_id: payload.sucursalId,
        tipo: payload.tipo, cantidad: payload.cantidad,
        cantidad_anterior: payload.cantidadAnterior, cantidad_nueva: payload.cantidadNueva,
        usuario: payload.usuario ?? null, notas: payload.notas ?? null,
        fecha: payload.fecha,
      };
  }
}

/**
 * SUBIR: procesa la cola de cambios pendientes.
 * Devuelve cuántos se sincronizaron OK.
 */
const TAMANO_LOTE = 100; // registros por tanda

export async function subirPendientes(comercioId: string): Promise<number> {
  const pendientes = await obtenerPendientes();
  if (pendientes.length === 0) return 0;

  let exitosos = 0;
  let ultimoError: string | null = null;

  // Separar: upserts (insert/update) se agrupan por tabla; deletes van aparte
  const upserts = pendientes.filter(p => p.operacion !== 'delete');
  const deletes = pendientes.filter(p => p.operacion === 'delete');

  // ── Subir upserts agrupados por tabla, en lotes de 100 ──
  const porTabla: Record<string, ItemOutbox[]> = {};
  for (const item of upserts) {
    (porTabla[item.tabla] ||= []).push(item);
  }

  for (const tabla of Object.keys(porTabla)) {
    const items = porTabla[tabla];
    for (let i = 0; i < items.length; i += TAMANO_LOTE) {
      const tanda = items.slice(i, i + TAMANO_LOTE);
      const filas = tanda.map(it => aSnake(it.tabla as TablaSync, it.payload, comercioId));
      try {
        const { error } = await conTimeout(
          Promise.resolve(supabase.from(tabla).upsert(filas, { onConflict: 'id' })),
          15000, `subir lote ${tabla}`
        );
        if (error) {
          ultimoError = error.message;
          for (const it of tanda) await manejarFallo(it);
        } else {
          for (const it of tanda) { await quitarDeOutbox(it.id); exitosos++; }
        }
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : 'Error al subir lote';
        for (const it of tanda) await manejarFallo(it);
      }
    }
  }

  // ── Deletes (soft-delete) de a uno: son pocos ──
  for (const item of deletes) {
    try {
      const err = await procesarItem(item, comercioId);
      if (!err) { await quitarDeOutbox(item.id); exitosos++; }
      else { ultimoError = err; await manejarFallo(item); }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : 'Error al borrar';
      await manejarFallo(item);
    }
  }

  // Reportar error si quedó algo sin subir por un problema real
  const quedanPendientes = await obtenerPendientes();
  if (quedanPendientes.length > 0 && ultimoError) {
    throw new Error('Supabase: ' + ultimoError);
  }

  return exitosos;
}

async function procesarItem(item: ItemOutbox, comercioId: string): Promise<string | null> {
  const { tabla, operacion, payload, registroId } = item;

  // Timeout por item (8s): si uno se cuelga, no traba a los demás
  const conTimeoutItem = <T>(p: PromiseLike<T>): Promise<T> =>
    Promise.race([
      Promise.resolve(p),
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Timeout del item (8s)')), 8000)),
    ]);

  if (operacion === 'delete') {
    // Para "borrar" usamos soft-delete (activo/retirado = false), no DELETE real
    const { error } = await conTimeoutItem(
      supabase.from(tabla).update(
        tabla === 'lotes' ? { retirado: true } : { activo: false }
      ).eq('id', registroId)
    );
    return error ? error.message : null;
  }

  // insert o update → upsert (idempotente, seguro ante reintentos)
  const fila = aSnake(tabla, payload, comercioId);
  const { error } = await conTimeoutItem(
    supabase.from(tabla).upsert(fila, { onConflict: 'id' })
  );
  return error ? error.message : null;
}

async function manejarFallo(item: ItemOutbox) {
  if (item.intentos + 1 >= MAX_INTENTOS) {
    // Después de muchos intentos, lo dejamos pero no bloqueamos la cola
    console.error('Item descartado tras máximos intentos', item);
    await quitarDeOutbox(item.id);
  } else {
    await actualizarIntentos(item);
  }
}

/**
 * BAJAR: trae cambios remotos desde la última sincronización.
 * Actualiza IndexedDB local con lo que cambió en otros dispositivos.
 */
export async function bajarCambios(comercioId: string): Promise<void> {
  const ultimaSync = await getMeta('ultima-sync');
  const desde = ultimaSync || '1970-01-01T00:00:00Z';

  // Pull INCREMENTAL: solo lo modificado desde la última sync (usa updated_at,
  // que mantiene un trigger en Supabase). Antes bajaba TODO en cada sync.
  // movimientos son inserts inmutables → se filtran por `fecha`.
  const [prods, lotes, sucs, movs] = await Promise.all([
    supabase.from('productos').select('*').eq('comercio_id', comercioId).gt('updated_at', desde),
    supabase.from('lotes').select('*').eq('comercio_id', comercioId).gt('updated_at', desde),
    supabase.from('sucursales').select('*').eq('comercio_id', comercioId).gt('updated_at', desde),
    supabase.from('movimientos').select('*').eq('comercio_id', comercioId)
      .gt('fecha', desde).order('fecha', { ascending: false }).limit(500),
  ]);

  // Si Supabase devolvió error en alguna tabla, lo reportamos (no fallar en silencio)
  const errSupa = prods.error || lotes.error || sucs.error || movs.error;
  if (errSupa) {
    throw new Error('Supabase: ' + (errSupa.message || 'error al traer datos'));
  }

  // Actualizar local (mapeando a camelCase via los mappers del store)
  if (prods.data) {
    for (const r of prods.data) await put('productos', mapProductoLocal(r));
  }
  if (lotes.data) {
    for (const r of lotes.data) await put('lotes', mapLoteLocal(r));
  }
  if (sucs.data) {
    for (const r of sucs.data) await put('sucursales', mapSucursalLocal(r));
  }
  if (movs.data) {
    for (const r of movs.data) await put('movimientos', mapMovimientoLocal(r));
  }

  // Avanzar el watermark al MAYOR timestamp visto (no al reloj del cliente):
  // evita perder filas por desfase de reloj cliente↔servidor. Solo avanza.
  let maxTs = desde;
  const considerar = (ts?: string | null) => { if (ts && ts > maxTs) maxTs = ts; };
  for (const r of prods.data ?? []) considerar((r as any).updated_at);
  for (const r of lotes.data ?? []) considerar((r as any).updated_at);
  for (const r of sucs.data ?? [])  considerar((r as any).updated_at);
  for (const r of movs.data ?? [])  considerar((r as any).fecha);
  if (maxTs !== desde) await setMeta('ultima-sync', maxTs);
}

// Mappers DB → local (camelCase)
const mapProductoLocal = (r: any) => ({
  id: r.id, comercioId: r.comercio_id, nombre: r.nombre,
  codigoBarras: r.codigo_barras ?? undefined, categoria: r.categoria,
  precio: Number(r.precio), diasAvisoDefault: r.dias_aviso_default,
  activo: r.activo, fechaCreacion: r.creado_en,
});
const mapLoteLocal = (r: any) => ({
  id: r.id, comercioId: r.comercio_id, productoId: r.producto_id,
  sucursalId: r.sucursal_id, cantidad: r.cantidad,
  fechaVencimiento: r.fecha_vencimiento, diasAviso: r.dias_aviso,
  fechaIngreso: r.fecha_ingreso, proveedor: r.proveedor ?? undefined,
  numeroLote: r.numero_lote ?? undefined, retirado: r.retirado,
});
const mapSucursalLocal = (r: any) => ({
  id: r.id, comercioId: r.comercio_id, nombre: r.nombre,
  direccion: r.direccion ?? undefined, activa: r.activa,
});
const mapMovimientoLocal = (r: any) => ({
  id: r.id, comercioId: r.comercio_id, loteId: r.lote_id ?? undefined,
  productoId: r.producto_id, sucursalId: r.sucursal_id, tipo: r.tipo,
  cantidad: r.cantidad, cantidadAnterior: r.cantidad_anterior,
  cantidadNueva: r.cantidad_nueva, usuario: r.usuario ?? '', notas: r.notas ?? undefined,
  fecha: r.fecha,
});

/**
 * Sincronización completa: subir pendientes + bajar cambios.
 */
/**
 * Envuelve una promesa con un timeout. Si tarda más de `ms`, rechaza.
 * Evita que una request colgada deje la sincronización trabada para siempre.
 */
function conTimeout<T>(promesa: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout en ${etiqueta} (${ms}ms)`)), ms)
    ),
  ]);
}

// Guarda anti-solapamiento a nivel módulo: cierra TODOS los caminos de llamada
// (intervalo de 30s, evento online, addSucursal, cada add/update) aunque alguno
// se saltee el guard del contexto. Si ya hay una sync en curso, no arranca otra.
let sincronizando = false;

export async function sincronizar(comercioId: string): Promise<{ subidos: number; error: string | null }> {
  if (!navigator.onLine) return { subidos: 0, error: 'Sin conexión a internet' };
  if (sincronizando) return { subidos: 0, error: null }; // ya hay una sync corriendo
  sincronizando = true;
  try {
    const subidos = await conTimeout(subirPendientes(comercioId), 90000, 'subir');
    await conTimeout(bajarCambios(comercioId), 30000, 'bajar');
    return { subidos, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.warn('Sincronización interrumpida:', msg);
    return { subidos: 0, error: msg };
  } finally {
    sincronizando = false;
  }
}
