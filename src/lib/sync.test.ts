import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./localDb', () => ({}));

import { deltasPendientesPorLote, fusionarCambios, esperaAlta, cambiosSinSubir } from './sync';
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

describe('fusionarCambios', () => {
  const cambio = (tabla: string, operacion: string, registroId: string, creadoEn: number, payload: Record<string, unknown> = {}, bloqueado = false): ItemOutbox =>
    ({ id: `${registroId}-${creadoEn}`, tabla, operacion, registroId, payload, intentos: 0, creadoEn, bloqueado }) as ItemOutbox;

  it('junta los cambios del mismo registro en el último, con lo más nuevo encima', () => {
    const items = [
      cambio('productos', 'update', 'p1', 1, { precio: 100, nombre: 'Leche' }),
      cambio('productos', 'update', 'p1', 3, { precio: 300 }),
      cambio('productos', 'update', 'p1', 2, { costo: 50, precio: 200 }),
    ];
    const { fusionados, sobran } = fusionarCambios(items);
    expect(sobran.map(i => i.creadoEn).sort()).toEqual([1, 2]);
    expect(fusionados).toHaveLength(1);
    expect(fusionados[0].creadoEn).toBe(3);
    expect(fusionados[0].payload).toEqual({ precio: 300, nombre: 'Leche', costo: 50 });
  });

  it('el viejo en cuarentena también se junta (si no, al reintentarlo pisaría al nuevo)', () => {
    const { sobran } = fusionarCambios([cambio('productos', 'update', 'p1', 1, {}, true), cambio('productos', 'update', 'p1', 2)]);
    expect(sobran.map(i => i.creadoEn)).toEqual([1]);
  });

  it('no toca altas, otros registros ni la misma id en otra tabla', () => {
    const items = [
      cambio('lotes', 'insert', 'l1', 1), cambio('lotes', 'update', 'l1', 2),
      cambio('productos', 'update', 'p1', 1), cambio('productos', 'update', 'p2', 2),
      cambio('sucursales', 'update', 'p1', 3),
    ];
    expect(fusionarCambios(items)).toEqual({ fusionados: [], sobran: [] });
  });
});

describe('esperaAlta', () => {
  const item_ = (tabla: string, operacion: string, registroId: string, payload: Record<string, unknown> = {}) =>
    ({ id: 'x', tabla, operacion, registroId, payload, intentos: 0, creadoEn: 0 }) as ItemOutbox;
  const altas = new Set(['p-nuevo', 'l-nuevo', 's-nuevo']);

  it('un alta no espera por sí misma, pero sí por su producto o local sin subir', () => {
    expect(esperaAlta(item_('lotes', 'insert', 'l-nuevo', { productoId: 'p-viejo', sucursalId: 's-viejo' }), altas)).toBe(false);
    expect(esperaAlta(item_('lotes', 'insert', 'l-2', { productoId: 'p-nuevo', sucursalId: 's-viejo' }), altas)).toBe(true);
    expect(esperaAlta(item_('lotes', 'insert', 'l-3', { productoId: 'p-viejo', sucursalId: 's-nuevo' }), altas)).toBe(true);
  });

  it('cambios, bajas, ajustes y movimientos esperan el alta de lo que tocan', () => {
    expect(esperaAlta(item_('lotes', 'update', 'l-nuevo'), altas)).toBe(true);
    expect(esperaAlta(item_('productos', 'delete', 'p-nuevo'), altas)).toBe(true);
    expect(esperaAlta(item_('ajuste_stock', 'insert', 'm1', { loteId: 'l-nuevo' }), altas)).toBe(true);
    expect(esperaAlta(item_('movimientos', 'insert', 'm2', { productoId: 'p-nuevo', sucursalId: '' }), altas)).toBe(true);
    expect(esperaAlta(item_('movimientos', 'insert', 'm3', { productoId: 'p-viejo', sucursalId: '' }), altas)).toBe(false);
  });
});

describe('cambiosSinSubir', () => {
  const item_ = (tabla: string, operacion: string, registroId: string, creadoEn: number, payload: Record<string, unknown> = {}) =>
    ({ id: `${registroId}-${creadoEn}`, tabla, operacion, registroId, payload, intentos: 0, creadoEn }) as ItemOutbox;

  it('acumula altas y cambios en orden, la baja gana, y deja afuera movimientos y ajustes', () => {
    const m = cambiosSinSubir([
      item_('productos', 'update', 'p1', 2, { precio: 20 }),
      item_('productos', 'insert', 'p1', 1, { nombre: 'Yerba', precio: 10 }),
      item_('productos', 'delete', 'p2', 3),
      item_('ajuste_stock', 'insert', 'm1', 4, { loteId: 'l1', cantidad: -1 }),
      item_('movimientos', 'insert', 'm2', 5),
    ]);
    expect(m.get('productos:p1')).toEqual({ nombre: 'Yerba', precio: 20 });
    expect(m.get('productos:p2')).toBeNull();
    expect(m.size).toBe(2);
  });
});
