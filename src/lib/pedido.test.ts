import { describe, it, expect } from 'vitest';
import { pedidoSugerido, vendidoDesdeMovimientos } from './pedido';
import { ProductoConLotes, Movimiento } from '../types';

const prod = (id: string, cantidadTotal: number, extra: { stockMinimo?: number; proveedor?: string } = {}) =>
  ({ producto: { id, nombre: id, ...extra }, cantidadTotal }) as unknown as ProductoConLotes;

describe('pedidoSugerido', () => {
  it('pide para cubrir los días según lo vendido, contando los negativos', () => {
    // yerba: 28 vendidas en 28 días = 1 por día; para 15 días hacen falta 15; tengo -2 → pedir 17
    const r = pedidoSugerido([prod('yerba', -2, { proveedor: 'Distri' })], new Map([['yerba', 28]]), 28, 15);
    expect(r.get('Distri')).toEqual([{ nombre: 'yerba', sugerido: 17, tenes: -2, porSemana: 7 }]);
  });

  it('sin ventas usa el stock mínimo (reponer hasta el doble); si alcanza, no pide', () => {
    const r = pedidoSugerido([prod('arroz', 1, { stockMinimo: 4 }), prod('fideos', 10), prod('sal', 3, { stockMinimo: 2 })], new Map(), 28, 15);
    expect([...r.entries()]).toEqual([['Sin proveedor', [{ nombre: 'arroz', sugerido: 7, tenes: 1, porSemana: 0 }]]]);
  });

  it('lo vencido no cuenta como que lo tenés', () => {
    const leche = { producto: { id: 'leche', nombre: 'leche' }, cantidadTotal: 10,
      lotes: [{ cantidad: 8, fechaVencimiento: '2026-10-01' }, { cantidad: 2, fechaVencimiento: '2026-12-01' }] } as unknown as ProductoConLotes;
    // 1 por día, 15 días → 15; tengo 2 que sirven (los 8 vencidos no) → pedir 13
    const r = pedidoSugerido([leche], new Map([['leche', 28]]), 28, 15, '2026-10-29');
    expect(r.get('Sin proveedor')).toEqual([{ nombre: 'leche', sugerido: 13, tenes: 2, porSemana: 7 }]);
  });

  it('si lo que hay alcanza para los días, no aparece', () => {
    expect(pedidoSugerido([prod('leche', 30)], new Map([['leche', 28]]), 28, 15).size).toBe(0);
  });
});

describe('vendidoDesdeMovimientos', () => {
  it('suma las ventas del local en el período y resta las devoluciones', () => {
    const mv = (tipo: string, cantidad: number, fecha: string, notas = '', sucursalId = 's1') =>
      ({ tipo, cantidad, fecha, notas, sucursalId, productoId: 'p' }) as unknown as Movimiento;
    const m = vendidoDesdeMovimientos([
      mv('retiro_venta', 3, '2026-10-20'), mv('retiro_venta', 2, '2026-10-21'),
      mv('ajuste', 1, '2026-10-22', 'Devolución venta 1234'), mv('ajuste', 5, '2026-10-22', 'Conteo'),
      mv('retiro_venta', 9, '2026-09-01'), mv('retiro_venta', 4, '2026-10-21', '', 's2'),
    ], 's1', new Date('2026-10-01'));
    expect(m.get('p')).toBe(4);
  });
});
