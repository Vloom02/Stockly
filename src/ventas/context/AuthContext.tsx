// ═══════════════════════════════════════════════════════════════════════════
// Sesión y local (sucursal) de ventas = los de Stockly. Este hook los traduce
// al formato de la base (snake_case) que usan las pantallas de ventas.
// ═══════════════════════════════════════════════════════════════════════════
import { useMemo } from 'react';
import { useAuth as useAuthStockly } from '../../context/AuthContext';
import { useStore } from '../../context/StoreContext';
import { Comercio, Miembro, Sucursal } from '../types';

export function useAuth() {
  const { comercio: c, miembro: m } = useAuthStockly();
  const { state, setSucursalActiva: elegirSucursal } = useStore();

  // Memo por campos (no por objeto): Stockly recrea `comercio` en cada refresco de
  // token y los efectos de ventas (catálogo, realtime) dependen de su identidad.
  const comercio = useMemo<Comercio | null>(
    () => (c ? { id: c.id, nombre: c.nombre, plan: c.plan, trial_hasta: c.trialHasta ?? '' } : null),
    [c?.id, c?.nombre, c?.plan, c?.trialHasta],
  );
  const miembro = useMemo<Miembro | null>(
    () => (m ? { id: m.id, user_id: m.userId, comercio_id: m.comercioId, rol: m.rol, nombre: m.nombre ?? '' } : null),
    [m?.id, m?.userId, m?.comercioId, m?.rol, m?.nombre],
  );
  const sucursales = useMemo<Sucursal[]>(
    () => state.sucursales.map(s => ({ id: s.id!, comercio_id: s.comercioId ?? '', nombre: s.nombre, direccion: s.direccion, activa: s.activa })),
    [state.sucursales],
  );
  // Por campos también: `sucursales` se recrea en cada recarga de Mercadería y el catálogo y el
  // tiempo real de Vender se volvían a bajar y a conectar aunque el local fuera el mismo.
  const act = sucursales.find(s => s.id === state.sucursalActivaId);
  const sucursalActiva = useMemo<Sucursal | null>(
    () => (act ? { ...act } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [act?.id, act?.nombre, act?.direccion, act?.activa, act?.comercio_id],
  );

  return {
    comercio, miembro, sucursales, sucursalActiva,
    setSucursalActiva: (s: Sucursal) => elegirSucursal(s.id),
  };
}
