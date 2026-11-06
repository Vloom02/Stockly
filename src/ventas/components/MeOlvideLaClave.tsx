import React from 'react';
import { useIonAlert } from '@ionic/react';

/** El dueño sin su clave no entra a Caja, Fiado ni Resúmenes, y cambiarla pide la actual: que sepa a quién recurrir. */
const MeOlvideLaClave: React.FC = () => {
  const [present] = useIonAlert();
  return (
    <button type="button"
      onClick={() => present({
        header: 'Me olvidé la clave',
        message: 'Para crear una clave nueva escribinos por WhatsApp al +54 9 11 2538-9308. Tus datos están a salvo: no se borra nada.',
        buttons: ['Entendido'],
      })}
      style={{ minHeight: 48, padding: '0 18px', marginBottom: 12, borderRadius: 'var(--radius-full)', border: '1.5px solid var(--border)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      Me olvidé la clave
    </button>
  );
};

export default MeOlvideLaClave;
