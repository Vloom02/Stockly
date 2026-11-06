import React from 'react';
import { useHistory } from 'react-router-dom';
import { ArrowLeftIcon } from './ui/icons';

/** Salida segura: siempre hay un "Volver" grande arriba. Vuelve de verdad a donde estaba: con `push`, el atrás de Android
 *  después volvía a esta misma pantalla. */
const BotonVolver: React.FC<{ a?: string }> = ({ a = '/ventas/mas' }) => {
  const history = useHistory();
  return (
    <button type="button" onClick={() => { if (history.length > 1) history.goBack(); else history.push(a); }} className="pressable"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 16px 0 10px', marginBottom: 12, borderRadius: 'var(--radius-full)', border: 'none', boxShadow: 'var(--shadow-sm)', background: 'var(--surface)', color: 'var(--text)', fontSize: 17, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      <ArrowLeftIcon size={22} /> Volver
    </button>
  );
};

export default BotonVolver;
