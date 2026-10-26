import React from 'react';
import { FingerPrintIcon } from './ui/icons';

/** Botón grande "Usar mi huella" (se muestra arriba del teclado de PIN). */
const BotonHuella: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} className="pressable anim-pop"
    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', maxWidth: 300, minHeight: 60, marginBottom: 20, borderRadius: 'var(--radius-lg)', border: '2px solid var(--color-primary)', background: 'var(--color-primary-bg)', color: 'var(--text)', fontSize: 19, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
    <FingerPrintIcon size={30} color="var(--color-primary-dark)" /> Usar mi huella
  </button>
);

export default BotonHuella;
