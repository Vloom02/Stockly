// Resúmenes → Excel con formato (ExcelJS, se carga solo al exportar) y hoja para imprimir (HTML A4).
import type { Worksheet } from 'exceljs';
import { Rango, ResumenVentas, Perdidas, Fila, fechaCorta } from './resumen';
import { METODOS } from '../ventas/lib/exportar';
// La misma letra de la app, metida en la hoja: el visor de impresión de Android no ve las fuentes de la app.
import nunito from '@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?inline';

export interface ProductoStock { nombre: string; categoria: string; cantidad: number; precio: number; valor: number; vence?: string; estado: string; }

export interface DatosResumen {
  comercio: string;
  sucursal: string;
  rango: Rango;
  ventas: ResumenVentas | null; // null: sin internet, no se pudieron traer
  stock: { valorTotal: number; lotesVencidos: number; valorVencido: number; lotesPorVencer: number; valorEnRiesgo: number; productosEnNegativo: number; unidadesFaltantes: number; valorCosto: number };
  perdidas: Perdidas;
  productosStock: ProductoStock[];
}

const plata = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const hora = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const pct = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);

/** Los renglones de "Concepto / Valor" que comparten la pantalla, el Excel y la hoja impresa. */
export function cifras(d: DatosResumen): { titulo: string; filas: [string, number, 'plata' | 'entero'][] }[] {
  const v = d.ventas;
  const bloques: { titulo: string; filas: [string, number, 'plata' | 'entero'][] }[] = [];
  if (v) bloques.push({ titulo: 'Ventas', filas: [
    ['Total vendido', v.total, 'plata'],
    ['Cantidad de ventas', v.cantidad, 'entero'],
    ['Ticket promedio', v.ticketPromedio, 'plata'],
    ['Descuentos hechos', v.descuentos, 'plata'],
    ['Ventas anuladas', v.anuladas, 'entero'],
    [`Para comparar: lo vendido ${d.rango.anterior.frase}`, v.totalAnterior, 'plata'],
    ['Ganancia (de lo que tiene costo cargado, menos descuentos)', v.ganancia.total, 'plata'],
    ['Unidades vendidas sin costo cargado', v.ganancia.unidadesSinCosto, 'entero'],
  ] });
  bloques.push({ titulo: 'Mercadería', filas: [
    ['Valor del stock (a precio de venta)', d.stock.valorTotal, 'plata'],
    ['Valor del stock (a precio de costo)', d.stock.valorCosto, 'plata'],
    ['Lotes vencidos en el local', d.stock.lotesVencidos, 'entero'],
    ['Valor de lo vencido', d.stock.valorVencido, 'plata'],
    ['Lotes que vencen pronto', d.stock.lotesPorVencer, 'entero'],
    ['Valor de lo que vence pronto', d.stock.valorEnRiesgo, 'plata'],
    ['Tirado por vencido en el período', d.perdidas.vencido.valor, 'plata'],
    ['Tirado por roto en el período', d.perdidas.roto.valor, 'plata'],
    ['Productos vendidos sin stock (en negativo)', d.stock.productosEnNegativo, 'entero'],
    ['Unidades que faltan cargar', d.stock.unidadesFaltantes, 'entero'],
  ] });
  return bloques;
}

// ─── Excel ──────────────────────────────────────────────────────────────────
const AZUL = 'FF1F4FBF', AZUL_SUAVE = 'FFEDF2FD', GRIS = 'FF5B6170';
const FMT = { plata: '"$" #,##0.00', entero: '#,##0', pct: '0%', fecha: 'dd/mm/yyyy', hora: 'hh:mm' } as const;
type Fmt = keyof typeof FMT;
type Celda = string | number | Date | null;
const BORDE = { style: 'thin' as const, color: { argb: 'FFC9CED8' } };
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };

// ExcelJS escribe las fechas en UTC: se pasa la hora local "tal cual" para que el Excel muestre la del local.
const fechaExcel = (iso: string | Date) => {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
};

