import { describe, it, expect } from 'vitest';
import {
  sugerirDescuentoPorNivel, precioLiquidacion, sugerirLiquidacion,
  DESCUENTO_DEFAULT, DescuentoConfig,
} from './liquidacion';

describe('sugerirDescuentoPorNivel', () => {
  it('usa los defaults por nivel', () => {
    expect(sugerirDescuentoPorNivel('critico')).toBe(40);
    expect(sugerirDescuentoPorNivel('urgente')).toBe(20);
    expect(sugerirDescuentoPorNivel('aviso')).toBe(10);
  });
  it('no liquida lo vencido ni lo que está ok', () => {
    expect(sugerirDescuentoPorNivel('vencido')).toBe(0);
    expect(sugerirDescuentoPorNivel('ok')).toBe(0);
  });
  it('respeta config custom y la acota a 0–100', () => {
    const cfg: DescuentoConfig = { critico: 150, urgente: -5, aviso: 25 };
    expect(sugerirDescuentoPorNivel('critico', cfg)).toBe(100);
    expect(sugerirDescuentoPorNivel('urgente', cfg)).toBe(0);
    expect(sugerirDescuentoPorNivel('aviso', cfg)).toBe(25);
  });
});

describe('precioLiquidacion', () => {
  it('aplica el % y redondea a múltiplo de 10', () => {
    expect(precioLiquidacion(1000, 40)).toBe(600);
    expect(precioLiquidacion(999, 40)).toBe(600);  // 599.4 → 600
    expect(precioLiquidacion(1000, 10)).toBe(900);
  });
  it('precio 0 o negativo → 0', () => {
    expect(precioLiquidacion(0, 40)).toBe(0);
    expect(precioLiquidacion(-50, 40)).toBe(0);
  });
  it('permite desactivar el redondeo', () => {
    expect(precioLiquidacion(999, 40, 1)).toBe(599); // round(599.4)
  });
});

describe('sugerirLiquidacion', () => {
  it('arma la sugerencia completa para un lote crítico', () => {
    const s = sugerirLiquidacion('critico', 1000);
    expect(s).toEqual({
      aplicar: true, pct: 40, precioOriginal: 1000, precioFinal: 600, ahorroCliente: 400,
    });
  });
  it('no sugiere liquidar si está ok', () => {
    const s = sugerirLiquidacion('ok', 1000);
    expect(s.aplicar).toBe(false);
    expect(s.precioFinal).toBe(1000);
    expect(s.ahorroCliente).toBe(0);
  });
  it('no sugiere liquidar productos sin precio', () => {
    expect(sugerirLiquidacion('critico', 0).aplicar).toBe(false);
  });
  it('usa DESCUENTO_DEFAULT cuando no se pasa config', () => {
    expect(sugerirLiquidacion('urgente', 500).pct).toBe(DESCUENTO_DEFAULT.urgente);
  });
});
