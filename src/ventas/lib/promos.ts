// ═══════════════════════════════════════════════════════════════════════════
// Promociones del POS — lógica pura (la config vive en ventas_promos).
//   '2x1'          → cada 2 unidades del producto, 1 gratis.
//   'pct_cantidad' → llevando >= minCant unidades, pct% de descuento en ellas.
//   'liquidacion'  → lo que está por vencer: pct% desde la primera unidad, hasta el día que vence.
// El descuento total de promos se suma al campo `descuento` de la venta.
// ═══════════════════════════════════════════════════════════════════════════
import type { CartItem } from '../types';

export interface Promo {
  productoId: string;
  tipo: '2x1' | 'pct_cantidad' | 'liquidacion';
  minCant: number;
  pct: number;
  hasta?: string; // YYYY-MM-DD, solo liquidación (con lo guardado sin internet no se pasa de la fecha)
}

export interface LineaPromo { nombre: string; etiqueta: string; monto: number; }

export interface ResultadoPromos { monto: number; lineas: LineaPromo[]; }

/** Calcula el descuento por promos para el carrito actual. */
export function descuentoPromos(cart: CartItem[], promos: Promo[], hoy = new Date().toLocaleDateString('sv-SE')): ResultadoPromos {
  // La oferta por vencer va al final: si un producto tiene las dos, gana esa.
  const vigentes = promos.filter(p => p.tipo !== 'liquidacion' || (p.hasta ?? '') >= hoy)
    .sort((a, b) => Number(a.tipo === 'liquidacion') - Number(b.tipo === 'liquidacion'));
  const porProducto = new Map(vigentes.map(p => [p.productoId, p]));
  const lineas: LineaPromo[] = [];
  for (const item of cart) {
    const promo = porProducto.get(item.productoId);
    if (!promo) continue;
    let monto = 0;
    let etiqueta = '';
    if (promo.tipo === 'liquidacion') {
      monto = (item.precio * item.qty * promo.pct) / 100;
      etiqueta = `Por vencer −${promo.pct}%`;
    } else if (promo.tipo === '2x1') {
      const gratis = Math.floor(item.qty / 2);
      if (gratis > 0) { monto = gratis * item.precio; etiqueta = '2x1'; }
    } else if (item.qty >= promo.minCant && promo.pct > 0) {
      monto = (item.precio * item.qty * promo.pct) / 100;
      etiqueta = `−${promo.pct}% x${promo.minCant}+`;
    }
    if (monto > 0) lineas.push({ nombre: item.nombre, etiqueta, monto: redondear(monto) });
  }
  return { monto: redondear(lineas.reduce((s, l) => s + l.monto, 0)), lineas };
}

const redondear = (n: number) => Math.round(n * 100) / 100;
