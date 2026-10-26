// ═══════════════════════════════════════════════════════════════════════════
// Generador de ticket / comprobante de venta (texto plano monoespaciado).
// Pensado para compartir por WhatsApp o pegar en una impresora térmica.
// Lógica pura: recibe los datos y un formateador de moneda.
// ═══════════════════════════════════════════════════════════════════════════
const ANCHO = 32;

const METODOS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  qr: 'QR',
};

export interface TicketItem { nombre: string; qty: number; precio: number; }
export interface TicketData {
  comercio: string;
  sucursal?: string;
  fecha: Date;
  folio: string;
  items: TicketItem[];
  subtotal: number;
  descuento: number;
  total: number;
  metodoPago: string;
  cliente?: string;
  fiado?: boolean;
  cajero?: string;
  legajo?: string;
}

function centrar(s: string): string {
  if (s.length >= ANCHO) return s.slice(0, ANCHO);
  const pad = Math.floor((ANCHO - s.length) / 2);
  return ' '.repeat(pad) + s;
}

/** Una línea "etiqueta ............ valor" justificada a lo ancho. */
function linea(label: string, valor: string): string {
  const espacio = Math.max(1, ANCHO - label.length - valor.length);
  return label + ' '.repeat(espacio) + valor;
}

const sep = '-'.repeat(ANCHO);

export function armarTicket(d: TicketData, fmt: (n: number) => string): string {
  const out: string[] = [];
  out.push(centrar(d.comercio.toUpperCase()));
  if (d.sucursal) out.push(centrar(d.sucursal));
  const f = d.fecha;
  const fecha = `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}/${f.getFullYear()} ${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
  out.push(centrar(fecha));
  out.push(centrar('Ticket #' + d.folio));
  if (d.cajero) out.push(centrar('Cajero: ' + d.cajero + (d.legajo && d.legajo !== '—' ? ` (#${d.legajo})` : '')));
  out.push(sep);

  for (const it of d.items) {
    out.push(it.nombre.slice(0, ANCHO));
    out.push(linea(`  ${it.qty} x ${fmt(it.precio)}`, fmt(it.precio * it.qty)));
  }

  out.push(sep);
  out.push(linea('Subtotal', fmt(d.subtotal)));
  if (d.descuento > 0) out.push(linea('Descuento', '-' + fmt(d.descuento)));
  out.push(linea('TOTAL', fmt(d.total)));
  out.push(sep);
  out.push(linea('Pago', METODOS[d.metodoPago] ?? d.metodoPago));
  if (d.fiado) out.push(linea('FIADO', d.cliente || 'Cliente'));
  else if (d.cliente) out.push(linea('Cliente', d.cliente));
  out.push('');
  out.push(centrar('¡Gracias por su compra!'));

  return out.join('\n');
}
