import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./localDb', () => ({}));

import { deltasPendientesPorLote, cambiosReemplazados } from './sync';
import type { ItemOutbox } from './localDb';

const item = (tabla: string, loteId: string | undefined, cantidad: number): ItemOutbox =>
  ({ id: crypto.randomUUID(), tabla, operacion: 'insert', registroId: 'x', payload: { loteId, cantidad }, intentos: 0, creadoEn: 0 }) as ItemOutbox;

describe('deltasPendientesPorLote', () => {
  it('suma los ajustes pendientes por lote (con signo)', () => {
    const m = deltasPendientesPorLote([
      item('ajuste_stock', 'L1', -3), item('ajuste_stock', 'L1', 5), item('ajuste_stock', 'L2', -1),
    ]);
    expect(m.get('L1')).toBe(2);
    expect(m.get('L2')).toBe(-1);
  });

  it('ignora lo que no es ajuste de stock o no tiene lote', () => {
    const m = deltasPendientesPorLote([item('lotes', 'L1', 10), item('movimientos', 'L1', 4), item('ajuste_stock', undefined, 7)]);
    expect(m.size).toBe(0);
  });
});

describe('cambiosReemplazados', () => {
  const cambio = (tabla: string, operacion: string, registroId: string, creadoEn: number, bloqueado = false): ItemOutbox =>
    ({ id: `${registroId}-${creadoEn}`, tabla, operacion, registroId, payload: {}, intentos: 0, creadoEn, bloqueado }) as ItemOutbox;

  it('de varios cambios del mismo registro queda solo el último', () => {
    const items = [cambio('productos', 'update', 'p1', 1), cambio('productos', 'update', 'p1', 3), cambio('productos', 'update', 'p1', 2)];
    expect(cambiosReemplazados(items).map(i => i.creadoEn).sort()).toEqual([1, 2]);
  });

  it('el viejo en cuarentena también se descarta (si no, al reintentarlo pisaría al nuevo)', () => {
    const items = [cambio('productos', 'update', 'p1', 1, true), cambio('productos', 'update', 'p1', 2)];
    expect(cambiosReemplazados(items).map(i => i.creadoEn)).toEqual([1]);
  });

  it('no toca altas, otros registros ni la misma id en otra tabla', () => {
    const items = [
      cambio('lotes', 'insert', 'l1', 1), cambio('lotes', 'update', 'l1', 2),
      cambio('productos', 'update', 'p1', 1), cambio('productos', 'update', 'p2', 2),
      cambio('sucursales', 'update', 'p1', 3),
    ];
    expect(cambiosReemplazados(items)).toEqual([]);
  });
});
