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
    id: 'violeta',
    nombre: 'Normal',
    tonos: ['#b7a8d0', '#7d6aa0', '#6a5889', '#55456c', '#423651'],
    claros: ['#f5f3f9', '#eae5f1', '#dcd4e8', '#c2b6d8'],
  },
  {
    id: 'contraste',
    nombre: 'Alto contraste',
    tonos: ['#5b7bd5', '#1f3f99', '#1a3480', '#152a66', '#10204d'],
    claros: ['#eef2fb', '#dce4f6', '#c2cff0', '#9fb3e6'],
  },
];

const KEY = 'stockly:color-marca';

export function obtenerColorMarcaGuardado(): string {
  return almacenGet(KEY, 'violeta') || 'violeta';
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
