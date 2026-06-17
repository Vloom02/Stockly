// ═══════════════════════════════════════════════════════════════════════════
// Exportar a CSV (planilla legible para Excel / Google Sheets) — lógica pura.
// Usa ';' como separador y antepone `sep=;` para que Excel en es-AR arme las
// columnas bien. Texto entre comillas (escapando comillas internas).
// ═══════════════════════════════════════════════════════════════════════════
import type { LoteConProducto, Movimiento, Producto } from '../types';
import { etiquetaNivel } from './vencimientos';

function celda(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  // Si tiene separador, comillas o saltos → entrecomillar y duplicar comillas.
  if (/[;"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function filas(rows: (string | number | undefined | null)[][]): string {
  // BOM + `sep=;` → Excel es-AR arma columnas y respeta los acentos.
  return '﻿' + 'sep=;\n' + rows.map(r => r.map(celda).join(';')).join('\n');
}

/** Planilla del stock actual (lotes enriquecidos). */
export function stockACSV(lotes: LoteConProducto[]): string {
  const header = [
    'Producto', 'Categoría', 'Cantidad', 'Precio', 'Valor',
    'Vencimiento', 'Días restantes', 'Estado', 'Proveedor', 'N° Lote', 'Sucursal',
  ];
  const rows = lotes
    .slice()
    .sort((a, b) => a.diasRestantes - b.diasRestantes)
    .map(l => [
      l.productoNombre, l.productoCategoria, l.cantidad,
      l.productoPrecio, l.valorLote, l.fechaVencimiento, l.diasRestantes,
      etiquetaNivel(l.nivelAlerta), l.productoProveedor ?? '', l.numeroLote ?? '', l.sucursalNombre,
    ]);
  return filas([header, ...rows]);
}

/** Planilla de movimientos (historial). */
export function movimientosACSV(movs: Movimiento[], productos: Producto[]): string {
  const nombre = (id: string) => productos.find(p => p.id === id)?.nombre ?? '(eliminado)';
  const header = ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Anterior', 'Nueva', 'Usuario', 'Notas'];
  const rows = movs
    .slice()
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map(m => [
      new Date(m.fecha).toLocaleString('es-AR'),
      nombre(m.productoId), m.tipo, m.cantidad, m.cantidadAnterior, m.cantidadNueva,
      m.usuario ?? '', m.notas ?? '',
    ]);
  return filas([header, ...rows]);
}
