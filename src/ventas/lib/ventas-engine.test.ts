import { describe, it, expect } from 'vitest';
import { payloadVenta } from './ventas-engine';
import { CartItem } from '../types';

const item = (productoId: string, qty: number, precio: number): CartItem => ({
  productoId, nombre: 'X', codigoBarras: '', precio, qty, stockDisponible: 0,
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
