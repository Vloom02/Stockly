import { describe, it, expect } from 'vitest';
import { parseMonto, formatearPlata, billetesSugeridos } from './numeros';

describe('billetesSugeridos', () => {
  it('propone los redondeos que siguen al total, de menor a mayor', () => {
    expect(billetesSugeridos(9233)).toEqual([9300, 9500, 10000, 20000]);
    expect(billetesSugeridos(18466)).toEqual([18500, 19000, 20000]);
    expect(billetesSugeridos(350)).toEqual([400, 500, 1000, 2000]);
  });
  it('nunca propone el total justo ni menos (para eso está "Justo")', () => {
    expect(billetesSugeridos(1000)).toEqual([2000, 5000, 10000, 20000]);
    expect(billetesSugeridos(999.5)).toEqual([1000, 2000, 5000, 10000]);
    for (const v of billetesSugeridos(45000)) expect(v).toBeGreaterThan(45000);
  });
  it('sin total no propone nada', () => {
    expect(billetesSugeridos(0)).toEqual([]);
    expect(billetesSugeridos(NaN)).toEqual([]);
  });
});

describe('parseMonto', () => {
  it('entiende el formato argentino (punto de miles, coma decimal)', () => {
    expect(parseMonto('1.000')).toBe(1000);
    expect(parseMonto('$1.000')).toBe(1000);
    expect(parseMonto(' $ 12.500 ')).toBe(12500);
    expect(parseMonto('1.000,50')).toBe(1000.5);
    expect(parseMonto('10,5')).toBe(10.5);
  });
  it('acepta también números sin separadores o en formato inglés', () => {
    expect(parseMonto('1000')).toBe(1000);
    expect(parseMonto('1,000.50')).toBe(1000.5);
    expect(parseMonto('1.5')).toBe(1.5);
  });
  it('devuelve NaN si no es un número', () => {
    expect(parseMonto('')).toBeNaN();
    expect(parseMonto('abc')).toBeNaN();
    expect(parseMonto('1.2.3,4,5')).toBeNaN();
  });
});

describe('formatearPlata', () => {
  it('sin centavos si es entero, con dos si los tiene, y el menos adelante', () => {
    expect(formatearPlata(1000)).toBe('$1.000');
    expect(formatearPlata(999.5)).toBe('$999,50');
    expect(formatearPlata(-200)).toBe('-$200');
    expect(formatearPlata(1234567.891)).toBe('$1.234.567,89');
  });
});
