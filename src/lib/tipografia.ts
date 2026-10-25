// Escala de tipografía / tamaño de interfaz, elegible por el usuario en Ajustes.
// Se aplica con `zoom` sobre el documento (escala texto + UI de forma proporcional),
// que funciona bien con el CSS en px de la app. Se persiste en el almacenamiento.
import { Capacitor } from '@capacitor/core';
import { TextZoom } from '@capacitor/text-zoom';
import { almacenGet, almacenSet } from './almacen';

const KEY = 'stockly:font-scale';

/** Límites razonables de la escala. */
export const ESCALA_MIN = 0.85;
export const ESCALA_MAX = 1.5;
// 110%: la app apunta a gente grande; cada uno puede bajarla o subirla en Ajustes.
export const ESCALA_DEFAULT = 1.1;

let escalaSugerida = ESCALA_DEFAULT; // la que se usa mientras el usuario no elija otra

/**
 * Escala inicial si el usuario nunca eligió una. Android ya agranda el texto de la
 * WebView con el "Tamaño de fuente" del sistema: si la persona lo subió, arrancamos
 * en 100% para no sumarle nuestro 110% encima (se saldría de la pantalla).
 */
export async function calcularEscalaSugerida(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { value } = await TextZoom.getPreferred();
    escalaSugerida = value > 1.05 ? 1 : ESCALA_DEFAULT;
  } catch { /* sin plugin: queda el default */ }
}

export function obtenerEscalaFont(): number {
  const v = parseFloat(almacenGet(KEY, String(escalaSugerida)));
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
