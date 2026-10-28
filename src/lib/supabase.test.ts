import { describe, it, expect } from 'vitest';
import { fetchConLimite } from './supabase';

// Un fetch que nunca contesta (red colgada) pero respeta la señal de corte.
const colgado: typeof fetch = (_u, init) => new Promise((_, rechazar) => {
  init?.signal?.addEventListener('abort', () => rechazar(init.signal!.reason));
});

describe('fetchConLimite', () => {
  it('corta una consulta colgada en vez de esperar para siempre', async () => {
    await expect(fetchConLimite(50, colgado)('https://x')).rejects.toBeTruthy();
  });

  it('respeta también un corte pedido por quien llama', async () => {
    const c = new AbortController();
    const p = fetchConLimite(10_000, colgado)('https://x', { signal: c.signal });
    c.abort();
    await expect(p).rejects.toBeTruthy();
  });

  it('una respuesta a tiempo pasa igual', async () => {
    const r = await fetchConLimite(1000, async () => new Response('ok'))('https://x');
    expect(await r.text()).toBe('ok');
  });
});
