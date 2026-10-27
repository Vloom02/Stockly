import { describe, it, expect } from 'vitest';
import { rangoDe, resumirVentas, perdidasEntre, VentaRes } from './resumen';
import { Movimiento, Producto } from '../types';

const ahora = new Date(2026, 9, 26, 15, 30); // lunes 26/10/2026, 15:30 (hora local)
const iso = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).toISOString();

describe('rangoDe', () => {
  it('hoy: el día entero, comparado con ayer hasta la misma hora', () => {
    const r = rangoDe('hoy', ahora);
    expect([r.desde, r.hasta]).toEqual([new Date(2026, 9, 26), new Date(2026, 9, 27)]);
    expect([r.anterior.desde, r.anterior.hasta]).toEqual([new Date(2026, 9, 25), new Date(2026, 9, 25, 15, 30)]);
    expect(r.anterior.frase).toBe('ayer a esta hora');
    expect(r.titulo).toBe('Hoy, lunes 26/10/2026');
    expect(r.porTurno).toBe(true);
  });

  it('ayer ya terminó: se compara con anteayer entero', () => {
    const r = rangoDe('ayer', ahora);
    expect([r.anterior.desde, r.anterior.hasta]).toEqual([new Date(2026, 9, 24), new Date(2026, 9, 25)]);
  });

  it('este mes termina hoy y se compara con el mismo tramo del mes anterior', () => {
    const r = rangoDe('mes', ahora);
    expect([r.desde, r.hasta]).toEqual([new Date(2026, 9, 1), new Date(2026, 9, 27)]);
    expect([r.anterior.desde, r.anterior.hasta]).toEqual([new Date(2026, 8, 1), new Date(2026, 8, 26, 15, 30)]);
    expect(r.anterior.frase).toBe('en septiembre hasta el día 26');
  });

  it('mes pasado cruza el año bien y se compara con el mes entero de antes', () => {
    const r = rangoDe('mes-pasado', new Date(2027, 0, 10));
    expect([r.desde, r.hasta]).toEqual([new Date(2026, 11, 1), new Date(2027, 0, 1)]);
    expect(r.titulo).toBe('Diciembre 2026');
    expect([r.anterior.desde, r.anterior.hasta]).toEqual([new Date(2026, 10, 1), new Date(2026, 11, 1)]);
    expect(r.anterior.frase).toBe('en noviembre');
  });

  it('últimos 7 días incluye hoy', () => {
    const r = rangoDe('semana', ahora);
    expect([r.desde, r.hasta]).toEqual([new Date(2026, 9, 20), new Date(2026, 9, 27)]);
  });
});

describe('resumirVentas', () => {
  const r = rangoDe('semana', ahora);
  const v = (id: string, fecha: string, total: number, extra: Partial<VentaRes> = {}): VentaRes =>
    ({ id, fecha, total, descuento: 0, metodo_pago: 'efectivo', usuario: 'Rosa', fiado: false, ...extra });
  const ventas = [
    v('a', iso(2026, 9, 26), 1000),
    v('b', iso(2026, 9, 25), 500, { metodo_pago: 'transferencia', usuario: 'Juan', descuento: 50 }),
    v('c', iso(2026, 9, 25), 300, { anulada: true }),
    v('d', iso(2026, 9, 24), 200, { fiado: true }),
    v('previa', iso(2026, 9, 15), 900),           // período anterior
  ];
  const items = [
    { venta_id: 'a', producto_id: 'p1', nombre_producto: 'Leche', cantidad: 2, subtotal: 1000 },
    { venta_id: 'b', producto_id: 'p2', nombre_producto: 'Pan', cantidad: 1, subtotal: 500 },
    { venta_id: 'c', producto_id: 'p1', nombre_producto: 'Leche', cantidad: 9, subtotal: 300 }, // anulada
    { venta_id: 'd', producto_id: null, nombre_producto: null, cantidad: 1, subtotal: 200 },
  ];
  const res = resumirVentas(ventas, items, { p1: 'Leche 1L' }, r);

  it('totales sin anuladas, con el período anterior aparte', () => {
    expect(res).toMatchObject({ cantidad: 3, total: 1700, descuentos: 50, anuladas: 1, totalAnterior: 900 });
    expect(res.ticketPromedio).toBeCloseTo(566.67, 1);
  });

  it('agrupa por medio de pago (fiado aparte), empleado y producto', () => {
    expect(res.porMetodo.map(f => [f.nombre, f.total])).toEqual([['Efectivo', 1000], ['Transferencia', 500], ['Fiado', 200]]);
    expect(res.porEmpleado.map(f => f.nombre)).toEqual(['Rosa', 'Juan']);
    expect(res.productos).toEqual([
      { nombre: 'Leche 1L', cantidad: 2, total: 1000, ganancia: null },
      { nombre: 'Pan', cantidad: 1, total: 500, ganancia: null },
      { nombre: 'Venta sin producto', cantidad: 1, total: 200, ganancia: null },
    ]);
  });

  it('ganancia con el costo de cada venta, menos descuentos; avisa lo que no tiene costo', () => {
    const g = resumirVentas(ventas, [
      { venta_id: 'a', producto_id: 'p1', nombre_producto: 'Leche', cantidad: 2, subtotal: 1000, costo_unit: 300 },
      { venta_id: 'b', producto_id: 'p2', nombre_producto: 'Pan', cantidad: 1, subtotal: 500, costo_unit: null },
      { venta_id: 'd', producto_id: null, nombre_producto: null, cantidad: 1, subtotal: 200 }, // monto suelto
    ], { p1: 'Leche 1L' }, r);
    // (1000 - 2×300) - 50 de descuento de la venta b
    expect(g.ganancia).toEqual({ total: 350, vendidoConCosto: 1000, margen: 0.35, unidadesSinCosto: 1 });
    expect(g.productos.map(f => [f.nombre, f.ganancia])).toEqual([['Leche 1L', 400], ['Pan', null], ['Venta sin producto', null]]);
  });

  it('un renglón por día del rango, aunque no haya ventas', () => {
    expect(res.porDia).toHaveLength(7);
    expect(res.porDia[6]).toEqual({ nombre: 'Lu 26/10', cantidad: 1, total: 1000 });
    expect(res.porDia[0].total).toBe(0);
  });
});

describe('perdidasEntre', () => {
  it('suma retiros por vencido y roto del período, a precio de venta', () => {
    const prods = [{ id: 'p1', precio: 100 }] as Producto[];
    const mov = (tipo: string, cantidad: number, fecha: string) => ({ tipo, cantidad, fecha, productoId: 'p1' }) as unknown as Movimiento;
    const p = perdidasEntre([
      mov('retiro_vencido', -3, iso(2026, 9, 26)),
      mov('retiro_roto', -1, iso(2026, 9, 26)),
      mov('venta', -5, iso(2026, 9, 26)),
      mov('retiro_vencido', -9, iso(2026, 8, 1)), // fuera del rango
    ], prods, new Date(2026, 9, 1), new Date(2026, 10, 1));
    expect(p).toEqual({ vencido: { unidades: 3, valor: 300 }, roto: { unidades: 1, valor: 100 } });
  });
});
