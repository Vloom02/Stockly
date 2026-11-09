import { supabase } from './supabase';
import {
  obtenerPendientes, quitarDeOutbox, actualizarIntentos, bloquearItem,
  put, putVarios, getAll, setMeta, getMeta, ItemOutbox, TablaSync,
} from './localDb';
// Errores que no se resuelven reintentando (validación, RLS) y cortes de red: el mismo criterio que la cola de ventas.
import { esErrorPermanente, esErrorDeRed } from '../ventas/lib/outbox';

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
// Columnas de un producto que se pueden cambiar (camelCase → snake_case).
const COLUMNAS_PRODUCTO: [string, string][] = [
  ['nombre', 'nombre'], ['codigoBarras', 'codigo_barras'], ['categoria', 'categoria'], ['precio', 'precio'],
  ['diasAvisoDefault', 'dias_aviso_default'], ['proveedor', 'proveedor'], ['stockMinimo', 'stock_minimo'],
  ['costo', 'costo'], ['fotoUrl', 'foto_url'],
];
// Lo mismo para lotes (nunca cantidad ni retirado: el stock va por delta) y locales.
const COLUMNAS_LOTE: [string, string][] = [
  ['fechaVencimiento', 'fecha_vencimiento'], ['diasAviso', 'dias_aviso'], ['fechaIngreso', 'fecha_ingreso'],
  ['proveedor', 'proveedor'], ['numeroLote', 'numero_lote'],
];
const COLUMNAS_SUCURSAL: [string, string][] = [['nombre', 'nombre'], ['direccion', 'direccion'], ['activa', 'activa']];

const parcheDe = (payload: any, columnas: [string, string][]) => {
  const parche: any = {};
  for (const [k, col] of columnas) if (k in payload) parche[col] = payload[k] ?? (k === 'stockMinimo' ? 0 : null);
  return parche;
};

