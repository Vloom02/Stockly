// ═══════════════════════════════════════════════════════════════════════════
// Lista de reposición ("qué comprar") desde el stock por producto. Lógica pura.
// (Las pérdidas por vencimiento ya se reportan en ReportesPage / perdidasPorMes.)
// ═══════════════════════════════════════════════════════════════════════════
import type { Producto, ProductoConLotes, NivelAlerta } from '../types';
import { ordenNivel } from './vencimientos';

// ─── Reposición ──────────────────────────────────────────────────────────────
export type MotivoReposicion = 'sin_stock' | 'stock_bajo' | 'por_vencer';

export interface ItemReposicion {
  producto: Producto;
  cantidadTotal: number;
  nivelPeor: NivelAlerta;
  motivo: MotivoReposicion;
}

const PESO_MOTIVO: Record<MotivoReposicion, number> = { sin_stock: 0, por_vencer: 1, stock_bajo: 2 };

/**
 * Arma la lista de "qué comprar":
 *  - sin_stock: no queda nada.
 *  - por_vencer: lo que queda está vencido/crítico/urgente (hay que reponer).
 *  - stock_bajo: queda poco (<= umbral).
 * Solo productos activos. Ordena por urgencia.
 */
export function listaReposicion(items: ProductoConLotes[], umbralBajo: number): ItemReposicion[] {
  const out: ItemReposicion[] = [];
  for (const it of items) {
    if (!it.producto.activo) continue;
    let motivo: MotivoReposicion | null = null;
    if (it.cantidadTotal <= 0) motivo = 'sin_stock';
    else if (it.nivelPeor === 'vencido' || it.nivelPeor === 'critico' || it.nivelPeor === 'urgente') motivo = 'por_vencer';
    else if (it.cantidadTotal <= umbralBajo) motivo = 'stock_bajo';
    if (!motivo) continue;
    out.push({ producto: it.producto, cantidadTotal: it.cantidadTotal, nivelPeor: it.nivelPeor, motivo });
  }
  return out.sort((a, b) =>
    PESO_MOTIVO[a.motivo] - PESO_MOTIVO[b.motivo] ||
    ordenNivel(a.nivelPeor) - ordenNivel(b.nivelPeor) ||
    a.producto.nombre.localeCompare(b.producto.nombre),
  );
}

/** Texto compartible (WhatsApp) de la lista de reposición. */
export function reposicionATexto(items: ItemReposicion[]): string {
  if (items.length === 0) return 'No hay productos para reponer. 👍';
  const etiqueta: Record<MotivoReposicion, string> = {
    sin_stock: 'SIN STOCK', stock_bajo: 'poco', por_vencer: 'por vencer',
  };
  const lineas = items.map(i => `• ${i.producto.nombre} (${etiqueta[i.motivo]}${i.cantidadTotal > 0 ? `, quedan ${i.cantidadTotal}` : ''})`);
  return `🛒 Lista de reposición\n\n${lineas.join('\n')}`;
}
