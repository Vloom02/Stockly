import { describe, it, expect } from 'vitest';
import { crearDetectorLector } from './useLectorFisico';

// Simula teclas con su tiempo (ms); devuelve lo que el detector entregó al Enter.
const tipear = (texto: string, cadaMs: number, inicio = 0) => {
  const detectar = crearDetectorLector();
  let t = inicio, out: string | null = null;
  for (const c of texto) { out = detectar(c, t) ?? out; t += cadaMs; }
  return detectar('Enter', t) ?? out;
};

describe('crearDetectorLector (lector físico en modo teclado)', () => {
  it('entrega el código cuando llega a velocidad de lector', () => {
    expect(tipear('7790080000011', 8)).toBe('7790080000011');
  });

  it('ignora a una persona tecleando (lento)', () => {
    expect(tipear('7790', 180)).toBeNull();
  });

  it('ignora códigos demasiado cortos y Enter suelto', () => {
    expect(tipear('12', 5)).toBeNull();
    expect(crearDetectorLector()('Enter', 0)).toBeNull();
  });

  it('las mayúsculas (Shift) no cortan el código', () => {
    const detectar = crearDetectorLector();
    let t = 0;
    for (const k of ['Shift', 'A', 'B', '1', '2', '3']) { detectar(k, t); t += 5; }
    expect(detectar('Enter', t)).toBe('AB123');
  });

  it('una pausa larga en el medio descarta lo anterior', () => {
    const detectar = crearDetectorLector();
    ['1', '2', '3'].forEach((c, i) => detectar(c, i * 5));
    ['4', '5', '6', '7'].forEach((c, i) => detectar(c, 1000 + i * 5));
    expect(detectar('Enter', 1025)).toBe('4567');
  });
});
