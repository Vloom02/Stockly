// Confirmación con diálogo nativo de Ionic (reemplaza window.confirm, que se
// veía crudo y ajeno a la app). Devuelve una promesa: true si confirmó.
import { useIonAlert } from '@ionic/react';

interface OpcionesConfirm {
  titulo?: string;
  okText?: string;
  peligro?: boolean; // botón de confirmar en rojo
}

/** Pide un monto con el diálogo de la app (window.prompt se veía crudo, en letra chica y en inglés en algunos
 *  equipos). Devuelve el texto escrito, o null si canceló. */
export function usePedirTexto() {
  const [present] = useIonAlert();
  return (titulo: string, mensaje: string, inicial = '', okText = 'Aceptar') =>
    new Promise<string | null>((resolve) => {
      let resuelto = false;
      const cerrar = (v: string | null) => { if (!resuelto) { resuelto = true; resolve(v); } };
      present({
        header: titulo,
        message: mensaje,
        inputs: [{ name: 'valor', type: 'text', value: inicial, attributes: { inputmode: 'decimal' } }],
        buttons: [
          { text: 'Cancelar', role: 'cancel', handler: () => cerrar(null) },
          { text: okText, role: 'confirm', handler: (d: { valor?: string }) => cerrar(d?.valor ?? '') },
        ],
        onDidDismiss: () => cerrar(null),
      });
    });
}

export function useConfirm() {
  const [present] = useIonAlert();
  return (mensaje: string, opts: OpcionesConfirm = {}) =>
    new Promise<boolean>((resolve) => {
      let resuelto = false;
      const cerrar = (v: boolean) => { if (!resuelto) { resuelto = true; resolve(v); } };
      present({
        header: opts.titulo,
        message: mensaje,
        buttons: [
          { text: 'Cancelar', role: 'cancel', handler: () => cerrar(false) },
          { text: opts.okText ?? 'Aceptar', role: opts.peligro ? 'destructive' : 'confirm', handler: () => cerrar(true) },
        ],
        onDidDismiss: () => cerrar(false), // tap fuera / back = cancelar
      });
    });
}