/** Tabla con encabezado azul, bordes y (opcional) renglón de totales con fórmulas SUMA. Devuelve la fila siguiente. */
function tabla(ws: Worksheet, fila: number, titulos: string[], filas: Celda[][], formatos: (Fmt | undefined)[], sumar: number[] = []): number {
  const enc = ws.getRow(fila);
  titulos.forEach((t, i) => {
    const c = enc.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    c.border = BORDES;
    c.alignment = { vertical: 'middle', horizontal: formatos[i] ? 'right' : 'left', wrapText: true };
  });
  enc.height = 24;
  filas.forEach((valores, j) => {
    const r = ws.getRow(fila + 1 + j);
    valores.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.border = BORDES;
      c.font = { size: 12 };
      const f = formatos[i];
      if (f) c.numFmt = FMT[f];
      if (j % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FB' } };
    });
  });
  let sig = fila + 1 + filas.length;
  if (sumar.length && filas.length) {
    const r = ws.getRow(sig);
    titulos.forEach((_, i) => {
      const c = r.getCell(i + 1);
      const col = ws.getColumn(i + 1).letter;
      c.value = i === 0 ? 'Total' : sumar.includes(i) ? { formula: `SUM(${col}${fila + 1}:${col}${sig - 1})` } : null;
      c.font = { bold: true, size: 12 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_SUAVE } };
      c.border = BORDES;
      const f = formatos[i];
      if (f) c.numFmt = FMT[f];
    });
    sig++;
  }
  return sig + 1; // un renglón en blanco antes de lo que siga
}

function tituloSeccion(ws: Worksheet, fila: number, texto: string): number {
  const c = ws.getCell(fila, 1);
  c.value = texto;
  c.font = { bold: true, size: 14, color: { argb: AZUL } };
  return fila + 1;
}

/** Hoja de detalle: encabezado fijo al bajar y filtros en los títulos. */
function hojaDetalle(wb: import('exceljs').Workbook, nombre: string, anchos: number[], titulos: string[], filas: Celda[][], formatos: (Fmt | undefined)[], sumar: number[]) {
  const ws = wb.addWorksheet(nombre, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  tabla(ws, 1, titulos, filas, formatos, sumar);
  if (filas.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titulos.length } };
}

