// Fiado por cliente: el nombre se escribe a mano en cada venta, así que "Marta" y "marta " son la misma persona.
export const claveCliente = (c: string) => c.trim().toLowerCase();

export interface SaldoCliente { cliente: string; saldo: number; deudas: number }

/** Lo que debe cada cliente (fiado menos lo pagado), de mayor a menor. Queda el nombre como se escribió primero. */
export function saldosPorCliente(deudas: { id: string; cliente: string; monto: number }[], pagado: Record<string, number>): SaldoCliente[] {
  const m = new Map<string, SaldoCliente>();
  for (const d of deudas) {
    const saldo = Math.max(0, Number(d.monto) - (pagado[d.id] ?? 0));
    if (saldo <= 0) continue;
    const k = claveCliente(d.cliente);
    const e = m.get(k) ?? { cliente: d.cliente.trim(), saldo: 0, deudas: 0 };
    e.saldo += saldo; e.deudas++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.saldo - a.saldo);
}

/** Cómo se reparte una entrega a cuenta: primero las deudas más viejas. */
export function repartirPago<D extends { id: string; fecha: string }>(deudas: D[], saldoDe: (d: D) => number, monto: number): { deuda: D; monto: number }[] {
  const r: { deuda: D; monto: number }[] = [];
  let resto = monto;
  for (const d of [...deudas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    if (resto <= 0) break;
    const m = Math.min(resto, saldoDe(d));
    if (m > 0) { r.push({ deuda: d, monto: m }); resto -= m; }
  }
  return r;
}
