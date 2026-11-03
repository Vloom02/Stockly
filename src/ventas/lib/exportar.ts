// ═══════════════════════════════════════════════════════════════════════════
// Exportar ventas a CSV (planilla Excel/Sheets es-AR) + guardado de archivo.
// ═══════════════════════════════════════════════════════════════════════════
import { guardarYCompartir, ResultadoArchivo } from '../../lib/archivos';

export interface VentaExport {
  fecha: string;        // ISO
  total: number;
  metodo_pago: string;
  cliente: string;
  fiado?: boolean;
  usuario?: string;
  descuento?: number;
}

export const METODOS: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', qr: 'QR',
};

function celda(v: string | number): string {
  let s = String(v ?? '');
  // CSV injection: neutralizar textos que Excel interpretaría como fórmula
  // (p.ej. cliente "=HYPERLINK(...)"). Solo strings; números intactos.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; // con \r suelto, Excel cortaba la fila
}

export function ventasACSV(ventas: VentaExport[]): string {
  const header = ['Fecha', 'Hora', 'Usuario', 'Cliente', 'Método', 'Descuento', 'Total', 'Fiado'];
  const rows = ventas
    .slice()
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map(v => {
      const d = new Date(v.fecha);
      return [
        d.toLocaleDateString('es-AR'),
        d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        v.usuario ?? '',
        v.cliente ?? '',
        METODOS[v.metodo_pago] ?? v.metodo_pago,
        v.descuento ?? 0,
        v.total,
        v.fiado ? 'Sí' : 'No',
      ];
    });
  // BOM + sep=; para Excel en español.
  return '﻿' + 'sep=;\n' + [header, ...rows].map(r => r.map(celda).join(';')).join('\n');
}

/** Guarda el CSV (caché + Compartir en Android, descarga en web). */
export function guardarCSV(nombre: string, contenido: string): Promise<ResultadoArchivo> {
  return guardarYCompartir(nombre, contenido, 'text/csv');
}
