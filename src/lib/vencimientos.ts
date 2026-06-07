// ═══════════════════════════════════════════════════════════════════════════
// Lógica PURA de vencimientos (sin React/Supabase/IndexedDB) → 100% testeable.
// StoreContext la usa pasando los umbrales configurables del comercio.
// ═══════════════════════════════════════════════════════════════════════════
import { NivelAlerta } from '../types';

export interface UmbralesVencimiento {
  critico: number; // días: <= → 'critico'
  urgente: number; // días: <= → 'urgente'
  aviso: number;   // días: <= → 'aviso' (default si el lote no trae diasAviso)
}

/**
 * Días calendario entre hoy y la fecha de vencimiento (YYYY-MM-DD).
 * Compara a medianoche local para evitar errores por hora/zona horaria.
 * Negativo = ya vencido. 0 = vence hoy.
 */
export function diasRestantes(fechaVencimiento: string, hoy: Date = new Date()): number {
  const venc = new Date(fechaVencimiento + 'T00:00:00');
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((venc.getTime() - h.getTime()) / (1000 * 60 * 60 * 24));
}

/** Clasifica un nivel de alerta a partir de la cantidad de días restantes. */
export function nivelPorDias(
  dias: number,
  umbrales: UmbralesVencimiento,
  diasAviso?: number,
): NivelAlerta {
  if (dias < 0) return 'vencido';
  if (dias <= umbrales.critico) return 'critico';
  if (dias <= umbrales.urgente) return 'urgente';
  const umbralAviso = diasAviso ?? umbrales.aviso;
  if (dias <= umbralAviso) return 'aviso';
  return 'ok';
}

/** Clasifica el nivel de alerta de un lote según su fecha de vencimiento. */
export function calcularNivelAlerta(
  fechaVencimiento: string,
  umbrales: UmbralesVencimiento,
  diasAviso?: number,
  hoy: Date = new Date(),
): NivelAlerta {
  return nivelPorDias(diasRestantes(fechaVencimiento, hoy), umbrales, diasAviso);
}

/** Orden de severidad (0 = más grave). Útil para ordenar listas y elegir el "peor". */
export function ordenNivel(n: NivelAlerta): number {
  return ['vencido', 'critico', 'urgente', 'aviso', 'ok'].indexOf(n);
}

export function etiquetaNivel(n: NivelAlerta): string {
  return { vencido: 'Vencido', critico: 'Crítico', urgente: 'Urgente', aviso: 'Aviso', ok: 'OK' }[n];
}
