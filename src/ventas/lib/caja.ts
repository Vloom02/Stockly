// ═══════════════════════════════════════════════════════════════════════════
// Cuentas de la caja (puras, testeables). Las usan el cierre del cajero y el del dueño.
// Antes: las anuladas sumaban, el fiado contaba como efectivo y el efectivo esperado no
// incluía el fondo, las entradas/salidas ni los cobros de fiado → "faltan $7.000" sin faltar nada.
// ═══════════════════════════════════════════════════════════════════════════

export interface VentaCaja { total: number; metodo_pago: string; fiado: boolean; anulada?: boolean | null; descuento?: number | null }
export interface MovCaja { tipo: 'apertura' | 'ingreso' | 'egreso'; monto: number; fecha?: string; turno_desde?: string | null }

/** Total por forma de pago. Lo fiado va aparte (no entró plata) y lo anulado no cuenta. */
export function totalesPorMetodo(ventas: VentaCaja[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const v of ventas) {
    if (v.anulada) continue;
    const k = v.fiado ? 'fiado' : v.metodo_pago;
    m[k] = (m[k] ?? 0) + Number(v.total);
  }
  return m;
}

/** Fondo de apertura: la ÚLTIMA apertura de cada turno (corregir el fondo agrega una nueva). */
export function fondoDeApertura(movs: MovCaja[]): number {
  const ultima = new Map<string, MovCaja>();
  for (const m of movs) {
    if (m.tipo !== 'apertura') continue;
    const k = m.turno_desde ?? '';
    const prev = ultima.get(k);
    // Por la hora, no por el texto: "…Z" y "…+00:00" (del servidor y de la cola) no ordenan bien como texto.
    if (!prev || hora(m.fecha) >= hora(prev.fecha)) ultima.set(k, m);
  }
  return [...ultima.values()].reduce((s, m) => s + Number(m.monto), 0);
}

const hora = (f?: string) => { const t = f ? new Date(f).getTime() : 0; return Number.isFinite(t) ? t : 0; };

export interface Arqueo { fondo: number; ventasEfectivo: number; ingresos: number; egresos: number; cobrosFiado: number; esperado: number }

/** Efectivo que tendría que haber en la caja. Una venta en efectivo anulada sigue contando en su turno, porque la plata
 *  entró, y la devolución es una salida de caja (migración 19) en el turno en que se devuelve: así anular una venta de
 *  ayer no descuadra el cierre de ayer, y en el mismo turno da cero. */
export function arqueo(ventas: VentaCaja[], movs: MovCaja[], cobrosFiado: number, fondoManual = 0): Arqueo {
  const hayApertura = movs.some(m => m.tipo === 'apertura');
  const fondo = hayApertura ? fondoDeApertura(movs) : fondoManual;
  const ventasEfectivo = ventas.filter(v => !v.fiado && v.metodo_pago === 'efectivo').reduce((s, v) => s + Number(v.total), 0);
  const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
  const egresos = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0);
  return { fondo, ventasEfectivo, ingresos, egresos, cobrosFiado, esperado: fondo + ventasEfectivo + ingresos - egresos + cobrosFiado };
}
