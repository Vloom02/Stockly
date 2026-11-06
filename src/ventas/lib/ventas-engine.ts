// ═══════════════════════════════════════════════════════════════════════════
// Búsquedas del catálogo y venta con internet. El descuento de stock (lo que vence antes,
// primero) lo hace la función registrar_venta del servidor.
// Regla acordada: si no hay stock suficiente, SE VENDE IGUAL (queda en negativo).
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase';
import { Producto, CartItem } from '../types';

export function uuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Estas consultas TIRAN el error (Supabase lo devuelve sin tirar): así quien llama usa lo
// guardado en el celular, en vez de decir "no encontrado" con la señal floja.

// ─── Buscar producto por código de barras ─────────────────────────────────────
export async function buscarProductoPorCodigo(comercioId: string, codigoBarras: string): Promise<Producto | null> {
  const { data, error } = await supabase
    .from('productos').select('*')
    .eq('comercio_id', comercioId).eq('codigo_barras', codigoBarras).eq('activo', true)
    .limit(1); // con maybeSingle, dos productos con el mismo código daban error
  if (error) throw new Error(error.message);
  return (data?.[0] ?? null) as Producto | null;
}

// ─── Buscar productos por nombre (fallback del escáner) ───────────────────────
export async function buscarProductosPorNombre(comercioId: string, query: string): Promise<Producto[]> {
  const { data, error } = await supabase
    .from('productos').select('*')
    .eq('comercio_id', comercioId).eq('activo', true)
    .ilike('nombre', `%${query}%`).limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []) as Producto[];
}

// ─── Aplicar venta online vía RPC atómica registrar_venta ─────────────────────
// Toda la venta (cabecera + items + descuento FEFO de lotes + movimientos) ocurre
// en UNA transacción del lado servidor, con lock de filas e idempotencia por id.
// Elimina los bugs de doble-descuento / overselling / venta a medias.
export interface AplicarVentaInput {
  comercioId: string;
  sucursalId: string;
  usuario: string | null;
  metodoPago: string;
  cliente: string;
  fiado: boolean;
  descuento: number;
  cart: CartItem[];
  /** id de venta fijo (para reintentos idempotentes desde el outbox). */
  ventaId?: string;
}

export interface AplicarVentaResult {
  ventaId: string;
  total: number;
  faltantes: { nombre: string; faltante: number }[];
}

interface RegistrarVentaResp {
  venta_id?: string;
  total?: number;
  duplicada?: boolean;
  faltantes?: { nombre: string; faltante: number }[];
}

/** Construye el payload jsonb que espera la función registrar_venta(p). */
/** `fechaISO` solo para la venta guardada sin internet: con internet manda la hora del servidor (una tablet con la
 *  fecha atrasada metía todas las ventas en otro día). */
export function payloadVenta(input: AplicarVentaInput, ventaId: string, fechaISO?: string) {
  return {
    id: ventaId,
    comercio_id: input.comercioId,
    sucursal_id: input.sucursalId,
    usuario: input.usuario,
    metodo_pago: input.metodoPago,
    cliente: input.cliente,
    fiado: input.fiado,
    descuento: input.descuento,
    ...(fechaISO ? { fecha: fechaISO } : {}),
    items: input.cart.map((c) => ({
      // Los items de "venta rápida" (monto libre) usan un id sintético 'libre-…'
      // y viajan sin producto_id → el server los registra sin descontar stock.
      producto_id: c.productoId.startsWith('libre-') ? null : c.productoId,
      nombre: c.nombre, cantidad: c.qty, precio: c.precio,
      ...(c.costo != null && c.costo >= 0 ? { costo: c.costo } : {}),
    })),
  };
}

export async function aplicarVentaOnline(input: AplicarVentaInput): Promise<AplicarVentaResult> {
  const ventaId = input.ventaId ?? uuid();
  const { data, error } = await supabase.rpc('registrar_venta', {
    p: payloadVenta(input, ventaId),
  });
  if (error) throw new Error(error.message);

  const res = (data ?? {}) as RegistrarVentaResp;
  return {
    ventaId: res.venta_id ?? ventaId,
    total: res.total ?? 0,
    faltantes: res.faltantes ?? [],
  };
}
