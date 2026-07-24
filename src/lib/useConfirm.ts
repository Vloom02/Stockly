// Confirmación con diálogo nativo de Ionic (reemplaza window.confirm, que se
// veía crudo y ajeno a la app). Devuelve una promesa: true si confirmó.
import { useIonAlert } from '@ionic/react';

interface OpcionesConfirm {
  titulo?: string;
  okText?: string;
  peligro?: boolean; // botón de confirmar en rojo
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
