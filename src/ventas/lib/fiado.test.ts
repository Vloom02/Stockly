import { describe, it, expect } from 'vitest';
import { saldosPorCliente, repartirPago } from './fiado';

describe('fiado por cliente', () => {
  it('junta "Marta" y "marta " y suma lo que se debe, no lo fiado', () => {
    const r = saldosPorCliente([
      { id: 'a', cliente: 'Marta', monto: 1000 },
      { id: 'b', cliente: 'marta ', monto: 500 },
      { id: 'c', cliente: 'Juan', monto: 300 },
    ], { a: 400 });
    expect(r).toEqual([{ cliente: 'Marta', saldo: 1100, deudas: 2 }, { cliente: 'Juan', saldo: 300, deudas: 1 }]);
  });

  it('una entrega a cuenta paga primero lo más viejo', () => {
    const deudas = [{ id: 'nueva', fecha: '2026-10-20', saldo: 500 }, { id: 'vieja', fecha: '2026-10-01', saldo: 300 }];
    expect(repartirPago(deudas, d => d.saldo, 600).map(x => [x.deuda.id, x.monto])).toEqual([['vieja', 300], ['nueva', 300]]);
  });
});
