// Resúmenes: los números de un período (ventas del servidor + pérdidas de mercadería).
// Lógica pura: la usan la pantalla, el Excel y la hoja para imprimir.
import { Movimiento, Producto } from '../types';
import { METODOS } from '../ventas/lib/exportar';

export type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes-pasado';

export const PERIODOS: { id: Periodo; nombre: string }[] = [
  { id: 'hoy', nombre: 'Hoy' },
  { id: 'ayer', nombre: 'Ayer' },
  { id: 'semana', nombre: 'Últimos 7 días' },
  { id: 'mes', nombre: 'Este mes' },
  { id: 'mes-pasado', nombre: 'Mes pasado' },
];

/** [desde, hasta) en hora local; un período en curso termina hoy. `anterior` es el período de antes
 *  cortado en el mismo punto (hoy a las 15 se compara con ayer hasta las 15), para comparar parejo. */
export interface Rango {
  desde: Date;
  hasta: Date;
  titulo: string;
  porTurno: boolean; // un solo día: se agrupa por turno en vez de por día
  anterior: { desde: Date; hasta: Date; frase: string }; // frase: "ayer a esta hora", "en septiembre"…
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];

export const fechaCorta = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const dia = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mayus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function rangoDe(p: Periodo, ahora = new Date()): Rango {
  const hoy = dia(ahora, 0);
  // El período anterior se corta donde va el actual (si está en curso, "a esta altura"), sin pasarse
  // de su propio fin: un mes de 31 días contra uno de 30 no se mete en el mes actual.
  const anterior = (desde: Date, hasta: Date, antDesde: Date, frase: string) => ({
    desde: antDesde, frase,
    hasta: new Date(Math.min(antDesde.getTime() + Math.min(hasta.getTime(), ahora.getTime()) - desde.getTime(), desde.getTime())),
  });
  if (p === 'hoy' || p === 'ayer') {
    const desde = p === 'hoy' ? hoy : dia(hoy, -1);
    return {
      desde, hasta: dia(desde, 1), porTurno: true,
      titulo: `${p === 'hoy' ? 'Hoy' : 'Ayer'}, ${DIAS[desde.getDay()]} ${fechaCorta(desde)}`,
      anterior: anterior(desde, dia(desde, 1), dia(desde, -1), p === 'hoy' ? 'ayer a esta hora' : 'anteayer'),
    };
  }
  if (p === 'semana') {
    const desde = dia(hoy, -6);
    return {
      desde, hasta: dia(hoy, 1), porTurno: false,
      titulo: `Del ${fechaCorta(desde)} al ${fechaCorta(hoy)}`,
      anterior: anterior(desde, dia(hoy, 1), dia(desde, -7), 'en los 7 días anteriores'),
    };
  }
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - (p === 'mes' ? 0 : 1), 1);
  const finMes = new Date(desde.getFullYear(), desde.getMonth() + 1, 1);
  const antDesde = new Date(desde.getFullYear(), desde.getMonth() - 1, 1);
  const mesAnt = MESES[antDesde.getMonth()];
  return {
    desde, hasta: p === 'mes' ? dia(hoy, 1) : finMes, porTurno: false, // el mes en curso, hasta hoy
    titulo: `${mayus(MESES[desde.getMonth()])} ${desde.getFullYear()}`,
    anterior: anterior(desde, finMes, antDesde, p === 'mes' ? `en ${mesAnt} hasta el día ${hoy.getDate()}` : `en ${mesAnt}`),
  };
}

export interface VentaRes {
  id: string; fecha: string; total: number; descuento: number;
  metodo_pago: string | null; usuario: string | null; fiado: boolean; anulada?: boolean;
}
export interface ItemRes { venta_id: string; producto_id: string | null; nombre_producto: string | null; cantidad: number; subtotal: number; costo_unit?: number | null; }

export interface Fila { nombre: string; cantidad: number; total: number; ganancia?: number | null; }