export async function resumenAExcel(d: DatosResumen): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stockly';
  wb.created = new Date();

  // Hoja 1: Resumen (lo que se mira primero)
  const ws = wb.addWorksheet('Resumen', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  [44, 16, 18, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = `${d.comercio} · ${d.sucursal}`;
  ws.getCell('A1').font = { bold: true, size: 18, color: { argb: AZUL } };
  ws.getRow(1).height = 28;
  ws.getCell('A2').value = `Resumen: ${d.rango.titulo}`;
  ws.getCell('A2').font = { bold: true, size: 13 };
  ws.getCell('A3').value = `Hecho el ${fechaCorta(new Date())} a las ${hora(new Date())}`;
  ws.getCell('A3').font = { italic: true, size: 11, color: { argb: GRIS } };

  let fila = 5;
  if (!d.ventas) {
    ws.getCell(fila, 1).value = 'Sin internet: las ventas no se pudieron traer. Volvé a exportar con conexión.';
    ws.getCell(fila, 1).font = { bold: true, color: { argb: 'FFA01818' } };
    fila += 2;
  }
  for (const b of cifras(d)) {
    fila = tituloSeccion(ws, fila, b.titulo);
    const inicio = fila;
    fila = tabla(ws, fila, ['Concepto', 'Valor'], b.filas.map(([n, v]) => [n, v]), [undefined, 'plata']);
    b.filas.forEach(([, , f], j) => { ws.getCell(inicio + 1 + j, 2).numFmt = FMT[f]; });
  }

  const v = d.ventas;
  if (v) {
    const filasMedio = (fs: Fila[]) => fs.map(f => [f.nombre, f.cantidad, f.total, pct(f.total, v.total)] as Celda[]);
    fila = tituloSeccion(ws, fila, 'Cómo te pagaron');
    fila = tabla(ws, fila, ['Medio de pago', 'Ventas', 'Total', '%'], filasMedio(v.porMetodo), [undefined, 'entero', 'plata', 'pct'], [1, 2]);
    fila = tituloSeccion(ws, fila, 'Por empleado');
    tabla(ws, fila, ['Empleado', 'Ventas', 'Total', '%'], filasMedio(v.porEmpleado), [undefined, 'entero', 'plata', 'pct'], [1, 2]);

    hojaDetalle(wb, 'Ventas', [12, 8, 20, 18, 14, 16],
      ['Fecha', 'Hora', 'Empleado', 'Medio de pago', 'Descuento', 'Total'],
      v.ventas.map(x => [fechaExcel(x.fecha), fechaExcel(x.fecha), x.usuario || '', x.fiado ? 'Fiado' : METODOS[x.metodo_pago ?? ''] ?? (x.metodo_pago || ''), Number(x.descuento || 0), Number(x.total)]),
      ['fecha', 'hora', undefined, undefined, 'plata', 'plata'], [4, 5]);
    hojaDetalle(wb, 'Productos vendidos', [40, 12, 16, 12, 16, 12],
      ['Producto', 'Cantidad', 'Total', '% de lo vendido', 'Ganancia', 'Margen'],
      v.productos.map(p => [p.nombre, p.cantidad, p.total, pct(p.total, v.total), p.ganancia ?? null, p.ganancia == null ? null : pct(p.ganancia, p.total)]),
      [undefined, 'entero', 'plata', 'pct', 'plata', 'pct'], [1, 2, 4]);
    hojaDetalle(wb, d.rango.porTurno ? 'Por turno' : 'Por día', [20, 10, 16],
      [d.rango.porTurno ? 'Turno' : 'Día', 'Ventas', 'Total'],
      v.porDia.map(p => [p.nombre, p.cantidad, p.total]),
      [undefined, 'entero', 'plata'], [1, 2]);
  }

  hojaDetalle(wb, 'Mercadería', [36, 18, 11, 14, 16, 13, 12],
    ['Producto', 'Categoría', 'Cantidad', 'Precio', 'Valor', 'Vence', 'Estado'],
    d.productosStock.map(p => [p.nombre, p.categoria, p.cantidad, p.precio, p.valor, p.vence ? fechaExcel(p.vence + 'T00:00') : null, p.estado]),
    [undefined, undefined, 'entero', 'plata', 'plata', 'fecha', undefined], [2, 4]);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ─── Hoja para imprimir (A4) ────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const tablaHtml = (titulos: string[], filas: string[][], numericas: number[]) =>
  `<table><thead><tr>${titulos.map((t, i) => `<th${numericas.includes(i) ? ' class="n"' : ''}>${esc(t)}</th>`).join('')}</tr></thead><tbody>${
    filas.map(f => `<tr>${f.map((c, i) => `<td${numericas.includes(i) ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;

export function resumenAHtml(d: DatosResumen): string {
  const v = d.ventas;
  const fmt = (n: number, f: 'plata' | 'entero') => (f === 'plata' ? plata(n) : Math.round(n).toLocaleString('es-AR'));
  const filasPct = (fs: Fila[]) => fs.map(f => [f.nombre, String(f.cantidad), plata(f.total), `${Math.round(pct(f.total, v?.total ?? 0) * 100)}%`]);
  const secciones = [
    !v ? '<p class="aviso">Sin internet: las ventas no se pudieron traer.</p>' : '',
    ...cifras(d).map(b => `<h2>${esc(b.titulo)}</h2>${tablaHtml(['Concepto', 'Valor'], b.filas.map(([n, x, f]) => [n, fmt(x, f)]), [1])}`),
    v && v.porMetodo.length ? `<h2>Cómo te pagaron</h2>${tablaHtml(['Medio de pago', 'Ventas', 'Total', '%'], filasPct(v.porMetodo), [1, 2, 3])}` : '',
    v && v.porEmpleado.length ? `<h2>Por empleado</h2>${tablaHtml(['Empleado', 'Ventas', 'Total', '%'], filasPct(v.porEmpleado), [1, 2, 3])}` : '',
    v ? `<h2>${d.rango.porTurno ? 'Por turno' : 'Por día'}</h2>${tablaHtml([d.rango.porTurno ? 'Turno' : 'Día', 'Ventas', 'Total'], v.porDia.map(p => [p.nombre, String(p.cantidad), plata(p.total)]), [1, 2])}` : '',
    v && v.productos.length ? `<h2>Lo más vendido</h2>${tablaHtml(['Producto', 'Cantidad', 'Total', '%'], filasPct(v.productos.slice(0, 25)), [1, 2, 3])}` : '',
  ].join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resumen ${esc(d.rango.titulo)}</title><style>
    @font-face { font-family: 'Nunito'; src: url('${nunito}') format('woff2'); font-weight: 200 1000; }
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Nunito', Arial, sans-serif; color: #1b1f2a; font-size: 14pt; margin: 0; }
    h1 { font-size: 22pt; color: #1f4fbf; margin: 0 0 2mm; }
    .sub { font-size: 15pt; font-weight: bold; margin: 0 0 1mm; }
    .hecho { color: #5b6170; font-size: 12pt; margin: 0 0 6mm; }
    h2 { font-size: 17pt; color: #1f4fbf; margin: 6mm 0 2mm; break-after: avoid; }
    table { width: 100%; border-collapse: collapse; break-inside: auto; }
    tr { break-inside: avoid; }
    th { background: #1f4fbf; color: #fff; text-align: left; padding: 2mm 3mm; font-size: 13pt; }
    td { padding: 2mm 3mm; border-bottom: 1px solid #c9ced8; }
    tbody tr:nth-child(even) td { background: #f7f8fb; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .aviso { color: #a01818; font-weight: bold; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style></head><body>
    <h1>${esc(d.comercio)} · ${esc(d.sucursal)}</h1>
    <p class="sub">Resumen: ${esc(d.rango.titulo)}</p>
    <p class="hecho">Hecho el ${fechaCorta(new Date())} a las ${hora(new Date())}</p>
    ${secciones}
  </body></html>`;
}
