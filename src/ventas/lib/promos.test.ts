import { describe, it, expect } from 'vitest';
import { descuentoPromos, Promo } from './promos';
import type { CartItem } from '../types';

const item = (productoId: string, nombre: string, precio: number, qty: number): CartItem =>
  ({ productoId, nombre, precio, qty } as CartItem);

describe('descuentoPromos', () => {
  const promos: Promo[] = [
    { productoId: 'a', tipo: '2x1', minCant: 2, pct: 0 },
    { productoId: 'b', tipo: 'pct_cantidad', minCant: 3, pct: 10 },
  ];

  it('2x1: cada 2 unidades una es gratis', () => {
    expect(descuentoPromos([item('a', 'Coca', 100, 2)], promos).monto).toBe(100);
    expect(descuentoPromos([item('a', 'Coca', 100, 3)], promos).monto).toBe(100); // 3 → 1 gratis
    expect(descuentoPromos([item('a', 'Coca', 100, 5)], promos).monto).toBe(200); // 5 → 2 gratis
  });

  it('2x1 con 1 sola unidad no descuenta', () => {
    expect(descuentoPromos([item('a', 'Coca', 100, 1)], promos).monto).toBe(0);
  });

  it('pct_cantidad: aplica solo desde minCant', () => {
    expect(descuentoPromos([item('b', 'Yerba', 200, 2)], promos).monto).toBe(0);
    expect(descuentoPromos([item('b', 'Yerba', 200, 3)], promos).monto).toBe(60); // 600 * 10%
  });

  it('producto sin promo no descuenta y suma varias promos', () => {
    const r = descuentoPromos(
      [item('a', 'Coca', 100, 2), item('b', 'Yerba', 200, 3), item('c', 'Pan', 50, 4)],
      promos,
    );
    expect(r.monto).toBe(160);
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas.map(l => l.etiqueta)).toEqual(['2x1', '−10% x3+']);
  });

  it('sin promos devuelve 0', () => {
    expect(descuentoPromos([item('a', 'Coca', 100, 4)], []).monto).toBe(0);
  });

  it('redondea a 2 decimales', () => {
    const r = descuentoPromos([item('b', 'Yerba', 33.33, 3)], promos);
    expect(r.monto).toBe(10); // 99.99 * 10% = 9.999 → 10
  });
});

describe('oferta por vencer', () => {
  const item = { productoId: 'p', nombre: 'Yogur', precio: 1000, qty: 1 } as never;
  it('descuenta desde la primera unidad y le gana a otra promo del mismo producto', () => {
    const r = descuentoPromos([item], [
      { productoId: 'p', tipo: 'liquidacion', minCant: 1, pct: 30, hasta: '2026-11-05' },
      { productoId: 'p', tipo: '2x1', minCant: 2, pct: 0 },
    ], '2026-10-30');
    expect(r.monto).toBe(300);
  });
  it('pasada la fecha no descuenta (aunque esté guardada sin internet)', () => {
    expect(descuentoPromos([item], [{ productoId: 'p', tipo: 'liquidacion', minCant: 1, pct: 30, hasta: '2026-10-29' }], '2026-10-30').monto).toBe(0);
  });
});
