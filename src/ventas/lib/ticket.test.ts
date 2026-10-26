import { describe, it, expect } from 'vitest';
import { armarTicket, TicketData } from './ticket';

const fmt = (n: number) => `$${n}`;

function data(p: Partial<TicketData> = {}): TicketData {
  return {
    comercio: 'Almacén Don Pepe',
    sucursal: 'Principal',
    fecha: new Date('2026-06-09T14:32:00'),
    folio: 'A1B2C3',
    items: [
      { nombre: 'Coca-Cola 2.25L', qty: 2, precio: 2100 },
      { nombre: 'Pan Lactal', qty: 1, precio: 1850 },
    ],
    subtotal: 6050,
    descuento: 0,
    total: 6050,
    metodoPago: 'efectivo',
    cliente: '',
    fiado: false,
    ...p,
  };
}

describe('armarTicket', () => {
  it('muestra el comercio en mayúsculas y el folio', () => {
    const t = armarTicket(data(), fmt);
    expect(t).toContain('ALMACÉN DON PEPE');
    expect(t).toContain('Ticket #A1B2C3');
  });

  it('lista cada ítem con cantidad, precio unitario y subtotal de línea', () => {
    const t = armarTicket(data(), fmt);
    expect(t).toContain('Coca-Cola 2.25L');
    expect(t).toContain('2 x $2100');
    expect(t).toContain('$4200'); // 2100 * 2
  });

  it('muestra TOTAL y el método de pago legible', () => {
    const t = armarTicket(data(), fmt);
    expect(t).toContain('TOTAL');
    expect(t).toContain('$6050');
    expect(t).toContain('Efectivo');
  });

  it('incluye la línea de descuento solo si es mayor a 0', () => {
    expect(armarTicket(data({ descuento: 0 }), fmt)).not.toContain('Descuento');
    const con = armarTicket(data({ descuento: 50, total: 6000 }), fmt);
    expect(con).toContain('Descuento');
    expect(con).toContain('-$50');
  });

  it('marca FIADO con el nombre del cliente', () => {
    const t = armarTicket(data({ fiado: true, cliente: 'Juan' }), fmt);
    expect(t).toContain('FIADO');
    expect(t).toContain('Juan');
  });

  it('mapea otros métodos de pago', () => {
    expect(armarTicket(data({ metodoPago: 'transferencia' }), fmt)).toContain('Transferencia');
    expect(armarTicket(data({ metodoPago: 'qr' }), fmt)).toContain('QR');
  });

  it('cierra con el agradecimiento', () => {
    expect(armarTicket(data(), fmt)).toContain('¡Gracias por su compra!');
  });
});
