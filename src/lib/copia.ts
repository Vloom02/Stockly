// Campos que se aceptan de una copia (archivo .json), con su tipo. Lo demás se ignora.
const CAMPOS_COPIA: Record<'productos' | 'sucursales' | 'lotes', Record<string, 'texto' | 'numero' | 'fecha'>> = {
  sucursales: { nombre: 'texto', direccion: 'texto' },
  productos: { nombre: 'texto', codigoBarras: 'texto', categoria: 'texto', precio: 'numero', diasAvisoDefault: 'numero',
    proveedor: 'texto', stockMinimo: 'numero', costo: 'numero' },
  lotes: { cantidad: 'numero', fechaVencimiento: 'fecha', diasAviso: 'numero', fechaIngreso: 'fecha', proveedor: 'texto', numeroLote: 'texto' },
};
const OBLIGATORIOS: Record<string, string[]> = {
  sucursales: ['nombre'], productos: ['nombre', 'categoria', 'precio'], lotes: ['cantidad', 'fechaVencimiento'],
};
/** Solo los campos conocidos y válidos de un registro de la copia; null si le falta algo obligatorio. */
export function camposDeCopia(tabla: keyof typeof CAMPOS_COPIA, item: unknown): Record<string, string | number> | null {
  if (!item || typeof item !== 'object') return null;
  const r: Record<string, string | number> = {};
  for (const [k, tipo] of Object.entries(CAMPOS_COPIA[tabla])) {
    const v = (item as Record<string, unknown>)[k];
    if (tipo === 'texto' && typeof v === 'string' && v.trim()) r[k] = v.trim().slice(0, 200);
    else if (tipo === 'numero' && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9) r[k] = v;
    else if (tipo === 'fecha' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) r[k] = v;
  }
  return OBLIGATORIOS[tabla].every(k => k in r) ? r : null;
}
