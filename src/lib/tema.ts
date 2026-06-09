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

// Paletas SUAVIZADAS (apagadas/empolvadas) para pegar con el look cálido editorial.
export const COLORES_MARCA: ColorMarca[] = [
  {
    id: 'violeta',
    nombre: 'Violeta',
    tonos: ['#b7a8d0', '#7d6aa0', '#6a5889', '#55456c', '#423651'],
    claros: ['#f5f3f9', '#eae5f1', '#dcd4e8', '#c2b6d8'],
  },
  {
    id: 'azul',
    nombre: 'Azul',
    tonos: ['#8fb3da', '#5a7fae', '#4c6c97', '#3e587b', '#324862'],
    claros: ['#f1f5fa', '#e3ebf4', '#cfdcea', '#aec5dd'],
  },
  {
    id: 'esmeralda',
    nombre: 'Verde',
    tonos: ['#86c2a4', '#5a9c7d', '#4d8a6d', '#3f7159', '#345c49'],
    claros: ['#eff5f1', '#dde9e2', '#c6dccf', '#a3c7b2'],
  },
  {
    id: 'rojo',
    nombre: 'Rojo',
    tonos: ['#d99b91', '#bb6258', '#a4524a', '#85433d', '#6b3833'],
    claros: ['#f8f1f0', '#f0e0de', '#e4c8c4', '#d3a59e'],
  },
  {
    id: 'naranja',
    nombre: 'Naranja',
    tonos: ['#e0a878', '#c47a45', '#a9663b', '#8a5230', '#6f4326'],
    claros: ['#f8f2ea', '#f0e2d2', '#e4ccb0', '#d2ac82'],
  },
  {
    id: 'rosa',
    nombre: 'Rosa',
    tonos: ['#d99cba', '#bb6a93', '#a4567f', '#864668', '#6e3a55'],
    claros: ['#f8f1f5', '#f0e1ea', '#e4cad9', '#d3a9c2'],
  },
  {
    id: 'cian',
    nombre: 'Cian',
    tonos: ['#82bdc8', '#5290a0', '#477e8c', '#3b6772', '#31555e'],
    claros: ['#eff5f6', '#ddebee', '#c5dde2', '#a0c8cf'],
  },
  {
    id: 'indigo',
    nombre: 'Índigo',
    tonos: ['#9aa0d4', '#6e6aaa', '#5e5b92', '#4c4a76', '#3d3b5e'],
    claros: ['#f3f4fa', '#e6e7f3', '#d4d6ea', '#b7badb'],
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
