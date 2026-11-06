import { supabase } from './supabase';

/** Cobros de fiado del comercio; con local, los que entraron en ese local (migración 19). Si la clienta fió en un local y
 *  paga en otro, la plata cuenta donde está. */
export function cobrosDeFiado(comercioId: string, sucursalId?: string) {
  const q = supabase.from('ventas_pagos').select('monto').eq('comercio_id', comercioId);
  return sucursalId ? q.eq('sucursal_id', sucursalId) : q;
}

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

/** Días de calendario desde una fecha (ayer a las 23 h = 1 día, aunque hayan pasado pocas horas). */
export function diasDesde(fecha: string, hoy = new Date()): number {
  const d = new Date(fecha);
  const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((a - b) / 86400000);
}

/** Cómo se reparte una entrega a cuenta: primero las deudas más viejas. */
export function repartirPago<D extends { id: string; fecha: string }>(deudas: D[], saldoDe: (d: D) => number, monto: number): { deuda: D; monto: number }[] {
  const r: { deuda: D; monto: number }[] = [];
  let resto = monto;
  for (const d of [...deudas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    if (resto <= 0) break;
    const m = Math.round(Math.min(resto, saldoDe(d)) * 100) / 100;
    if (m > 0) { r.push({ deuda: d, monto: m }); resto = Math.round((resto - m) * 100) / 100; }
  }
  return r;
}
