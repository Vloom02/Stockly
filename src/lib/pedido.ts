// Pedido sugerido: cuánto pedir de cada producto para cubrir N días según lo que se vendió,
// y como piso el stock mínimo (reponer hasta el doble). Los negativos suman a lo que falta.
import { ProductoConLotes } from '../types';
import { fechaLocalISO } from './vencimientos';

export interface ItemPedido { nombre: string; sugerido: number; tenes: number; porSemana: number; }

/** `vendido`: unidades por producto en los últimos `diasVentas` días (vacío sin internet: solo mínimo).
 *  Lo vencido no cuenta como "tenés": no se puede vender, y con eso el pedido se quedaba corto. */
export function pedidoSugerido(productos: ProductoConLotes[], vendido: Map<string, number>, diasVentas: number, diasCobertura: number, hoy = fechaLocalISO()): Map<string, ItemPedido[]> {
  const grupos = new Map<string, ItemPedido[]>();
  for (const p of productos) {
    const porDia = (vendido.get(p.producto.id!) ?? 0) / diasVentas;
    const vencido = (p.lotes ?? []).reduce((s, l) => s + (l.cantidad > 0 && l.fechaVencimiento < hoy ? l.cantidad : 0), 0);
    const tenes = p.cantidadTotal - vencido;
    const min = p.producto.stockMinimo ?? 0;
    const bajoMinimo = min > 0 && tenes < min;
    const meta = Math.max(Math.ceil(porDia * diasCobertura), bajoMinimo ? min * 2 : 0);
    const sugerido = meta - tenes;
    if (sugerido <= 0 || (porDia === 0 && !bajoMinimo)) continue;
    const prov = p.producto.proveedor?.trim() || 'Sin proveedor';
    const item = { nombre: p.producto.nombre, sugerido, tenes, porSemana: Math.round(porDia * 7 * 10) / 10 };
    grupos.set(prov, [...(grupos.get(prov) ?? []), item]);
  }
  for (const items of grupos.values()) items.sort((a, b) => b.sugerido - a.sugerido);
  return new Map([...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'es')));
}
