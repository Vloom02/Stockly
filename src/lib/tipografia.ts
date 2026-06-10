// Escala de tipografía / tamaño de interfaz, elegible por el usuario en Ajustes.
// Se aplica con `zoom` sobre el documento (escala texto + UI de forma proporcional),
// que funciona bien con el CSS en px de la app. Se persiste en el almacenamiento.
import { almacenGet, almacenSet } from './almacen';

const KEY = 'stockly:font-scale';

/** Límites razonables de la escala. */
export const ESCALA_MIN = 0.85;
export const ESCALA_MAX = 1.5;
export const ESCALA_DEFAULT = 1;

export function obtenerEscalaFont(): number {
  const v = parseFloat(almacenGet(KEY, String(ESCALA_DEFAULT)));
  if (Number.isNaN(v)) return ESCALA_DEFAULT;
  return Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, v));
}

export function guardarEscalaFont(v: number) {
  almacenSet(KEY, String(v));
}

/** Aplica la escala al documento. */
export function aplicarEscalaFont(v: number) {
  const escala = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, v));
  // `zoom` escala todo el árbol de forma proporcional (texto + spacing + íconos).
  (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom =
    escala === 1 ? '' : String(escala);
}
