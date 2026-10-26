import { Comercio } from '../types';

export type EstadoPlan =
  | { activo: true; tipo: 'activo' | 'trial'; diasRestantes?: number }
  | { activo: false; tipo: 'trial_vencido' | 'suspendido'; diasRestantes?: number };

/**
 * Determina si un comercio puede usar la app según su plan.
 *
 * - activo      → siempre habilitado (cliente que paga)
 * - trial       → habilitado hasta trial_hasta; luego trial_vencido
 * - suspendido  → bloqueado
 *
 * Ante la duda (datos faltantes), se permite el uso para no bloquear
 * injustamente a un cliente por un dato mal cargado.
 */
export function evaluarPlan(comercio: Comercio | null): EstadoPlan {
  if (!comercio) return { activo: true, tipo: 'activo' };

  const plan = (comercio.plan || 'trial').toLowerCase();

  if (plan === 'suspendido') {
    return { activo: false, tipo: 'suspendido' };
  }

  if (plan === 'activo') {
    return { activo: true, tipo: 'activo' };
  }

  // plan === 'trial' (o cualquier valor desconocido → tratamos como trial)
  if (comercio.trialHasta) {
    const fin = finDelDiaLocal(comercio.trialHasta);
    const hoy = new Date();
    const ms = fin.getTime() - hoy.getTime();
    const dias = Math.ceil(ms / (1000 * 60 * 60 * 24));
    if (ms < 0) {
      return { activo: false, tipo: 'trial_vencido' };
    }
    return { activo: true, tipo: 'trial', diasRestantes: dias };
  }

  // trial sin fecha definida → permitir (no bloquear por falta de dato)
  return { activo: true, tipo: 'trial' };
}

/**
 * Fin (23:59:59 hora local) del día de una fecha. trial_hasta es timestamptz
 * ("2026-11-06T01:30:00+00:00"): su fecha UTC puede ser el día siguiente al local.
 * Una fecha sola ("2026-06-16") se toma como día local.
 */
export function finDelDiaLocal(s: string): Date {
  const d = s.length <= 10 ? new Date(s + 'T00:00:00') : new Date(s);
  d.setHours(23, 59, 59, 999);
  return d;
}
