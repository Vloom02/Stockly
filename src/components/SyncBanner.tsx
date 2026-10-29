import React from 'react';
import { CloudIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useOnline } from '../utils/useOnline';
import { useStore } from '../context/StoreContext';

/**
 * Banner que informa el estado de conexión y sincronización.
 * - Offline: muestra que los cambios se guardan local
 * - Sincronizando: spinner
 * - Pendientes: cuántos cambios faltan subir
 */
const SyncBanner: React.FC = () => {
  const online = useOnline();
  const { sincronizando, state, sincronizarAhora, reintentarFallidos } = useStore();

  // Si todo OK y sin pendientes, no mostrar nada
  if (online && !sincronizando && state.pendientesSync === 0 && state.bloqueadosSync === 0) return null;

  let bg = 'var(--surface-2)';
  let color = 'var(--text-2)';
  let icon = <CloudIcon width={16} height={16} />;
  let texto = '';
  let clickable = false;
  let accion = () => { sincronizarAhora(); };

  // En cuarentena: no se mandan solos (el servidor los rechazó). Antes no se veían en ningún lado.
  const n = state.bloqueadosSync;
  if (online && !sincronizando && n > 0) {
    bg = 'var(--level-vencido-bg)';
    color = 'var(--level-vencido-fg)';
    icon = <ExclamationTriangleIcon width={18} height={18} />;
    texto = `${n} cambio${n !== 1 ? 's' : ''} no se pudo guardar en internet · tocá acá para reintentar`;
    clickable = true;
    accion = () => { reintentarFallidos(); };
  } else if (!online) {
    bg = 'var(--level-aviso-bg)';
    color = 'var(--level-aviso-fg)';
    icon = <ExclamationTriangleIcon width={16} height={16} />;
    texto = state.pendientesSync > 0
      ? `Sin internet: ${state.pendientesSync} cambio${state.pendientesSync !== 1 ? 's' : ''} guardado${state.pendientesSync !== 1 ? 's' : ''}, se mandan solos cuando vuelva`
      : 'Sin internet: podés seguir usando la app, todo queda guardado';
  } else if (sincronizando) {
    bg = 'var(--brand-50)';
    color = 'var(--brand-700)';
    icon = <ArrowPathIcon width={16} height={16} style={{ animation: 'spin 0.8s linear infinite' }} />;
    texto = 'Guardando en la nube...';
  } else if (state.pendientesSync > 0) {
    bg = 'var(--brand-50)';
    color = 'var(--brand-700)';
    icon = <CloudIcon width={16} height={16} />;
    texto = `${state.pendientesSync} cambio${state.pendientesSync !== 1 ? 's' : ''} sin mandar · tocá acá para mandar ahora`;
    clickable = true;
  }

  const estilo: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    background: bg, color, border: 'none', fontFamily: 'inherit',
    borderRadius: 'var(--radius)', padding: '12px 14px', minHeight: 48,
    fontSize: 15, fontWeight: 600, marginBottom: 12,
    cursor: clickable ? 'pointer' : 'default',
  };
  // Botón de verdad cuando se puede tocar (se llega con el teclado y lo anuncia el lector de pantalla).
  return clickable ? (
    <button type="button" className="anim-bajar" onClick={accion} style={estilo}>{icon}<span>{texto}</span></button>
  ) : (
    <div role="status" className="anim-bajar" style={estilo}>{icon}<span>{texto}</span></div>
  );
};

export default SyncBanner;
