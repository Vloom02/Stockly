import { describe, it, expect } from 'vitest';
import { escalaDesdeSistema, escalaPasada } from './tipografia';

describe('letra tomada de Android', () => {
  it('arranca en la de la app y sube con la de Android hasta "Muy grande"', () => {
    expect(escalaDesdeSistema(0.85)).toBe(1.1);
    expect(escalaDesdeSistema(1)).toBe(1.1);
    expect(escalaDesdeSistema(1.15)).toBe(1.15);
    expect(escalaDesdeSistema(1.5)).toBe(1.3);
    expect(escalaDesdeSistema(2)).toBe(1.3);
  });

  it('a quien ya había elegido una no se la achica ni la pasa de "Muy grande"', () => {
    expect(escalaPasada(1, 1.15)).toBeCloseTo(1.15);
    expect(escalaPasada(1.15, 1.3)).toBe(1.3);
    expect(escalaPasada(1.3, 2)).toBe(1.3);
    expect(escalaPasada(1.5, 1.3)).toBe(1.5); // una escala vieja más alta queda como estaba
  });
});
