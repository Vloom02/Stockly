// Aplica lo que bajó del servidor sobre lo que ya está en memoria, por id. Lo que no cambió conserva su identidad, así
// las pantallas no recalculan nada: antes cada venta, propia o de otro equipo, releía todo el almacenamiento local y
// redibujaba la app entera (más de un segundo en una tablet con miles de lotes).
const iguales = (a: object, b: object) => {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) return false;
  return true;
};

/** `sigue`: si la fila queda en la lista (un producto dado de baja o un lote retirado salen). */
export function aplicarPorId<T extends { id?: string }>(actual: T[], filas: T[], sigue: (x: T) => boolean = () => true): T[] {
  if (filas.length === 0) return actual;
  const porId = new Map(filas.map(f => [f.id, f]));
  let cambio = false;
  const res: T[] = [];
  for (const x of actual) {
    const n = porId.get(x.id);
    if (!n) { res.push(x); continue; }
    porId.delete(x.id);
    if (!sigue(n)) { cambio = true; continue; }
    if (iguales(x, n)) res.push(x);
    else { res.push(n); cambio = true; }
  }
  for (const n of porId.values()) if (sigue(n)) { res.push(n); cambio = true; }
  return cambio ? res : actual;
}

/** Suma movimientos nuevos a una lista ordenada del más nuevo al más viejo, sin repetir ni reordenar todo. */
export function sumarMovimientos<T extends { id?: string; fecha: string }>(actual: T[], filas: T[]): T[] {
  if (filas.length === 0) return actual;
  const ya = new Set(actual.map(m => m.id));
  const nuevos = filas.filter(m => !ya.has(m.id)).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  if (nuevos.length === 0) return actual;
  const res: T[] = [];
  let i = 0, j = 0;
  while (i < actual.length && j < nuevos.length) res.push(actual[i].fecha >= nuevos[j].fecha ? actual[i++] : nuevos[j++]);
  while (i < actual.length) res.push(actual[i++]);
  while (j < nuevos.length) res.push(nuevos[j++]);
  return res;
}