function aSnake(tabla: TablaSync, payload: any, comercioId: string, esUpdate = false): any {
  switch (tabla) {
    case 'productos': {
      // Un cambio manda solo los campos que trae: dos equipos que tocan campos distintos ya no se pisan
      // (los cambios viejos traen la fila entera y también sirven).
      if (esUpdate) return parcheDe(payload, COLUMNAS_PRODUCTO);
      const fila: any = {
        id: payload.id, comercio_id: comercioId, nombre: payload.nombre,
        codigo_barras: payload.codigoBarras ?? null, categoria: payload.categoria,
        precio: payload.precio, dias_aviso_default: payload.diasAvisoDefault,
        proveedor: payload.proveedor ?? null,
        stock_minimo: payload.stockMinimo ?? 0,
        costo: payload.costo ?? null,
        foto_url: payload.fotoUrl ?? null,
      };
      // Un cambio no manda `activo`: editar sin internet un producto que otro equipo borró lo revivía.
      if (!esUpdate) fila.activo = payload.activo ?? true;
      return fila;
    }
    case 'lotes':
      // El cambio de un lote subía la fila entera: contar la mercadería en un equipo devolvía a la fecha vieja un
      // vencimiento que otro equipo acababa de corregir.
      if (esUpdate) return parcheDe(payload, COLUMNAS_LOTE);
      return {
        id: payload.id, comercio_id: comercioId, producto_id: payload.productoId,
        sucursal_id: payload.sucursalId,
        fecha_vencimiento: payload.fechaVencimiento, dias_aviso: payload.diasAviso,
        fecha_ingreso: payload.fechaIngreso, proveedor: payload.proveedor ?? null,
        numero_lote: payload.numeroLote ?? null,
        cantidad: payload.cantidad,
        retirado: payload.retirado ?? false,
      };
    case 'sucursales':
      // Renombrar sin internet un local que otro equipo borró lo revivía (mandaba `activa: true`).
      if (esUpdate) return parcheDe(payload, COLUMNAS_SUCURSAL);
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
const TANDA_MAXIMA = 100; // registros por tanda
// Con señal muy floja 100 filas no entran en el tiempo límite y la misma tanda se reintentaba para siempre: al
// pasarse de tiempo se achica, y vuelve a crecer cuando entra.
let tamanoTanda = TANDA_MAXIMA;

// Orden de subida por dependencias: el local y el producto antes que el lote, el lote antes
// que su movimiento. Antes se subía en el orden de la cola y una FK fallida iba a cuarentena.
const ORDEN_TABLAS: TablaSync[] = ['sucursales', 'productos', 'lotes', 'movimientos'];

/** Agrupa altas y cambios por tabla y operación (cada tanda manda las mismas columnas), en orden de dependencias. */
export function agruparParaSubir(items: ItemOutbox[]): [string, ItemOutbox[]][] {
  const grupos = new Map<string, ItemOutbox[]>();
  for (const t of ORDEN_TABLAS) for (const op of ['insert', 'update']) grupos.set(`${t}:${op}`, []);
  for (const it of items) grupos.get(`${it.tabla}:${it.operacion}`)?.push(it);
  return [...grupos].filter(([, g]) => g.length > 0);
}

/** Junta los cambios de un mismo registro en el último (los anteriores sobran): cada uno trae lo que cambió
 *  (productos) o la fila entera (lotes, locales), así que el último encima de los anteriores es el estado final.
 *  Dos del mismo id en un upsert hacían fallar la tanda entera ("cannot affect row a second time"); uno viejo en
 *  cuarentena, al reintentarlo, pisaba al nuevo. */
export function fusionarCambios(items: ItemOutbox[]): { fusionados: ItemOutbox[]; sobran: ItemOutbox[] } {
  const porRegistro = new Map<string, ItemOutbox[]>();
  for (const it of items) {
    if (it.operacion !== 'update') continue;
    const k = `${it.tabla}:${it.registroId}`;
    const g = porRegistro.get(k);
    if (g) g.push(it); else porRegistro.set(k, [it]);
  }
  const fusionados: ItemOutbox[] = [];
  const sobran: ItemOutbox[] = [];
  for (const g of porRegistro.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.creadoEn - b.creadoEn);
    const ultimo = g[g.length - 1];
    fusionados.push({ ...ultimo, payload: Object.assign({}, ...g.map(i => i.payload)) });
    sobran.push(...g.slice(0, -1));
  }
  return { fusionados, sobran };
}

/** Ids con el alta todavía en la cola (pendiente o en cuarentena). */
async function altasSinSubir(): Promise<Set<string>> {
  return new Set((await getAll<ItemOutbox>('outbox'))
    .filter(i => i.operacion === 'insert' && (i.tabla === 'productos' || i.tabla === 'lotes' || i.tabla === 'sucursales'))
    .map(i => i.registroId));
}

/** Lo que depende de un alta sin subir espera: un cambio antes del alta del lote lo crearía en 0, y un lote o
 *  movimiento cuyo producto o local no llegó fallaba por la clave foránea y se iba a cuarentena. */
export function esperaAlta(it: ItemOutbox, altas: Set<string>): boolean {
  const p = it.payload ?? {};
  return (it.operacion !== 'insert' && altas.has(it.registroId))
    || [p.productoId, p.sucursalId, p.loteId].some(id => id && altas.has(id));
}

/** Los ajustes por lote, en el orden en que llegan: los de un mismo lote van en orden (un retiro no baja de 0, así
 *  que el orden cambia el resultado); los de lotes distintos pueden ir a la vez. */
export function ajustesPorLote(items: ItemOutbox[]): ItemOutbox[][] {
  const grupos = new Map<string, ItemOutbox[]>();
  for (const it of items) {
    const k = it.payload?.loteId ?? it.id;
    const g = grupos.get(k);
    if (g) g.push(it); else grupos.set(k, [it]);
  }
  return [...grupos.values()];
}

export async function subirPendientes(comercioId: string): Promise<number> {
  // Sin sesión (vencida o cerrada) el servidor ve "anónimo": un cambio no tocaba nada y salía de la cola como subido.
  const { data: { session } } = await conTimeout(supabase.auth.getSession(), 15000, 'sesión');
  if (!session) throw new Error('Sin sesión: los cambios se suben al volver a entrar');

  const { fusionados, sobran } = fusionarCambios(await getAll<ItemOutbox>('outbox'));
  for (const it of fusionados) await put('outbox', it);
  for (const it of sobran) await quitarDeOutbox(it.id);
  // Lo que quedó de otro comercio (cambió la cuenta sin cerrar sesión) no se sube acá adentro.
  const pendientes = (await obtenerPendientes()).filter(it => !it.payload?.comercioId || it.payload.comercioId === comercioId);
  if (pendientes.length === 0) return 0;

  let exitosos = 0;
  let ultimoError: string | null = null;

  // De a uno: aísla el que falla para que no arrastre a cuarentena al resto de su tanda.
  const subirUno = async (it: ItemOutbox) => {
    try {
      const err = await procesarItem(it, comercioId);
      if (!err) { await quitarDeOutbox(it.id); exitosos++; }
      else { ultimoError = err; await manejarFallo(it, err); }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : 'Error al subir';
      await manejarFallo(it, ultimoError);
    }
  };

  // Separar por tipo. Orden de proceso: 1) altas y cambios (para que el lote exista),
  // 2) ajustes de stock por delta (RPC), 3) deletes.
  const ajustes = pendientes.filter(p => p.tabla === 'ajuste_stock');
  const upserts = pendientes.filter(p => p.tabla !== 'ajuste_stock' && p.operacion !== 'delete');
  const deletes = pendientes.filter(p => p.tabla !== 'ajuste_stock' && p.operacion === 'delete');

  for (const [key, todos] of agruparParaSubir(upserts)) {
    const tabla = key.split(':')[0] as TablaSync;
    const esUpdate = key.endsWith(':update');
    const altas = await altasSinSubir(); // se relee por grupo: los locales y productos de recién ya subieron
    const items = todos.filter(it => !esperaAlta(it, altas));
    if (esUpdate) {
      // update (no upsert) y de a uno: son pocos, nunca crean un registro y cada uno manda sus propios campos.
      for (const it of items) await subirUno(it);
      continue;
    }
    for (let i = 0; i < items.length; ) {
      const tanda = items.slice(i, i + tamanoTanda);
      i += tanda.length;
      const filas = tanda.map(it => aSnake(tabla, it.payload, comercioId, esUpdate));
      try {
        // Un alta repetida (la respuesta se perdió y se reintenta) no toca lo que ya está: antes volvía a
        // poner `retirado: false` a un lote que ya se había vendido entero.
        const { error } = await conTimeout(
          Promise.resolve(supabase.from(tabla).upsert(filas, { onConflict: 'id', ignoreDuplicates: !esUpdate })),
          15000, `subir ${key}`
        );
        if (!error) {
          for (const it of tanda) { await quitarDeOutbox(it.id); exitosos++; }
          tamanoTanda = Math.min(TANDA_MAXIMA, tamanoTanda * 2);
        } else if (tanda.length > 1 && esErrorPermanente(error.message)) {
          for (const it of tanda) await subirUno(it);
        } else {
          ultimoError = error.message;
          for (const it of tanda) await manejarFallo(it, ultimoError);
        }
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : 'Error al subir lote';
        if (/timeout/i.test(ultimoError)) tamanoTanda = Math.max(10, Math.floor(tamanoTanda / 2));
        for (const it of tanda) await manejarFallo(it, ultimoError);
      }
    }
  }

  // ── Ajustes de stock por DELTA atómico (RPC idempotente). ──
  const altas = await altasSinSubir();
  const subirAjuste = async (item: ItemOutbox) => {
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
  };
  // De a 6 lotes a la vez: las 300 diferencias de un conteo eran 300 pedidos uno detrás de otro (más de un minuto con
  // señal floja). Los de un mismo lote siguen en orden. Sin red, cada uno corta en su primer error (manejarFallo tira).
  const grupos = ajustesPorLote(ajustes.filter(it => !esperaAlta(it, altas))); // los que esperan el alta del lote, después
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(6, grupos.length) }, async () => {
    while (siguiente < grupos.length) for (const item of grupos[siguiente++]) await subirAjuste(item);
  }));

  // ── Deletes (soft-delete) de a uno: son pocos ──
  for (const item of deletes) if (!esperaAlta(item, altas)) await subirUno(item);

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

  // Un update que no tocó ninguna fila no es un éxito (registro borrado en otro equipo o sin permiso): antes
  // salía de la cola como subido y el cambio se perdía. Va a cuarentena, a la vista.
  const sinFilas = (data: unknown[] | null) => (data && data.length > 0 ? null : 'Registro inexistente o sin permiso (0 filas)');

  if (operacion === 'delete') {
    // Para "borrar" usamos soft-delete (activo/retirado = false), no DELETE real
    const { data, error } = await conTimeoutItem(
      supabase.from(tabla).update(
        tabla === 'lotes' ? { retirado: true } : { activo: false }
      ).eq('id', registroId).select('id')
    );
    return error ? error.message : sinFilas(data);
  }

  // Alta → upsert sin pisar (idempotente ante reintentos). Un cambio es update: un upsert crearía el lote en 0 si el
  // alta no llegó, y cada cambio manda solo los campos que tocó.
  const fila = aSnake(tabla as TablaSync, payload, comercioId, operacion === 'update');
  if (operacion === 'update') {
    if (Object.keys(fila).length === 0) return null; // nada que mandar
    const { data, error } = await conTimeoutItem(supabase.from(tabla).update(fila).eq('id', registroId).select('id'));
    return error ? error.message : sinFilas(data);
  }
  const { error } = await conTimeoutItem(supabase.from(tabla).upsert(fila, { onConflict: 'id', ignoreDuplicates: true }));
  return error ? error.message : null;
}


