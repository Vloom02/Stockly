// Lector de códigos físico (USB o Bluetooth en modo teclado): "tipea" el código en
// milisegundos y aprieta Enter. Se lo reconoce por esa velocidad aunque no haya ningún
// campo enfocado (la cajera tocó un botón y el cursor se fue): así no se pierde la lectura.
// Si hay un campo de texto enfocado, el código entra al campo como siempre.
import { useEffect, useRef } from 'react';

/** Junta teclas rápidas; al llegar Enter devuelve el código si vino a velocidad de lector. */
export function crearDetectorLector(maxIntervaloMs = 60, minLargo = 4) {
  let buffer = '';
  let ultimo = -Infinity;
  return (tecla: string, t: number): string | null => {
    if (tecla === 'Shift' || tecla === 'Control' || tecla === 'Alt') return null; // letras en mayúscula
    if (t - ultimo > maxIntervaloMs) buffer = '';
    ultimo = t;
    if (tecla === 'Enter') {
      const codigo = buffer;
      buffer = '';
      return codigo.length >= minLargo ? codigo : null;
    }
    buffer = tecla.length === 1 ? buffer + tecla : '';
    return null;
  };
}

const esEditable = (el: Element | null) =>
  !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Llama a `alLeer` con cada código del lector físico. Devuelve un ref para poner en un
 * elemento de la pantalla: solo escucha mientras esa pantalla está a la vista (Ionic deja
 * montadas las anteriores) y no hay un diálogo abierto encima.
 */
export function useLectorFisico<T extends HTMLElement = HTMLDivElement>(alLeer: (codigo: string) => void) {
  const ref = useRef<T>(null);
  const alLeerRef = useRef(alLeer);
  alLeerRef.current = alLeer;

  useEffect(() => {
    const detectar = crearDetectorLector();
    const onKey = (e: KeyboardEvent) => {
      const pagina = ref.current?.closest('.ion-page');
      if (!pagina || pagina.classList.contains('ion-page-hidden')) return;
      // `.deja-leer`: un diálogo que no frena el lector (el comprobante de Vender se cierra con el próximo código).
      if (document.querySelector('ion-modal:not(.overlay-hidden):not(.deja-leer), ion-alert:not(.overlay-hidden)')) return;
      if (esEditable(document.activeElement)) return;
      const codigo = detectar(e.key, e.timeStamp);
      if (codigo) {
        // Que el Enter del lector no "toque" el botón que quedó enfocado.
        e.preventDefault();
        e.stopPropagation();
        alLeerRef.current(codigo);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return ref;
}
