import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./localDb', () => ({}));

import { deltasPendientesPorLote } from './sync';
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
