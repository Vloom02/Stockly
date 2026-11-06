import React from 'react';
import { useVentas } from '../context/VentasContext';

/** Plata para devolverle a un cliente. Queda a la vista hasta que alguien toca "Ya lo devolví". */
const AvisosDevolver: React.FC = () => {
  const { state, marcarDevuelto } = useVentas();
  if (state.avisos.length === 0) return null;
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      {state.avisos.map(a => (
        <div key={a.id} style={{ padding: 14, borderRadius: 'var(--radius)', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', color: 'var(--color-danger-dark)' }}>
          <p style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px', lineHeight: 1.35 }}>{a.texto}</p>
          <button type="button" onClick={() => marcarDevuelto(a.id)} className="pressable"
            style={{ minHeight: 48, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--color-danger-border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Ya lo devolví
          </button>
        </div>
      ))}
    </div>
  );
};

export default AvisosDevolver;
