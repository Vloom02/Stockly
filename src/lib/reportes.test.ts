import { describe, it, expect } from 'vitest';
import { listaReposicion, reposicionATexto } from './reportes';
import type { ProductoConLotes, Producto, NivelAlerta } from '../types';

function prod(p: Partial<Producto>): Producto {
  return { id: 'p', nombre: 'X', categoria: 'c', precio: 100, diasAvisoDefault: 15, activo: true, fechaCreacion: '2026-01-01', ...p } as Producto;
}
function pcl(nombre: string, cantidadTotal: number, nivelPeor: NivelAlerta, activo = true): ProductoConLotes {
  return { producto: prod({ id: nombre, nombre, activo }), lotes: [], cantidadTotal, valorTotal: cantidadTotal * 100, nivelPeor };
}

describe('listaReposicion', () => {
  it('incluye sin stock, por vencer y stock bajo; excluye los OK con stock', () => {
    const r = listaReposicion([
      pcl('Vacío', 0, 'ok'),
      pcl('PorVencer', 10, 'critico'),
      pcl('Poco', 2, 'ok'),
      pcl('Bien', 50, 'ok'),
    ], 3);
    const nombres = r.map(i => i.producto.nombre);
    expect(nombres).toContain('Vacío');
    expect(nombres).toContain('PorVencer');
    expect(nombres).toContain('Poco');
    expect(nombres).not.toContain('Bien');
  });

  it('ordena por urgencia: sin_stock → por_vencer → stock_bajo', () => {
    const r = listaReposicion([
      pcl('Poco', 2, 'ok'),
      pcl('PorVencer', 10, 'urgente'),
      pcl('Vacío', 0, 'ok'),
    ], 3);
    expect(r.map(i => i.motivo)).toEqual(['sin_stock', 'por_vencer', 'stock_bajo']);
  });

  it('ignora productos inactivos', () => {
    const r = listaReposicion([pcl('Baja', 0, 'ok', false)], 3);
    expect(r).toHaveLength(0);
  });

  it('respeta el umbral de stock bajo', () => {
    expect(listaReposicion([pcl('A', 5, 'ok')], 3)).toHaveLength(0);
    expect(listaReposicion([pcl('A', 5, 'ok')], 6)).toHaveLength(1);
  });
});

describe('reposicionATexto', () => {
  it('mensaje vacío cuando no hay nada que reponer', () => {
    expect(reposicionATexto([])).toContain('No hay productos para reponer');
  });
  it('lista cada producto con su motivo', () => {
    const txt = reposicionATexto(listaReposicion([pcl('Vacío', 0, 'ok'), pcl('Poco', 2, 'ok')], 3));
    expect(txt).toContain('Lista de reposición');
    expect(txt).toContain('Vacío');
    expect(txt).toContain('SIN STOCK');
    expect(txt).toContain('Poco');
  });
});
