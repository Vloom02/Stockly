// Colores de marca que el usuario puede elegir en Ajustes.
// Cada uno define la paleta brand-400 a brand-800 (los tonos que usa la app).
import { almacenGet, almacenSet } from './almacen';

export interface ColorMarca {
  id: string;
  nombre: string;
  // tonos: [400, 500 (principal), 600, 700, 800]
  tonos: [string, string, string, string, string];
  // versiones claras para fondos de badges (brand-50, brand-100, brand-200, brand-300)
  claros: [string, string, string, string];
}

// Solo dos opciones (menos decisiones para el usuario): la normal y una de alto
// contraste. Un id guardado que ya no existe cae en la primera (aplicarColorMarca).
export const COLORES_MARCA: ColorMarca[] = [
  {
    // Azul cobalto profundo: el color más preferido también a los 80 años, y en su
    // versión intensa no se "lava" con el cristalino amarillento (los verdes azulados
    // claros sí se confunden). Blanco encima 7.2:1. Ids viejos ('violeta',
    // 'turquesa') caen acá.
    id: 'cobalto',
    nombre: 'Normal',
    tonos: ['#4a72d6', '#1f4fbf', '#1a419e', '#15357f', '#102863'],
    claros: ['#edf2fd', '#dbe5fb', '#b8cbf6', '#8eabef'],
  },
  {
    id: 'contraste',
    nombre: 'Alto contraste',
    tonos: ['#2f4f9f', '#0f2a6b', '#0c2257', '#091a44', '#061232'],
    claros: ['#e8edf8', '#d0daf0', '#a6b8e0', '#7891cc'],
  },
];

const KEY = 'stockly:color-marca';

export function obtenerColorMarcaGuardado(): string {
  return almacenGet(KEY, 'cobalto') || 'cobalto';
}

export function guardarColorMarca(id: string) {
  almacenSet(KEY, id);
}

/**
 * Aplica el color de marca elegido inyectando las variables CSS.
 * Sobreescribe los --brand-* que define variables.css.
 */
export function aplicarColorMarca(id: string) {
  const color = COLORES_MARCA.find(c => c.id === id) || COLORES_MARCA[0];
  const root = document.documentElement;
  const [c50, c100, c200, c300] = color.claros;
  const [c400, c500, c600, c700, c800] = color.tonos;
  root.style.setProperty('--brand-50', c50);
  root.style.setProperty('--brand-100', c100);
  root.style.setProperty('--brand-200', c200);
  root.style.setProperty('--brand-300', c300);
  root.style.setProperty('--brand-400', c400);
  root.style.setProperty('--brand-500', c500);
  root.style.setProperty('--brand-600', c600);
  root.style.setProperty('--brand-700', c700);
  root.style.setProperty('--brand-800', c800);
  // Color de la barra de estado / theme
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c500);
}