export interface ResumenVentas {
  cantidad: number;
  total: number;
  descuentos: number;
  ticketPromedio: number;
  anuladas: number;
  totalAnterior: number;
  porMetodo: Fila[];
  porEmpleado: Fila[];
  porDia: Fila[];      // por turno si el rango es de un día
  productos: Fila[];   // todos, de mayor a menor total (ganancia: null si no tiene costo cargado)
  /** Con el costo del día de cada venta, menos los descuentos. Solo cuenta lo que tiene costo. */
  ganancia: { total: number; vendidoConCosto: number; margen: number; unidadesSinCosto: number };
  ventas: VentaRes[];  // detalle (sin anuladas), en orden de hora
}

const nombreMetodo = (v: VentaRes) =>
  v.fiado ? 'Fiado' : METODOS[v.metodo_pago ?? ''] ?? mayus(v.metodo_pago || 'Sin dato');

function agrupar<T>(lista: T[], clave: (x: T) => string, monto: (x: T) => number, cantidad: (x: T) => number = () => 1): Fila[] {
  const m = new Map<string, Fila>();
  for (const x of lista) {
    const k = clave(x);
    const f = m.get(k) ?? { nombre: k, cantidad: 0, total: 0 };
    f.cantidad += cantidad(x);
    f.total += monto(x);
    m.set(k, f);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** `ventas` puede traer también las del período anterior: se separan por fecha. */
export function resumirVentas(ventas: VentaRes[], items: ItemRes[], nombres: Record<string, string>, r: Rango): ResumenVentas {
  const enRango = (v: VentaRes, desde: Date, hasta: Date) => { const f = new Date(v.fecha); return f >= desde && f < hasta; };
  const delPeriodo = ventas.filter(v => enRango(v, r.desde, r.hasta));
  const validas = delPeriodo.filter(v => !v.anulada).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const total = validas.reduce((s, v) => s + Number(v.total), 0);
  const ids = new Set(validas.map(v => v.id));

  let porDia: Fila[];
  if (r.porTurno) {
    const turno = (v: VentaRes) => { const h = new Date(v.fecha).getHours(); return h >= 6 && h < 14 ? 0 : h >= 14 && h < 22 ? 1 : 2; };
    porDia = ['Mañana (6 a 14)', 'Tarde (14 a 22)', 'Noche (22 a 6)'].map(nombre => ({ nombre, cantidad: 0, total: 0 }));
    for (const v of validas) { const f = porDia[turno(v)]; f.cantidad++; f.total += Number(v.total); }
  } else {
    porDia = [];
    const idx = new Map<string, Fila>();
    for (let d = r.desde; d < r.hasta; d = dia(d, 1)) {
      const f = { nombre: `${DIAS_CORTOS[d.getDay()]} ${fechaCorta(d).slice(0, 5)}`, cantidad: 0, total: 0 };
      porDia.push(f);
      idx.set(fechaCorta(d), f);
    }
    for (const v of validas) { const f = idx.get(fechaCorta(new Date(v.fecha))); if (f) { f.cantidad++; f.total += Number(v.total); } }
  }

  const delPeriodoItems = items.filter(i => ids.has(i.venta_id));
  const nombreItem = (i: ItemRes) => (i.producto_id && nombres[i.producto_id]) || i.nombre_producto || 'Venta sin producto';
  const productos = agrupar(delPeriodoItems, nombreItem, i => Number(i.subtotal), i => Number(i.cantidad));
  const gananciaPorNombre = new Map<string, number | null>();
  let ganancia = 0, vendidoConCosto = 0, unidadesSinCosto = 0;
  for (const i of delPeriodoItems) {
    if (!i.producto_id) continue; // monto suelto: no tiene costo
    const g = i.costo_unit == null ? null : Number(i.subtotal) - Number(i.costo_unit) * Number(i.cantidad);
    if (g === null) unidadesSinCosto += Number(i.cantidad);
    else { ganancia += g; vendidoConCosto += Number(i.subtotal); }
    const ant = gananciaPorNombre.get(nombreItem(i));
    gananciaPorNombre.set(nombreItem(i), g === null || ant === null ? null : (ant ?? 0) + g);
  }
  for (const f of productos) f.ganancia = gananciaPorNombre.get(f.nombre) ?? null;
  const descuentos = validas.reduce((s, v) => s + Number(v.descuento || 0), 0);
  ganancia -= descuentos;

  return {
    ganancia: { total: ganancia, vendidoConCosto, margen: vendidoConCosto > 0 ? ganancia / vendidoConCosto : 0, unidadesSinCosto },
    cantidad: validas.length,
    total,
    descuentos,
    ticketPromedio: validas.length ? total / validas.length : 0,
    anuladas: delPeriodo.length - validas.length,
    totalAnterior: ventas.filter(v => !v.anulada && enRango(v, r.anterior.desde, r.anterior.hasta)).reduce((s, v) => s + Number(v.total), 0),
    porMetodo: agrupar(validas, nombreMetodo, v => Number(v.total)),
    porEmpleado: agrupar(validas, v => v.usuario || 'Sin nombre', v => Number(v.total)),
    porDia,
    productos,
    ventas: validas,
  };
}

export interface Perdidas { vencido: { unidades: number; valor: number }; roto: { unidades: number; valor: number } }

/** Lo que se tiró en el período (retiros por vencido o roto), valuado a precio de venta. */
export function perdidasEntre(movs: Movimiento[], productos: Producto[], desde: Date, hasta: Date): Perdidas {
  const precio = new Map(productos.map(p => [p.id, p.precio || 0]));
  const r: Perdidas = { vencido: { unidades: 0, valor: 0 }, roto: { unidades: 0, valor: 0 } };
  for (const m of movs) {
    if (m.tipo !== 'retiro_vencido' && m.tipo !== 'retiro_roto') continue;
    const f = new Date(m.fecha);
    if (f < desde || f >= hasta) continue;
    const t = m.tipo === 'retiro_vencido' ? r.vencido : r.roto;
    t.unidades += Math.abs(m.cantidad);
    t.valor += Math.abs(m.cantidad) * (precio.get(m.productoId) ?? 0);
  }
  return r;
}

export interface CierreRes { cajero_nombre: string | null; diferencia: number | null; hasta: string | null; creado_en: string; }
export interface ControlEmpleado { nombre: string; ventas: number; vendido: number; unidadesSinStock: number; cierres: number; diferenciaCaja: number; }

/** Por empleado: ventas, lo vendido sin stock (Historial) y las diferencias de caja de sus cierres. */
export function controlEmpleados(porEmpleado: Fila[], movs: Movimiento[], cierres: CierreRes[], desde: Date, hasta: Date): ControlEmpleado[] {
  const m = new Map<string, ControlEmpleado>();
  const fila = (nombre: string) => {
    let f = m.get(nombre);
    if (!f) m.set(nombre, f = { nombre, ventas: 0, vendido: 0, unidadesSinStock: 0, cierres: 0, diferenciaCaja: 0 });
    return f;
  };
  for (const e of porEmpleado) { const f = fila(e.nombre); f.ventas = e.cantidad; f.vendido = e.total; }
  for (const mv of movs) {
    const f = new Date(mv.fecha);
    if (f < desde || f >= hasta || !mv.notas?.startsWith('Venta sin stock')) continue;
    fila(mv.usuario || 'Sin nombre').unidadesSinStock += Math.abs(mv.cantidad);
  }
  for (const c of cierres) {
    const f = new Date(c.hasta ?? c.creado_en);
    if (f < desde || f >= hasta) continue;
    const e = fila(c.cajero_nombre || 'Sin nombre');
    e.cierres++;
    e.diferenciaCaja += Number(c.diferencia || 0);
  }
  return [...m.values()].sort((a, b) => b.vendido - a.vendido);
}
