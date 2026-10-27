import { describe, it, expect, vi } from 'vitest';

// IndexedDB no existe en jsdom: mockeamos la capa de storage con un Map.
const mem = new Map<string, string>();
vi.mock('./outbox', () => ({
  openDB: async () => {},
  getLocalSetting: async (k: string) => mem.get(k) ?? null,
  setLocalSetting: async (k: string, v: string) => { mem.set(k, v); },
}));

import {
  guardarCredencialOffline, verificarCredencialOffline, hayCredencialOffline, clavePorLegajo,
} from './authOffline';

describe('authOffline (fallback sin conexión)', () => {
  it('round-trip: guarda y verifica el secreto correcto', async () => {
    await guardarCredencialOffline('k1', '2202', { id: 'e1', nombre: 'Ana' });
    const r = await verificarCredencialOffline('k1', '2202');
    expect(r.ok).toBe(true);
    expect((r.extra as { id: string }).id).toBe('e1');
  });

  it('rechaza un secreto incorrecto', async () => {
    await guardarCredencialOffline('k2', '2202');
    expect((await verificarCredencialOffline('k2', '9999')).ok).toBe(false);
  });

  it('rechaza si no hay credencial cacheada', async () => {
    expect((await verificarCredencialOffline('inexistente', '2202')).ok).toBe(false);
    expect(await hayCredencialOffline('inexistente')).toBe(false);
  });

  it('rechaza una credencial vencida (72 h)', async () => {
    await guardarCredencialOffline('k3', '2202');
    const e = JSON.parse(mem.get('k3')!);
    e.exp = Date.now() - 1000; // forzar vencimiento
    mem.set('k3', JSON.stringify(e));
    expect((await verificarCredencialOffline('k3', '2202')).ok).toBe(false);
    expect(await hayCredencialOffline('k3')).toBe(false);
  });

  it('la sal es aleatoria: mismo secreto, hashes distintos', async () => {
    await guardarCredencialOffline('k4', '2202');
    await guardarCredencialOffline('k5', '2202');
    expect(JSON.parse(mem.get('k4')!).hash).not.toBe(JSON.parse(mem.get('k5')!).hash);
  });

  it('clavePorLegajo normaliza el legajo', () => {
    expect(clavePorLegajo(' 15 ')).toBe(clavePorLegajo('15'));
    expect(clavePorLegajo('AB')).toBe(clavePorLegajo('ab'));
  });
});
