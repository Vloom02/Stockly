import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { rangoDe, resumirVentas } from './resumen';
import { DatosResumen, resumenAExcel, resumenAHtml } from './resumenExportar';

const rango = rangoDe('semana', new Date(2026, 9, 26, 15));
const iso = (d: number, h: number) => new Date(2026, 9, d, h, 5).toISOString();
const ventas = resumirVentas(
  [
    { id: 'a', fecha: iso(26, 9), total: 1500, descuento: 0, metodo_pago: 'efectivo', usuario: 'Rosa', fiado: false },
    { id: 'b', fecha: iso(25, 18), total: 800, descuento: 100, metodo_pago: 'tarjeta', usuario: 'Juan', fiado: false },
  ],
  [
    { venta_id: 'a', producto_id: 'p1', nombre_producto: '=HYPERLINK("x")', cantidad: 3, subtotal: 1500 },
    { venta_id: 'b', producto_id: 'p2', nombre_producto: 'Pan <casero>', cantidad: 1, subtotal: 800 },
  ],
  {}, rango,
);
const datos: DatosResumen = {
  comercio: 'Almacén Don Juan', sucursal: 'Principal', rango, ventas,
  stock: { valorTotal: 50000, lotesVencidos: 1, valorVencido: 1200, lotesPorVencer: 2, valorEnRiesgo: 3000, productosEnNegativo: 1, unidadesFaltantes: 2, valorCosto: 30000 },
  empleados: [{ nombre: 'Rosa', ventas: 10, vendido: 5000, unidadesSinStock: 2, cierres: 3, diferenciaCaja: -500 }],
  perdidas: { vencido: { unidades: 2, valor: 400 }, roto: { unidades: 0, valor: 0 } },
  productosStock: [{ nombre: 'Leche 1L', categoria: 'Lácteos', cantidad: 10, precio: 1200, valor: 12000, vence: '2026-11-02', estado: 'Bien' }],
};

describe('resumenAExcel', () => {
  it('arma un Excel con hojas, formato de plata, totales y textos que no son fórmulas', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await resumenAExcel(datos)).buffer as ArrayBuffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Resumen', 'Ventas', 'Productos vendidos', 'Por día', 'Empleados', 'Mercadería']);

    const res = wb.getWorksheet('Resumen')!;
    expect(res.getCell('A1').value).toBe('Almacén Don Juan · Principal');
    expect(res.getCell('A2').value).toBe(`Resumen: ${rango.titulo}`);
    const totalVendido = res.getColumn(1).values.indexOf('Total vendido');
    expect(res.getCell(totalVendido, 2).value).toBe(2300);
    expect(res.getCell(totalVendido, 2).numFmt).toContain('$');

    const vs = wb.getWorksheet('Ventas')!;
    expect(vs.getRow(1).values).toEqual([, 'Fecha', 'Hora', 'Empleado', 'Medio de pago', 'Descuento', 'Total']);
    expect(vs.getCell('D2').value).toBe('Tarjeta');                       // en orden de hora: primero la del 25
    expect(vs.getCell('F4').value).toMatchObject({ formula: 'SUM(F2:F3)' }); // renglón de totales
    expect((vs.getCell('B2').value as Date).getUTCHours()).toBe(18);        // la hora del local, no la UTC

    const pv = wb.getWorksheet('Productos vendidos')!;
    expect(pv.getCell('A2').value).toBe('=HYPERLINK("x")'); // queda como texto
    expect(pv.getCell('A2').formula).toBeUndefined();
  });
});

describe('resumenAHtml', () => {
  it('escapa los nombres y trae las secciones', () => {
    const html = resumenAHtml(datos);
    expect(html).toContain('Pan &lt;casero&gt;');
    expect(html).not.toContain('<casero>');
    for (const t of ['Ventas', 'Mercadería', 'Cómo te pagaron', 'Control de empleados', 'Por día', 'Lo más vendido']) expect(html).toContain(`<h2>${t}</h2>`);
  });
});
