import { useCallback, useEffect, useRef, useState } from 'react';
import { borrarHuella, guardarHuella, hayHuella, huellaDisponible, leerConHuella } from './huella';
import { useConfirm } from '../../lib/useConfirm';
import type React from 'react';

/**
 * Huella para una persona (dueño o un cajero).
 * - `activa`: ya guardó su clave con huella → mostrar "Usar mi huella".
 * - `entrar(verificar)`: pide la huella, recupera la clave y la verifica en el servidor.
 * - `ofrecer(secreto)`: después de entrar con PIN, pregunta si quiere usar la huella.
 */
export function useHuella(clave: string | null) {
  const confirmar = useConfirm();
  const [disponible, setDisponible] = useState(false);
  const [activa, setActiva] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const d = await huellaDisponible();
      const a = d && !!clave && await hayHuella(clave);
      if (vivo) { setDisponible(d); setActiva(a); setListo(true); }
    })();
    return () => { vivo = false; };
  }, [clave]);

  const entrar = useCallback(async (verificar: (secreto: string) => Promise<boolean>): Promise<boolean> => {
    if (!clave) return false;
    const secreto = await leerConHuella(clave, 'Entrar con tu huella');
    if (!secreto) return false;
    const ok = await verificar(secreto);
    // Solo con red: sin conexión el "no" puede ser un corte, no una clave vieja.
    if (!ok && navigator.onLine) { await borrarHuella(clave); setActiva(false); }
    return ok;
  }, [clave]);

  const ofrecer = useCallback(async (secreto: string) => {
    if (!clave || !disponible || activa) return;
    const si = await confirmar('¿Querés entrar con tu huella la próxima vez? Así no tenés que acordarte la clave.',
      { okText: 'Sí, usar huella' });
    if (si && await guardarHuella(clave, secreto)) setActiva(true);
  }, [clave, disponible, activa, confirmar]);

  return { disponible, activa, listo, entrar, ofrecer };
}

// La pantalla "¿Quién va a vender?" se desmonta apenas el login sale bien, así que
// la pregunta "¿usar huella?" la hace este componente, montado en la app ya logueada.
let pendiente: { clave: string; secreto: string } | null = null;
export const dejarOfertaHuella = (clave: string, secreto: string) => { pendiente = clave ? { clave, secreto } : null; };

export const OfertaHuellaPendiente: React.FC = () => {
  const [p] = useState(() => { const x = pendiente; pendiente = null; return x; });
  const h = useHuella(p?.clave ?? null);
  const hecho = useRef(false);
  useEffect(() => {
    if (p && h.listo && !hecho.current) { hecho.current = true; h.ofrecer(p.secreto); }
  }, [p, h]);
  return null;
};
