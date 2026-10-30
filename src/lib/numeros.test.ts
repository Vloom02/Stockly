import { describe, it, expect } from 'vitest';
import { parseMonto, formatearPlata } from './numeros';

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
