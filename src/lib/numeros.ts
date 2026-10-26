/**
 * Lee un monto como lo escribe la gente: "$1.000", "1.000,50", "10,5", "1000", "1,000.50".
 * En Argentina el punto separa miles y la coma los decimales; antes "1.000" se leía
 * como 1 (parseFloat) y un fondo de caja de mil pesos quedaba en un peso.
 * Devuelve NaN si no es un número.
 */
export function parseMonto(texto: string): number {
  let t = String(texto ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!t) return NaN;
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El separador que aparece último es el decimal.
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (coma >= 0) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (punto >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // "1.000" / "12.500" → miles
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
