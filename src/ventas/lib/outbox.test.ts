import { describe, it, expect } from 'vitest';
import { esErrorPermanente, ventasLocalesDeHoy, unidadesPendientes } from './outbox';
import type { CartItem, OutboxItem } from '../types';

describe('esErrorPermanente (clasificación para cuarentena)', () => {
  it('marca como permanentes los errores de validación/RLS/constraint', () => {
    expect(esErrorPermanente('producto del item no pertenece al comercio')).toBe(true);
    expect(esErrorPermanente('comercio no autorizado')).toBe(true);
    expect(esErrorPermanente('permission denied for table lotes')).toBe(true);
    expect(esErrorPermanente('new row violates row-level security policy')).toBe(true);
    expect(esErrorPermanente('duplicate key value violates unique constraint')).toBe(true);
    expect(esErrorPermanente('invalid input syntax for type uuid')).toBe(true);
    expect(esErrorPermanente('lote inexistente o de otro comercio')).toBe(true);
    expect(esErrorPermanente('precio inválido')).toBe(true);
    expect(esErrorPermanente('descuento inválido')).toBe(true);
  });

  it('NO marca como permanentes los errores transitorios (red/timeout)', () => {
    expect(esErrorPermanente('Failed to fetch')).toBe(false);
    expect(esErrorPermanente('NetworkError when attempting to fetch resource')).toBe(false);
    expect(esErrorPermanente('Timeout del item (8s)')).toBe(false);
    expect(esErrorPermanente('503 Service Unavailable')).toBe(false);
    expect(esErrorPermanente(undefined)).toBe(false);
    expect(esErrorPermanente('')).toBe(false);
  });

  it('es case-insensitive', () => {
    expect(esErrorPermanente('COMERCIO NO AUTORIZADO')).toBe(true);
    expect(esErrorPermanente('Permission Denied')).toBe(true);
  });
});

describe('ventasLocalesDeHoy (ventas offline del día)', () => {
  const base = new Date('2026-10-26T15:00:00'); // hora local fija
  const ms = (d: string) => new Date(d).getTime();

  it('deja solo las de hoy y descarta otros días', () => {
    const items = [
      { id: 'a', fecha: ms('2026-10-26T09:00:00') }, // hoy
      { id: 'b', fecha: ms('2026-10-25T23:59:00') }, // ayer
      { id: 'c', fecha: ms('2026-10-26T00:00:00') }, // hoy, arranque del día (incluido)
      { id: 'd', fecha: ms('2026-10-27T00:00:00') }, // mañana (excluido)
    ];
    expect(ventasLocalesDeHoy(items, base).map(v => v.id)).toEqual(['a', 'c']);
  });

  it('tolera fecha ISO y descarta valores inválidos', () => {
    const items = [
      { id: 'a', fecha: '2026-10-26T10:00:00' },
      { id: 'b', fecha: 'no-es-fecha' },
    ];
    expect(ventasLocalesDeHoy(items, base).map(v => v.id)).toEqual(['a']);
  });
});

describe('unidadesPendientes (Mercadería descuenta lo vendido sin internet)', () => {
  const venta = (sucursalId: string, cart: Partial<CartItem>[], extra: Partial<OutboxItem> = {}): OutboxItem =>
    ({ kind: 'venta', createdAt: 0, retries: 0, payload: { sucursalId, cart }, ...extra }) as OutboxItem;

  it('suma por producto las ventas de la sucursal, también las en cuarentena', () => {
    const m = unidadesPendientes([
      venta('s1', [{ productoId: 'polenta', qty: 2 }, { productoId: 'leche', qty: 1 }]),
      venta('s1', [{ productoId: 'polenta', qty: 3 }], { bloqueado: true }),
      venta('s2', [{ productoId: 'polenta', qty: 9 }]),             // otra sucursal
      { kind: 'pago_fiado', createdAt: 0, retries: 0, payload: {} }, // no es venta
    ], 's1');
    expect(Object.fromEntries(m)).toEqual({ polenta: 5, leche: 1 });
  });

  it('los montos sueltos no descuentan stock', () => {
    expect(unidadesPendientes([venta('s1', [{ productoId: 'libre-123', qty: 1 }])], 's1').size).toBe(0);
  });
});
