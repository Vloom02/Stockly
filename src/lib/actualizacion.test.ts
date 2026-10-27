import { describe, it, expect } from 'vitest';
import { esMasNueva } from './actualizacion';

describe('esMasNueva', () => {
  it('compara número por número (no como texto)', () => {
    expect(esMasNueva('v1.10.0', '1.9.3')).toBe(true);
    expect(esMasNueva('v1.1.0', '1.1.0')).toBe(false);
    expect(esMasNueva('1.0.9', '1.1.0')).toBe(false);
    expect(esMasNueva('v2', '1.9.9')).toBe(true);
  });
});
