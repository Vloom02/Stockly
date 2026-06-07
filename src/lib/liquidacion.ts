// ═══════════════════════════════════════════════════════════════════════════
// Liquidación automática FEFO: sugiere un descuento para vender productos antes
// de que venzan (convierte pérdida por vencimiento en venta). Lógica PURA.
// ═══════════════════════════════════════════════════════════════════════════
import { NivelAlerta } from '../types';

/** Descuento sugerido (%) por nivel de alerta. Configurable por comercio. */
export interface DescuentoConfig {
  critico: number; // ≤7 días → liquidar fuerte
  urgente: number; // ≤30 días → descuento medio
  aviso: number;   // ventana de aviso → descuento leve
}

export const DESCUENTO_DEFAULT: DescuentoConfig = { critico: 40, urgente: 20, aviso: 10 };

/**
 * Descuento sugerido (0–100) según el nivel de alerta del lote.
 * - vencido → 0 (no se liquida lo vencido; va a retiro/baja).
 * - ok      → 0 (todavía no hace falta rematar).
 */
export function sugerirDescuentoPorNivel(
  nivel: NivelAlerta,
  config: DescuentoConfig = DESCUENTO_DEFAULT,
): number {
  switch (nivel) {
    case 'critico': return clampPct(config.critico);
    case 'urgente': return clampPct(config.urgente);
    case 'aviso':   return clampPct(config.aviso);
    case 'vencido':
    case 'ok':
    default:        return 0;
  }
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Precio liquidado aplicando un % de descuento.
 * Redondea a múltiplo de `redondeo` (default 10) para precios "lindos" de góndola.
 * Nunca devuelve menos de 0.
 */
export function precioLiquidacion(precio: number, pct: number, redondeo = 10): number {
  if (precio <= 0) return 0;
  const bruto = precio * (1 - clampPct(pct) / 100);
  if (redondeo > 1) return Math.max(0, Math.round(bruto / redondeo) * redondeo);
  return Math.max(0, Math.round(bruto));
}

export interface SugerenciaLiquidacion {
  aplicar: boolean;      // ¿conviene liquidar?
  pct: number;           // % de descuento sugerido
  precioOriginal: number;
  precioFinal: number;   // precio ya con descuento y redondeado
  ahorroCliente: number; // cuánto se ahorra el cliente (precio - final)
}

/** Sugerencia completa de liquidación para un lote dado su nivel y precio. */
export function sugerirLiquidacion(
  nivel: NivelAlerta,
  precio: number,
  config: DescuentoConfig = DESCUENTO_DEFAULT,
  redondeo = 10,
): SugerenciaLiquidacion {
  const pct = sugerirDescuentoPorNivel(nivel, config);
  const precioFinal = pct > 0 ? precioLiquidacion(precio, pct, redondeo) : precio;
  return {
    aplicar: pct > 0 && precio > 0,
    pct,
    precioOriginal: precio,
    precioFinal,
    ahorroCliente: Math.max(0, precio - precioFinal),
  };
}
