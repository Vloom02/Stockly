import { useRef } from 'react';
import { useIonViewWillEnter } from '@ionic/react';

/** Vuelve a cargar al regresar a la pantalla, pero no al entrar la primera vez: eso ya lo hace el
 *  useEffect de carga, y juntos pedían todo dos veces. */
export function useAlVolver(fn: () => void) {
  const primera = useRef(true);
  useIonViewWillEnter(() => {
    if (primera.current) { primera.current = false; return; }
    fn();
  });
}