// NUNCA borra un item no confirmado. Si el error es permanente o se superó el
// máximo de reintentos, lo pone en CUARENTENA (se conserva) para reintento manual.
async function manejarFallo(item: ItemOutbox, error?: string) {
  // Sin red (o Wi-Fi sin salida) no es culpa del cambio: no gasta intentos y se corta la subida entera, en vez de
  // esperar el tiempo límite de cada uno. Antes, en una hora sin salida, todo terminaba en cuarentena.
  // shortcut: un pedido que siempre se pasa de tiempo traba la cola sin ir a cuarentena; si pasa, contar los timeouts.
  if (esErrorDeRed(error)) throw new Error(error);
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
const PAGINA = 1000; // = max_rows de Supabase: pedir más no trae más

/** Todo lo cambiado desde `desde` (por `col`), de a páginas. Sin paginar, con más de 1.000 cambios llegaban
 *  1.000 al azar y el watermark saltaba al resto para siempre. Cada página sigue desde la última fila vista
 *  (col, id) y no por posición: una fila que cambiaba mientras tanto corría a las demás y una se perdía. */
async function traerCambiados(tabla: string, comercioId: string, desde: string, col = 'updated_at',
  alPagina?: (filas: any[]) => Promise<void>): Promise<{ data: any[] | null; error: { message?: string } | null }> {
  const filas: any[] = [];
  for (let ultima: any = null; ;) {
    let q = supabase.from(tabla).select('*').eq('comercio_id', comercioId);
    // El gte sobra para el resultado, pero sin él la consulta recorría todo el comercio desde el principio en cada
    // página (300 ms con 250.000 movimientos; con él, de 2 a 10 ms).
    q = ultima
      ? q.gte(col, ultima[col]).or(`${col}.gt."${ultima[col]}",and(${col}.eq."${ultima[col]}",id.gt.${ultima.id})`)
      : q.gt(col, desde);
    const { data, error } = await conTimeout(Promise.resolve(q.order(col).order('id').limit(PAGINA)), 20000, `bajar ${tabla}`);
    if (error) return { data: null, error };
    if (alPagina && data?.length) await alPagina(data);
    filas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return { data: filas, error: null };
    ultima = data[data.length - 1];
  }
}

/** Stock de un lote con los ajustes locales encima, igual que ajustar_stock en el servidor:
 *  un retiro no lo baja de 0 (ni de donde ya estaba en negativo); un ingreso suma. */
export function cantidadConDelta(cantidad: number, delta: number): number {
  return Math.max(Math.min(cantidad, 0), cantidad + delta);
}

export interface CambiosBajados { productos: any[]; lotes: any[]; sucursales: any[]; movimientos: any[] }
export const sinCambios = (c?: CambiosBajados | null) =>
  !c || (c.productos.length + c.lotes.length + c.sucursales.length + c.movimientos.length) === 0;

type TablaMarca = 'productos' | 'lotes' | 'sucursales' | 'movimientos';
const EPOCA = '1970-01-01T00:00:00Z';

/** Una marca por tabla: con una sola, los movimientos (que se leen después y de a páginas) la adelantaban más allá de
 *  lo que se había leído de lotes, y un lote que cambiaba en ese rato no bajaba nunca a este equipo. */
export async function marcaDe(tabla: TablaMarca): Promise<string> {
  const propia = await getMeta(`ultima-sync:${tabla}`);
  if (propia) return propia;
  // Primera vez con marcas por tabla: los movimientos se leían últimos, la marca vieja les sirve. Lo demás se baja
  // entero una vez, para curar lo que la marca única haya dejado sin bajar.
  return tabla === 'movimientos' ? ((await getMeta('ultima-sync')) ?? EPOCA) : EPOCA;
}

/** Hora en microsegundos: la base las guarda así (clock_timestamp da una distinta a cada fila de una misma carga) y Date
 *  llega al milésimo. Comparando al milésimo, la marca quedaba en la primera fila de ese milésimo y las demás bajaban
 *  en cada pasada. */
function microsDe(h: string): number {
  const t = new Date(h).getTime();
  const frac = /\d{2}:\d{2}:\d{2}\.(\d+)/.exec(h)?.[1] ?? '';
  return Math.floor(t / 1000) * 1e6 + Number(frac.padEnd(6, '0').slice(0, 6));
}

/** Hasta dónde se leyó de esa tabla: el mayor horario de SUS filas, comparado por hora (texto con distinto huso no
 *  ordena bien). Nunca retrocede. */
export function marcaNueva(actual: string, horarios: (string | null | undefined)[]): string {
  let max = actual;
  let maxT = microsDe(actual);
  for (const h of horarios) {
    if (!h) continue;
    const t = microsDe(h);
    if (Number.isFinite(t) && t > maxT) { maxT = t; max = h; }
  }
  return max;
}

// Margen de 10 s: se vuelve a pedir una ventana chica antes de la marca para no perder las filas de una transacción
// que tardó en confirmarse (su hora es de antes del commit). Los put locales son por id, así re-bajar no duplica.
const MARGEN = 10_000;

/** Cómo sigue la lectura de una tabla: desde dónde pedir y lo necesario para saber, después, si la marca quedó completa. */
export interface Seguimiento { base: string; desde: string; conMargen: boolean; pedidaEn: number; vistaEn: number | null }

/** `completa` = la marca que una lectura anterior ya dejó sin nada pendiente: desde ahí no hace falta el margen. */
export function seguimientoDe(base: string, completa: string | null, vistaEn: number | null, ahora: number): Seguimiento {
  const conMargen = completa !== base;
  const desde = conMargen ? new Date(new Date(base).getTime() - MARGEN).toISOString() : base;
  return { base, desde, conMargen, pedidaEn: ahora, vistaEn };
}

/** Una lectura con margen, pedida 10 s o más después de ver la marca y sin nada más nuevo, ya vio todo lo de esa hora
 *  (cualquier transacción de entonces ya estaba confirmada). Sin esto, 300 lotes de un conteo volvían a bajar en cada
 *  pasada, cada 30 s, hasta que llegaba otro cambio, y cada vez se redibujaba la mercadería entera.
 *  shortcut: cuenta con el reloj del equipo; si lo adelantan justo en esos 10 s, la ventana se da por vista antes. */
export function quedaCompleta(s: Seguimiento, final: string): boolean {
  return s.conMargen && final === s.base && s.vistaEn !== null && s.pedidaEn - s.vistaEn >= MARGEN;
}

async function seguimiento(tabla: TablaMarca): Promise<Seguimiento> {
  const [base, completa, vista] = await Promise.all([marcaDe(tabla), getMeta(`marca-completa:${tabla}`), getMeta(`marca-vista:${tabla}`)]);
  return seguimientoDe(base, completa, vista ? Number(vista) : null, Date.now());
}

/** Trae lo cambiado en los otros equipos, lo guarda y lo devuelve (ya con lo propio sin subir encima).
 *  `alAvanzar` recibe los productos, compras y locales apenas se guardan, antes de los movimientos. */
export async function bajarCambios(comercioId: string, alAvanzar?: (c: CambiosBajados) => void): Promise<CambiosBajados> {
  const [sPr, sLo, sSu, sMo] = await Promise.all((['productos', 'lotes', 'sucursales', 'movimientos'] as const).map(seguimiento));
  // Cada vez que la marca se mueve se anota cuándo se vio: recién 10 s después una lectura puede darla por completa.
  const avanzar = async (tabla: TablaMarca, base: string, horarios: (string | null | undefined)[]) => {
    const nueva = marcaNueva(base, horarios);
    if (nueva !== base && !frenada) {
      await setMeta(`ultima-sync:${tabla}`, nueva);
      await setMeta(`marca-vista:${tabla}`, String(Date.now()));
    }
    return nueva;
  };
  const cerrar = async (tabla: TablaMarca, s: Seguimiento, final: string) => {
    if (frenada || final !== s.base) return;
    if (s.vistaEn === null) await setMeta(`marca-vista:${tabla}`, String(Date.now())); // equipos que vienen de antes
    else if (quedaCompleta(s, final)) await setMeta(`marca-completa:${tabla}`, final);
  };

  // Movimientos: por creado_en, con desempate por id. Antes, si más de 1.000 compartían la misma hora (una carga
  // grande en una sola transacción), la página se cortaba ahí y el resto no bajaba nunca.
  // Un equipo nuevo no baja años de historial: lo que muestran las pantallas alcanza con 7 meses (el resto queda en el servidor).
  // Cada página se guarda con su marca al llegar: si se corta, la próxima sigue desde ahí.
  const desdeMo = sMo.base === EPOCA ? new Date(Date.now() - 210 * 86400000).toISOString() : sMo.desde;
  const movimientos: ReturnType<typeof mapMovimientoLocal>[] = [];
  let marcaMo = sMo.base;
  const traerMovimientos = () => traerCambiados('movimientos', comercioId, desdeMo, 'creado_en', async pagina => {
    if (frenada) throw new Error('Sincronización frenada');
    const m = pagina.map(mapMovimientoLocal);
    await putVarios('movimientos', m);
    movimientos.push(...m);
    marcaMo = await avanzar('movimientos', marcaMo, pagina.map((r: any) => r.creado_en));
  });
  // En cada pasada son pocos y van a la vez que el resto (una vuelta menos al servidor). En un equipo nuevo van
  // después: son decenas de páginas y le sacarían señal a lo que hace falta para vender.
  const movsALaVez = sMo.base === EPOCA ? null : traerMovimientos();
  movsALaVez?.catch(() => { /* se ve abajo */ });

  // Pull INCREMENTAL: productos/lotes/sucursales por updated_at (trigger server);
  // movimientos por creado_en (timestamp del SERVIDOR, no el reloj del cliente).
  const [prods, lotes, sucs] = await Promise.all([
    traerCambiados('productos', comercioId, sPr.desde),
    traerCambiados('lotes', comercioId, sLo.desde),
    traerCambiados('sucursales', comercioId, sSu.desde),
  ]);

  // Si Supabase devolvió error en alguna tabla, lo reportamos (no fallar en silencio)
  const errSupa = prods.error || lotes.error || sucs.error;
  if (errSupa) {
    throw new Error('Supabase: ' + (errSupa.message || 'error al traer datos'));
  }

  if (frenada) throw new Error('Sincronización frenada');
  // Lo propio sin subir (pendiente o en cuarentena) va encima de lo del servidor: si no, un cambio hecho sin
  // internet desaparecía de la pantalla hasta subirlo, y un producto borrado acá volvía a aparecer.
  const cola = await getAll<ItemOutbox>('outbox');
  const sinSubir = cambiosSinSubir(cola);
  const conLoPropio = <T extends { id: string }>(tabla: string, fila: T, sacar: string[] = []): T | null => {
    const k = `${tabla}:${fila.id}`;
    if (!sinSubir.has(k)) return fila;
    const propio = sinSubir.get(k);
    if (propio === null) return null; // baja sin subir
    const cambio = { ...propio };
    for (const c of sacar) delete cambio[c];
    return { ...fila, ...cambio };
  };
  const sinNulos = <T,>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);

  // Actualizar local (mapeando a camelCase via los mappers del store)
  const productos = sinNulos((prods.data ?? []).map(r => conLoPropio('productos', mapProductoLocal(r), ['activo'])));
  // La cantidad del servidor todavía no incluye los ajustes locales sin subir
  // (pendientes o en cuarentena): se suman encima para no "deshacerlos" en pantalla.
  const deltaPendiente = deltasPendientesPorLote(cola);
  const lotesLocales = sinNulos((lotes.data ?? []).map(r => {
    // El stock nunca sale de lo propio: viene del servidor más los ajustes sin subir.
    const local = conLoPropio('lotes', mapLoteLocal(r), ['cantidad', 'retirado']);
    if (!local) return null;
    const delta = deltaPendiente.get(local.id);
    if (delta) {
      // Sin recortar a 0: un lote en negativo (vendido sin stock) tiene que seguir viéndose.
      local.cantidad = cantidadConDelta(local.cantidad, delta);
      local.retirado = local.retirado || local.cantidad === 0;
    }
    return local;
  }));
  const sucursales = sinNulos((sucs.data ?? []).map(r => conLoPropio('sucursales', mapSucursalLocal(r))));
  if (frenada) throw new Error('Sincronización frenada');
  await putVarios('productos', productos);
  await putVarios('lotes', lotesLocales);
  await putVarios('sucursales', sucursales);

  await cerrar('productos', sPr, await avanzar('productos', sPr.base, (prods.data ?? []).map((r: any) => r.updated_at)));
  await cerrar('lotes', sLo, await avanzar('lotes', sLo.base, (lotes.data ?? []).map((r: any) => r.updated_at)));
  await cerrar('sucursales', sSu, await avanzar('sucursales', sSu.base, (sucs.data ?? []).map((r: any) => r.updated_at)));
  // Antes todo se guardaba al final: un equipo nuevo con señal floja quedaba vacío minutos (ni Vender encontraba
  // productos) esperando el historial, y si se cortaba volvía a bajar todo de cero.
  alAvanzar?.({ productos, lotes: lotesLocales, sucursales, movimientos: [] });

  const movs = await (movsALaVez ?? traerMovimientos());
  if (movs.error) throw new Error('Supabase: ' + (movs.error.message || 'error al traer datos'));
  await cerrar('movimientos', sMo, marcaMo);
  // Lo ya avisado no se devuelve otra vez: aplicarlo de nuevo al final pisaría en pantalla un cambio hecho mientras
  // bajaban los movimientos.
  return alAvanzar ? { productos: [], lotes: [], sucursales: [], movimientos } : { productos, lotes: lotesLocales, sucursales, movimientos };
}

