import { describe, it, expect } from 'vitest';
import { stockACSV, movimientosACSV } from './exportar';
import type { LoteConProducto, Movimiento, Producto } from '../types';

function lote(p: Partial<LoteConProducto>): LoteConProducto {
  return {
    id: 'l1', productoId: 'p1', sucursalId: 's1', cantidad: 3, fechaVencimiento: '2026-06-20',
    diasAviso: 15, fechaIngreso: '2026-06-01', retirado: false,
    productoNombre: 'Yogur', productoCategoria: 'Lácteos', productoPrecio: 100,
    sucursalNombre: 'Principal', nivelAlerta: 'aviso', diasRestantes: 11, valorLote: 300,
    ...p,
  } as LoteConProducto;
}

describe('stockACSV', () => {
  it('antepone BOM + sep=; y la cabecera', () => {
    const csv = stockACSV([lote({})]);
    expect(csv.startsWith('﻿' + 'sep=;\n')).toBe(true);
    const lineas = csv.replace('﻿', '').split('\n');
    expect(lineas[1]).toContain('Producto;Categoría;Cantidad');
  });

  it('ordena por días restantes ascendente (lo que vence antes primero)', () => {
    const csv = stockACSV([
      lote({ productoNombre: 'Tarde', diasRestantes: 20 }),
      lote({ productoNombre: 'Pronto', diasRestantes: 2 }),
    ]);
    const filas = csv.split('\n');
    expect(filas[2]).toContain('Pronto');
    expect(filas[3]).toContain('Tarde');
  });

  it('entrecomilla y escapa valores con ; o comillas', () => {
    const csv = stockACSV([lote({ productoNombre: 'Pan "del día"; oferta' })]);
    expect(csv).toContain('"Pan ""del día""; oferta"');
  });

  it('incluye el estado legible del nivel', () => {
    const csv = stockACSV([lote({ nivelAlerta: 'vencido', diasRestantes: -1 })]);
    expect(csv).toContain('Vencido');
  });
});

describe('movimientosACSV', () => {
  const productos = [{ id: 'p1', nombre: 'Yogur' } as Producto];
  const mov = (p: Partial<Movimiento>): Movimiento => ({
    id: 'm1', productoId: 'p1', sucursalId: 's1', tipo: 'ingreso', cantidad: 5,
    cantidadAnterior: 0, cantidadNueva: 5, usuario: 'Ana', fecha: '2026-06-09T12:00:00.000Z', ...p,
  } as Movimiento);

  it('resuelve el nombre del producto y arma la cabecera', () => {
    const csv = movimientosACSV([mov({})], productos);
    expect(csv.split('\n')[1]).toContain('Fecha;Producto;Tipo');
    expect(csv).toContain('Yogur');
  });

  it('marca "(eliminado)" si el producto no existe', () => {
    const csv = movimientosACSV([mov({ productoId: 'zzz' })], productos);
    expect(csv).toContain('(eliminado)');
  });

  it('ordena por fecha descendente (lo más nuevo primero)', () => {
    const csv = movimientosACSV([
      mov({ id: 'viejo', fecha: '2026-06-01T10:00:00.000Z', notas: 'VIEJO' }),
      mov({ id: 'nuevo', fecha: '2026-06-09T10:00:00.000Z', notas: 'NUEVO' }),
    ], productos);
    const filas = csv.split('\n');
    expect(filas[2]).toContain('NUEVO');
    expect(filas[3]).toContain('VIEJO');
  });
});
