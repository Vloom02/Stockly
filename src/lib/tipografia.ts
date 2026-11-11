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

const KEY_PASADA = 'stockly:font-scale-v2'; // la escala guardada ya se pasó al modo nuevo

// Lo que se toma de la letra de Android llega hasta "Muy grande", la opción más alta de Ajustes. Con 1,5 en un
// celular los atajos de Inicio se salían del ancho y los nombres de la barra de abajo quedaban pegados.
export const ESCALA_DESDE_SISTEMA_MAX = 1.3;

/** Escala con la que arranca quien tiene la letra de Android en `sistema` y nunca eligió una en la app. */
export const escalaDesdeSistema = (sistema: number) => Math.min(ESCALA_DESDE_SISTEMA_MAX, Math.max(ESCALA_DEFAULT, sistema));

/** Escala que se le guarda, una sola vez, a quien ya había elegido `elegida` y la veía multiplicada por `sistema`. */
export const escalaPasada = (elegida: number, sistema: number) => Math.max(elegida, Math.min(ESCALA_DESDE_SISTEMA_MAX, elegida * sistema));

/**
 * Escala inicial si el usuario nunca eligió una. El "Tamaño de fuente" de Android agrandaba SOLO la
 * letra de la WebView (no los botones ni las cajas): con la letra del sistema al máximo el texto se
 * duplicaba y no entraba. Ahora la letra de la WebView queda fija y lo que la persona pidió en Android
 * es el punto de partida de la escala propia, que agranda todo parejo (hasta el tope de la app).
 */
export async function calcularEscalaSugerida(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { value } = await TextZoom.getPreferred();
    await TextZoom.set({ value: 1 });
    escalaSugerida = escalaDesdeSistema(value);
    // Quien ya había elegido una escala la veía multiplicada por la letra de Android: se le guarda ese
    // producto una sola vez, para que al actualizar no se le achique la letra.
    const elegida = parseFloat(almacenGet(KEY, ''));
    if (value > 1.05 && elegida > 0 && !almacenGet(KEY_PASADA, '')) guardarEscalaFont(escalaPasada(elegida, value));
    almacenSet(KEY_PASADA, '1');
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
