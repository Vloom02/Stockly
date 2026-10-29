import { describe, it, expect } from 'vitest';
import { totalesPorMetodo, fondoDeApertura, arqueo } from './caja';

const v = (total: number, metodo_pago = 'efectivo', fiado = false, anulada = false) => ({ total, metodo_pago, fiado, anulada });

describe('caja', () => {
  it('lo fiado va aparte y lo anulado no suma', () => {
    expect(totalesPorMetodo([v(1000), v(5000, 'efectivo', true), v(2000, 'efectivo', false, true), v(300, 'qr')]))
      .toEqual({ efectivo: 1000, fiado: 5000, qr: 300 });
  });

  it('si se corrigió el fondo, vale la última apertura de cada turno', () => {
    expect(fondoDeApertura([
      { tipo: 'apertura', monto: 0, fecha: '2026-10-29T10:00:00Z', turno_desde: 'a' },
      { tipo: 'apertura', monto: 5000, fecha: '2026-10-29T10:05:00Z', turno_desde: 'a' },
      { tipo: 'apertura', monto: 2000, fecha: '2026-10-29T15:00:00Z', turno_desde: 'b' },
    ])).toBe(7000);
  });

  it('esperado = fondo + ventas en efectivo + entradas − salidas + cobros de fiado', () => {
    const r = arqueo(
      [v(1000), v(5000, 'efectivo', true), v(2000, 'efectivo', false, true)],
      [{ tipo: 'apertura', monto: 3000 }, { tipo: 'ingreso', monto: 500 }, { tipo: 'egreso', monto: 800 }],
      1200,
    );
    expect(r.esperado).toBe(3000 + 1000 + 500 - 800 + 1200);
  });

  it('sin apertura registrada usa el fondo declarado a mano', () => {
    expect(arqueo([v(100)], [], 0, 2000).esperado).toBe(2100);
  });
});
