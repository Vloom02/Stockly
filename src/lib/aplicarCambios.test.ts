import { describe, it, expect } from 'vitest';
import { aplicarPorId, sumarMovimientos } from './aplicarCambios';

describe('aplicarPorId', () => {
  const a = { id: 'a', n: 1 }, b = { id: 'b', n: 2 };

  it('sin nada nuevo o con filas iguales devuelve la MISMA lista (las pantallas no recalculan)', () => {
    const lista = [a, b];
    expect(aplicarPorId(lista, [])).toBe(lista);
    expect(aplicarPorId(lista, [{ id: 'a', n: 1 }])).toBe(lista);
  });

  it('cambia solo lo que cambió y conserva el resto', () => {
    const r = aplicarPorId([a, b], [{ id: 'b', n: 9 }]);
    expect(r).toEqual([a, { id: 'b', n: 9 }]);
    expect(r[0]).toBe(a);
  });

  it('agrega lo nuevo y saca lo que ya no sigue (dado de baja)', () => {
    const sigue = (x: { id: string; n: number }) => x.n > 0;
    expect(aplicarPorId([a, b], [{ id: 'a', n: 0 }, { id: 'c', n: 3 }, { id: 'd', n: 0 }], sigue)).toEqual([b, { id: 'c', n: 3 }]);
  });
});

describe('sumarMovimientos', () => {
  const m = (id: string, fecha: string) => ({ id, fecha });

  it('intercala en orden, del más nuevo al más viejo, sin repetir', () => {
    const lista = [m('c', '2026-11-03'), m('a', '2026-11-01')];
    expect(sumarMovimientos(lista, [m('a', '2026-11-01'), m('b', '2026-11-02'), m('d', '2026-11-04')]).map(x => x.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('si no hay nada nuevo devuelve la MISMA lista', () => {
    const lista = [m('a', '2026-11-01')];
    expect(sumarMovimientos(lista, [m('a', '2026-11-01')])).toBe(lista);
  });
});
