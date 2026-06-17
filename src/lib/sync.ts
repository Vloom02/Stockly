import { supabase } from './supabase';
import {
  obtenerPendientes, quitarDeOutbox, actualizarIntentos, bloquearItem,
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

// Tope ALTO: el transitorio (red/timeout) se reintenta muchas veces antes de ir
// a cuarentena; el permanente (validación/RLS) va a cuarentena de inmediato.
const MAX_INTENTOS = 50;

// Mapeo camelCase (app) → snake_case (Supabase).
// esUpdate=true en lotes OMITE cantidad/retirado: el stock se cambia por delta
// atómico (ajustar_stock), nunca por upsert (así no pisa lo que descontó Ventas).
function aSnake(tabla: TablaSync, payload: any, comercioId: string, esUpdate = false): any {
  switch (tabla) {
    case 'productos':
      return {
        id: payload.id, comercio_id: comercioId, nombre: payload.nombre,
        codigo_barras: payload.codigoBarras ?? null, categoria: payload.categoria,
        precio: payload.precio, dias_aviso_default: payload.diasAvisoDefault,
        proveedor: payload.proveedor ?? null,
        activo: payload.activo ?? true,
      };
    case 'lotes': {
      const fila: any = {
        id: payload.id, comercio_id: comercioId, producto_id: payload.productoId,
        sucursal_id: payload.sucursalId,
        fecha_vencimiento: payload.fechaVencimiento, dias_aviso: payload.diasAviso,
        fecha_ingreso: payload.fechaIngreso, proveedor: payload.proveedor ?? null,
        numero_lote: payload.numeroLote ?? null,
      };
      if (!esUpdate) {
        fila.cantidad = payload.cantidad;
        fila.retirado = payload.retirado ?? false;
      }
      return fila;
    }
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

  // Separar por tipo. Orden de proceso: 1) upserts (para que el lote exista),
  // 2) ajustes de stock por delta (RPC), 3) deletes.
  const ajustes = pendientes.filter(p => p.tabla === 'ajuste_stock');
  const upserts = pendientes.filter(p => p.tabla !== 'ajuste_stock' && p.operacion !== 'delete');
  const deletes = pendientes.filter(p => p.tabla !== 'ajuste_stock' && p.operacion === 'delete');

  // ── Subir upserts en lotes de 100. Los lotes se separan insert/update porque
  //    en update se omiten cantidad/retirado (columnas distintas en el upsert). ──
  const grupos: Record<string, ItemOutbox[]> = {};
  for (const item of upserts) {
    const key = item.tabla === 'lotes'
      ? `lotes:${item.operacion === 'update' ? 'update' : 'insert'}`
      : item.tabla;
    (grupos[key] ||= []).push(item);
  }

  for (const key of Object.keys(grupos)) {
    const items = grupos[key];
    const tabla = key.startsWith('lotes:') ? 'lotes' : key;
    const esUpdate = key === 'lotes:update';
    for (let i = 0; i < items.length; i += TAMANO_LOTE) {
      const tanda = items.slice(i, i + TAMANO_LOTE);
      const filas = tanda.map(it => aSnake(tabla as TablaSync, it.payload, comercioId, esUpdate));
      try {
        const { error } = await conTimeout(
          Promise.resolve(supabase.from(tabla).upsert(filas, { onConflict: 'id' })),
          15000, `subir ${key}`
        );
        if (error) {
          ultimoError = error.message;
          for (const it of tanda) await manejarFallo(it, ultimoError ?? undefined);
        } else {
          for (const it of tanda) { await quitarDeOutbox(it.id); exitosos++; }
        }
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : 'Error al subir lote';
        for (const it of tanda) await manejarFallo(it, ultimoError ?? undefined);
      }
    }
  }

  // ── Ajustes de stock por DELTA atómico (RPC idempotente). De a uno. ──
  for (const item of ajustes) {
    const mov: any = item.payload;
    const pRpc = {
      mov_id: mov.id, comercio_id: comercioId, lote_id: mov.loteId,
      producto_id: mov.productoId, sucursal_id: mov.sucursalId, tipo: mov.tipo,
      delta: mov.cantidad, cantidad_anterior: mov.cantidadAnterior,
      usuario: mov.usuario ?? null, notas: mov.notas ?? null, fecha: mov.fecha,
    };
    try {
      const { error } = await conTimeout(
        Promise.resolve(supabase.rpc('ajustar_stock', { p: pRpc })),
        15000, 'ajustar_stock'
      );
      if (error) { ultimoError = error.message; await manejarFallo(item, ultimoError ?? undefined); }
      else { await quitarDeOutbox(item.id); exitosos++; }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : 'Error al ajustar stock';
      await manejarFallo(item, ultimoError ?? undefined);
    }
  }

  // ── Deletes (soft-delete) de a uno: son pocos ──
  for (const item of deletes) {
    try {
      const err = await procesarItem(item, comercioId);
      if (!err) { await quitarDeOutbox(item.id); exitosos++; }
      else { ultimoError = err; await manejarFallo(item, ultimoError ?? undefined); }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : 'Error al borrar';
      await manejarFallo(item, ultimoError ?? undefined);
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
  const fila = aSnake(tabla as TablaSync, payload, comercioId, operacion === 'update');
  const { error } = await conTimeoutItem(
    supabase.from(tabla).upsert(fila, { onConflict: 'id' })
  );
  return error ? error.message : null;
}

// Errores que NO se resuelven reintentando (validación, RLS, constraint): van
// directo a cuarentena. El resto (red, timeout, 5xx) se reintenta.
function esErrorPermanente(msg?: string): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return ['no pertenece', 'no autorizado', 'permission denied', 'row-level security',
          'violates', 'duplicate key', 'invalid input', 'constraint', 'inexistente']
    .some(p => m.includes(p));
}

// NUNCA borra un item no confirmado. Si el error es permanente o se superó el
// máximo de reintentos, lo pone en CUARENTENA (se conserva) para reintento manual.
async function manejarFallo(item: ItemOutbox, error?: string) {
  if (esErrorPermanente(error) || item.intentos + 1 >= MAX_INTENTOS) {
    console.warn('Item en cuarentena (no se pierde):', item.tabla, error);
    await bloquearItem(item, error);
  } else {
    await actualizarIntentos(item, error);
  }
}

/**
 * BAJAR: trae cambios remotos desde la última sincronización.
 * Actualiza IndexedDB local con lo que cambió en otros dispositivos.
 */
export async function bajarCambios(comercioId: string): Promise<void> {
  const ultimaSync = await getMeta('ultima-sync');
  const desdeBase = ultimaSync || '1970-01-01T00:00:00Z';
  // Overlap de 1s: re-bajamos una ventana chica para no perder filas cuyo timestamp
  // sea EXACTAMENTE el watermark (el filtro es > estricto) ni por empates de timestamp.
  // Los put locales son idempotentes (upsert por id), así re-bajar no duplica.
  const desde = new Date(new Date(desdeBase).getTime() - 1000).toISOString();

  // Pull INCREMENTAL: productos/lotes/sucursales por updated_at (trigger server);
  // movimientos por creado_en (timestamp del SERVIDOR, no el reloj del cliente).
  const [prods, lotes, sucs] = await Promise.all([
    supabase.from('productos').select('*').eq('comercio_id', comercioId).gt('updated_at', desde),
    supabase.from('lotes').select('*').eq('comercio_id', comercioId).gt('updated_at', desde),
    supabase.from('sucursales').select('*').eq('comercio_id', comercioId).gt('updated_at', desde),
  ]);

  // Movimientos: PAGINADO ascendente por creado_en (antes el tope de 500 perdía los
  // más viejos). gte + dedupe por id tolera que varios movimientos compartan creado_en
  // (p.ej. los que inserta una misma venta en una sola transacción).
  const PAGINA = 1000;
  const movsData: any[] = [];
  const vistos = new Set<string>();
  let movsError: { message?: string } | null = null;
  let cursor = desde;
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await supabase.from('movimientos').select('*')
      .eq('comercio_id', comercioId).gte('creado_en', cursor)
      .order('creado_en', { ascending: true }).limit(PAGINA);
    if (error) { movsError = error; break; }
    if (!data || data.length === 0) break;
    let nuevos = 0;
    for (const r of data) { if (!vistos.has(r.id)) { vistos.add(r.id); movsData.push(r); nuevos++; } }
    cursor = data[data.length - 1].creado_en;
    if (data.length < PAGINA) break;
    if (nuevos === 0) break; // toda la página comparte timestamp → cortar (evita loop)
  }

  // Si Supabase devolvió error en alguna tabla, lo reportamos (no fallar en silencio)
  const errSupa = prods.error || lotes.error || sucs.error || movsError;
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
  for (const r of movsData) await put('movimientos', mapMovimientoLocal(r));

  // Watermark = mayor timestamp del SERVIDOR visto, comparado por EPOCH (no como
  // string: ISO con distinto offset/decimales no ordenan lexicográficamente bien).
  let maxEpoch = new Date(desdeBase).getTime();
  let maxIso = desdeBase;
  const considerar = (ts?: string | null) => {
    if (!ts) return;
    const t = new Date(ts).getTime();
    if (Number.isFinite(t) && t > maxEpoch) { maxEpoch = t; maxIso = ts; }
  };
  for (const r of prods.data ?? []) considerar((r as any).updated_at);
  for (const r of lotes.data ?? []) considerar((r as any).updated_at);
  for (const r of sucs.data ?? [])  considerar((r as any).updated_at);
  for (const r of movsData)         considerar((r as any).creado_en);
  if (maxIso !== desdeBase) await setMeta('ultima-sync', maxIso);
}

// Mappers DB → local (camelCase)
const mapProductoLocal = (r: any) => ({
  id: r.id, comercioId: r.comercio_id, nombre: r.nombre,
  codigoBarras: r.codigo_barras ?? undefined, categoria: r.categoria,
  precio: Number(r.precio), diasAvisoDefault: r.dias_aviso_default,
  proveedor: r.proveedor ?? undefined,
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
