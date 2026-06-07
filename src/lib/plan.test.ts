import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluarPlan } from './plan';
import { Comercio } from '../types';

const base = (over: Partial<Comercio>): Comercio => ({
  id: 'c1', nombre: 'Test', plan: 'trial', ...over,
});

afterEach(() => { vi.useRealTimers(); });

describe('evaluarPlan', () => {
  it('sin comercio → permite (no bloquear por falta de dato)', () => {
    expect(evaluarPlan(null)).toEqual({ activo: true, tipo: 'activo' });
  });

  it('plan activo → siempre habilitado', () => {
    expect(evaluarPlan(base({ plan: 'activo' }))).toEqual({ activo: true, tipo: 'activo' });
  });

  it('plan suspendido → bloqueado', () => {
    expect(evaluarPlan(base({ plan: 'suspendido' }))).toEqual({ activo: false, tipo: 'suspendido' });
  });

  it('trial vigente → activo con días restantes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T10:00:00'));
    const r = evaluarPlan(base({ plan: 'trial', trialHasta: '2026-06-16' }));
    expect(r.activo).toBe(true);
    expect(r.tipo).toBe('trial');
    // 11: cuenta hasta el FIN del día de trialHasta (23:59:59) con Math.ceil
    expect(r.diasRestantes).toBe(11);
  });

  it('trial vencido → bloqueado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T10:00:00'));
    const r = evaluarPlan(base({ plan: 'trial', trialHasta: '2026-06-16' }));
    expect(r.activo).toBe(false);
    expect(r.tipo).toBe('trial_vencido');
  });

  it('trial sin fecha → permite (no bloquear por falta de dato)', () => {
    expect(evaluarPlan(base({ plan: 'trial', trialHasta: undefined }))).toEqual({ activo: true, tipo: 'trial' });
  });

  it('plan desconocido se trata como trial', () => {
    const r = evaluarPlan(base({ plan: 'cualquier-cosa', trialHasta: undefined }));
    expect(r).toEqual({ activo: true, tipo: 'trial' });
  });
});
