import { describe, it, expect } from 'vitest';
import { reducer } from './VentasContext';

const base = { cart: [], outboxLen: 0, bloqueados: 0, isOnline: true, loading: false };
const item = (productoId: string) => ({ productoId, nombre: productoId, codigoBarras: '', precio: 100, qty: 1, stockDisponible: 5 });

describe('carrito (reducer)', () => {
  it('dos escaneos seguidos del mismo y de otro producto no se pisan', () => {
    let s = reducer(base, { type: 'ADD_ITEM', payload: item('a') });
    s = reducer(s, { type: 'ADD_ITEM', payload: item('b') });
    s = reducer(s, { type: 'ADD_ITEM', payload: item('a') });
    expect(s.cart.map(c => [c.productoId, c.qty])).toEqual([['a', 2], ['b', 1]]);
  });

  it('cantidad 0 saca el producto; el resto queda', () => {
    let s = reducer(base, { type: 'ADD_ITEM', payload: item('a') });
    s = reducer(s, { type: 'ADD_ITEM', payload: item('b') });
    s = reducer(s, { type: 'SET_QTY', productoId: 'a', qty: 0 });
    expect(s.cart.map(c => c.productoId)).toEqual(['b']);
  });

  it('el mismo número de pendientes no redibuja', () => {
    const s = { ...base, outboxLen: 2 };
    expect(reducer(s, { type: 'SET_OUTBOX', payload: 2 })).toBe(s);
  });
});