/** Lo propio que todavía no subió, por "tabla:id": altas y cambios acumulados (el más nuevo encima), o null si
 *  es una baja. Los movimientos y ajustes no cuentan: los ajustes van aparte, por delta. */
export function cambiosSinSubir(items: ItemOutbox[]): Map<string, Record<string, unknown> | null> {
  const m = new Map<string, Record<string, unknown> | null>();
  for (const it of [...items].sort((a, b) => a.creadoEn - b.creadoEn)) {
    if (it.tabla === 'ajuste_stock' || it.tabla === 'movimientos') continue;
    const k = `${it.tabla}:${it.registroId}`;
    m.set(k, it.operacion === 'delete' ? null : { ...(m.get(k) ?? {}), ...it.payload });
  }
  return m;
}

/** Suma, por lote, los deltas de stock encolados que el servidor todavía no aplicó. */
export function deltasPendientesPorLote(items: ItemOutbox[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (it.tabla !== 'ajuste_stock' || !it.payload?.loteId) continue;
    m.set(it.payload.loteId, (m.get(it.payload.loteId) ?? 0) + Number(it.payload.cantidad || 0));
  }
  return m;
}

// Mappers DB → local (camelCase)
const mapProductoLocal = (r: any) => ({
  id: r.id, comercioId: r.comercio_id, nombre: r.nombre,
  codigoBarras: r.codigo_barras ?? undefined, categoria: r.categoria,
  precio: Number(r.precio), diasAvisoDefault: r.dias_aviso_default,
  proveedor: r.proveedor ?? undefined,
  stockMinimo: r.stock_minimo ?? 0,
  costo: r.costo == null ? undefined : Number(r.costo),
  fotoUrl: r.foto_url ?? undefined,
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

type ResultadoSync = { subidos: number; bajados: number; error: string | null; cambios?: CambiosBajados };

// Al cerrar sesión: ninguna pasada en curso vuelve a escribir en el equipo ya limpio (después se recarga).
let frenada = false;
export function frenarSincronizacion(): void { frenada = true; }
/** Espera a que termine la pasada en curso (con tope), para limpiar el equipo sin que vuelva a escribir nada. */
export async function esperarSincronizacion(ms = 5000): Promise<void> {
  if (enCurso) await Promise.race([enCurso, new Promise(r => setTimeout(r, ms))]);
}

// Guarda anti-solapamiento a nivel módulo: cierra TODOS los caminos de llamada (intervalo de 30 s, evento online,
// cada alta o cambio). Se suelta recién cuando termina el trabajo real: antes un tiempo límite la soltaba con la
// subida todavía andando y arrancaba otra encima. Si piden otra mientras corre, se hace UNA más al terminar:
// lo guardado recién pudo quedar afuera de la que estaba corriendo.
let enCurso: Promise<ResultadoSync> | null = null;
let otraMas: Promise<ResultadoSync> | null = null;

export function sincronizar(comercioId: string, alAvanzar?: (c: CambiosBajados) => void): Promise<ResultadoSync> {
  if (frenada) return Promise.resolve({ subidos: 0, bajados: 0, error: null });
  if (!navigator.onLine) return Promise.resolve({ subidos: 0, bajados: 0, error: 'Sin conexión a internet' });
  if (!enCurso) {
    enCurso = pasada(comercioId, alAvanzar).finally(() => { enCurso = null; });
    return enCurso;
  }
  if (!otraMas) otraMas = enCurso.then(() => { otraMas = null; return sincronizar(comercioId, alAvanzar); });
  return otraMas;
}

async function pasada(comercioId: string, alAvanzar?: (c: CambiosBajados) => void): Promise<ResultadoSync> {
  let subidos = 0;
  let error: string | null = null;
  try {
    subidos = await subirPendientes(comercioId);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
    console.warn('Subida interrumpida:', error);
    // Sin red o sin sesión tampoco se puede bajar. Un tiempo límite (una tanda que no entró con señal floja) o un
    // cambio rechazado no frenan lo que llega de los otros equipos.
    if (esErrorDeRed(error) && !/timeout/i.test(error)) return { subidos, bajados: 0, error };
  }
  try {
    const cambios = await bajarCambios(comercioId, alAvanzar);
    const bajados = cambios.productos.length + cambios.lotes.length + cambios.sucursales.length + cambios.movimientos.length;
    return { subidos, bajados, error, cambios };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.warn('Bajada interrumpida:', msg);
    return { subidos, bajados: 0, error: error ?? msg };
  }
}
