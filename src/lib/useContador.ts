import { useEffect, useRef, useState } from 'react';

/** ¿El usuario pidió menos movimiento (Android o la opción de la app)? */
export const sinMovimiento = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.movimiento === 'no';

/**
 * Número que "cuenta" hasta el valor nuevo (los totales suben en vez de saltar:
 * se nota que cambió). Sin movimiento, muestra el valor directo.
 */
export function useContador(valor: number, ms = 650): number {
  // Arranca en 0: al abrir la pantalla el número "cuenta" hasta su valor.
  const [mostrado, setMostrado] = useState(() => (sinMovimiento() ? valor : 0));
  const desde = useRef(sinMovimiento() ? valor : 0);
  useEffect(() => {
    if (sinMovimiento() || desde.current === valor) { desde.current = valor; setMostrado(valor); return; }
    const de = desde.current;
    const entero = Number.isInteger(valor) && Number.isInteger(de);
    const inicio = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const k = Math.min(1, (t - inicio) / ms);
      const v = de + (valor - de) * (1 - Math.pow(1 - k, 3)); // frena al final
      setMostrado(k < 1 && entero ? Math.round(v) : (k < 1 ? v : valor));
      if (k < 1) raf = requestAnimationFrame(paso); else desde.current = valor;
    };
    raf = requestAnimationFrame(paso);
    return () => { cancelAnimationFrame(raf); desde.current = valor; };
  }, [valor, ms]);
  return mostrado;
}
