import { describe, it, expect } from 'vitest';
import { camposDeCopia } from './copia';

describe('camposDeCopia', () => {
  it('se queda solo con los campos conocidos y del tipo correcto', () => {
    const r = camposDeCopia('productos', { nombre: ' Yerba ', categoria: 'Almacén', precio: 1500, activo: false,
      fotoUrl: 'https://otro-sitio.example/x.png', costo: 'mucho', comercioId: 'ajeno' });
    expect(r).toEqual({ nombre: 'Yerba', categoria: 'Almacén', precio: 1500 });
  });

  it('sin un campo obligatorio (o con uno mal) no se importa', () => {
    expect(camposDeCopia('productos', { nombre: 'Yerba', categoria: 'Almacén', precio: -5 })).toBeNull();
    expect(camposDeCopia('lotes', { cantidad: 10, fechaVencimiento: '1/2/27' })).toBeNull();
    expect(camposDeCopia('lotes', { cantidad: 10, fechaVencimiento: '2027-02-01', retirado: true })).toEqual({ cantidad: 10, fechaVencimiento: '2027-02-01' });
    expect(camposDeCopia('sucursales', null)).toBeNull();
  });

  it('corta los textos larguísimos', () => {
    expect(String(camposDeCopia('sucursales', { nombre: 'x'.repeat(5000) })?.nombre).length).toBe(200);
  });
});
