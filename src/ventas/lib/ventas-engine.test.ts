import { describe, it, expect } from 'vitest';
import { stockTotal, calcularFefo, payloadVenta } from './ventas-engine';
import { Lote, CartItem } from '../types';

const lote = (id: string, cantidad: number, venc: string | null): Lote => ({
  id, comercio_id: 'c', producto_id: 'p', sucursal_id: 's',
  cantidad, fecha_vencimiento: venc, retirado: false,
});

const item = (productoId: string, qty: number, precio: number): CartItem => ({
  productoId, nombre: 'X', codigoBarras: '', precio, qty, stockDisponible: 0,
});

describe('stockTotal', () => {
  it('suma las cantidades de los lotes', () => {
    expect(stockTotal([lote('a', 2, '2027-01-01'), lote('b', 9, '2027-02-01')])).toBe(11);
  });
  it('lista vacía → 0', () => expect(stockTotal([])).toBe(0));
});

describe('calcularFefo', () => {
  it('descuenta del primer lote y continúa con el siguiente (orden FEFO recibido)', () => {
    const lotes = [lote('a', 2, '2027-01-01'), lote('b', 9, '2027-02-01')];
    const d = calcularFefo(lotes, 5);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ loteId: 'a', cantidadDescontada: 2, cantidadNueva: 0 });
    expect(d[1]).toMatchObject({ loteId: 'b', cantidadDescontada: 3, cantidadNueva: 6 });
  });
  it('si no alcanza el stock, descuenta solo lo disponible', () => {
    const d = calcularFefo([lote('a', 2, '2027-01-01')], 5);
    expect(d.reduce((s, x) => s + x.cantidadDescontada, 0)).toBe(2);
  });
  it('sin lotes → sin deducciones', () => {
    expect(calcularFefo([], 3)).toEqual([]);
  });
});

describe('payloadVenta', () => {
  it('arma el payload jsonb que espera la RPC registrar_venta', () => {
    const p = payloadVenta({
      comercioId: 'com', sucursalId: 'suc', usuario: 'u', metodoPago: 'efectivo',
      cliente: '', fiado: false, descuento: 10, cart: [item('p1', 2, 100)],
    }, 'venta-1', '2026-06-08T00:00:00.000Z');
    expect(p).toEqual({
      id: 'venta-1', comercio_id: 'com', sucursal_id: 'suc', usuario: 'u',
      metodo_pago: 'efectivo', cliente: '', fiado: false, descuento: 10,
      fecha: '2026-06-08T00:00:00.000Z',
      items: [{ producto_id: 'p1', nombre: 'X', cantidad: 2, precio: 100 }],
    });
  });
});
