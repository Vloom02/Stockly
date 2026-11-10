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

/** La plata, igual en toda la app: "$1.000", "$999,50", "-$200". Antes Mercadería redondeaba y Vender no,
 *  y el mismo precio se veía distinto en cada pantalla. */
// Formateadores fijos: toLocaleString con opciones arma uno nuevo en cada llamada, y la plata se dibuja en cada fila.
const PLATA_ENTERA = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const PLATA_CON_CENTAVOS = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatearPlata(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  return (v < 0 ? '-$' : '$') + (Number.isInteger(v) ? PLATA_ENTERA : PLATA_CON_CENTAVOS).format(Math.abs(v));
}

/** Con cuánto es probable que paguen un total en efectivo: los redondeos que le siguen, de menor a mayor
 *  (para $9.233: $9.300, $9.500, $10.000 y $20.000). Antes eran cuatro montos fijos y con un total más alto no servía ninguno. */
export function billetesSugeridos(total: number, cuantos = 4): number[] {
  if (!(total > 0)) return [];
  const arriba = [100, 500, 1000, 2000, 5000, 10000, 20000].map(paso => Math.ceil(total / paso) * paso).filter(v => v > total);
  return [...new Set(arriba)].sort((a, b) => a - b).slice(0, cuantos);
}
