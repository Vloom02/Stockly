// ═══════════════════════════════════════════════════════════════════════════
// Cajeros por legajo + contraseña (capa de la app, sobre la cuenta del negocio).
// El cajero inicia su turno → queda como "empleado activo" y sus ventas se
// atribuyen a él. Distinto de los empleados de Stockly (que son cuentas).
// ═══════════════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useAuth as useAuthStockly } from '../../context/AuthContext';
import { useOwner } from './OwnerContext';
import { openDB, getLocalSetting, setLocalSetting } from '../lib/outbox';
import { guardarCredencialOffline, verificarCredencialOffline, clavePorLegajo } from '../lib/authOffline';

export interface EmpleadoVenta { id: string; legajo: string; nombre: string; activo?: boolean; }
export interface CajeroActivo { id: string; legajo: string; nombre: string; admin?: boolean; desde?: number; }

const KEY = 'cajero-activo';
const KEY_LISTA = 'empleados-cache';
const KEY_ACTIVIDAD = 'ventas:ultima-actividad-dueno';
/** Sin internet y sin clave guardada nadie queda trabado: se atiende "sin turno", solo vendiendo. */
export const SIN_TURNO: CajeroActivo = { id: 'sin-turno', legajo: '—', nombre: 'Sin turno' };

interface Ctx {
  cajero: CajeroActivo | null;
  empleados: EmpleadoVenta[];
  hayEmpleados: boolean;            // hay ≥1 cajero activo definido
  cargando: boolean;
  iniciarTurno: (legajo: string, pass: string) => Promise<string | null>; // null=ok, string=error
  entrarComoAdmin: (nombre?: string) => void;
  entrarSinTurno: () => void;
  cerrarTurno: () => void;
  recargar: () => Promise<void>;
}

const C = createContext<Ctx | undefined>(undefined);

export const EmpleadoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { comercio } = useAuth();
  const { lockMin } = useOwner();
  const [cajero, setCajero] = useState<CajeroActivo | null>(null);
  const [empleados, setEmpleados] = useState<EmpleadoVenta[]>([]);
  const [cargando, setCargando] = useState(true);

  // La lista se guarda en el celular: sin internet llegaba vacía, "no había empleados" y la
  // tablet quedaba sin turno, con todo lo del dueño a la vista.
  const recargar = useCallback(async () => {
    if (!comercio) { setEmpleados([]); return; }
    try {
      const { data, error } = await supabase.rpc('listar_empleados_venta', { p: { comercio_id: comercio.id } });
      if (error) throw error;
      const lista = (data as EmpleadoVenta[]) ?? [];
      setEmpleados(lista);
      openDB().then(() => setLocalSetting(KEY_LISTA, JSON.stringify(lista))).catch(() => {});
    } catch {
      try { await openDB(); const raw = await getLocalSetting(KEY_LISTA); if (raw) setEmpleados(JSON.parse(raw)); } catch { /* */ }
    }
  }, [comercio]);

  // Cargar el cajero persistido + la lista al entrar al comercio.
  useEffect(() => {
    if (!comercio) { setCargando(false); return; }
    setCargando(true);
    (async () => {
      try {
        await openDB();
        const saved = await getLocalSetting(KEY);
        if (saved) {
          try {
            const c = JSON.parse(saved) as CajeroActivo;
            // Backfill: un cajero viejo sin `desde` rompía el agrupado del turno.
            if (!c.desde) { c.desde = Date.now(); setLocalSetting(KEY, JSON.stringify(c)).catch(() => {}); }
            // El turno del dueño no sobrevive a la app cerrada más tiempo que el bloqueo.
            if (c.admin && Date.now() - Number(localStorage.getItem(KEY_ACTIVIDAD) ?? 0) > lockMin * 60_000) {
              setLocalSetting(KEY, '').catch(() => {});
            } else setCajero(c);
          } catch { /* */ }
        }
      } catch { /* */ }
      await recargar();
      setCargando(false);
    })();
  }, [comercio, recargar]);

  const persistir = (c: CajeroActivo | null) => {
    openDB().then(() => setLocalSetting(KEY, c ? JSON.stringify(c) : '')).catch(() => {});
  };

  // Sin conexión: verificar contra la cache local (PBKDF2, 72 h desde el
  // último login online de ESE legajo). Ver lib/authOffline.ts.
  const iniciarTurnoOffline = useCallback(async (legajo: string, pass: string): Promise<string | null> => {
    const { ok, extra, bloqueadoHasta } = await verificarCredencialOffline(clavePorLegajo(legajo), pass);
    const e = extra as { id?: string; legajo?: string; nombre?: string } | undefined;
    if (bloqueadoHasta) return `Muchos intentos. Esperá hasta las ${new Date(bloqueadoHasta).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.`;
    if (!ok || !e?.id) return 'Sin internet: la clave no coincide o no entraste con internet en los últimos 3 días';
    const c: CajeroActivo = { id: e.id, legajo: e.legajo!, nombre: e.nombre!, desde: Date.now() };
    setCajero(c); persistir(c);
    return null;
  }, []);

  const iniciarTurno = useCallback(async (legajo: string, pass: string): Promise<string | null> => {
    if (!comercio) return 'Sin comercio';
    try {
      const { data, error } = await supabase.rpc('verificar_empleado_venta', {
        p: { comercio_id: comercio.id, legajo: legajo.trim(), pass },
      });
      if (error) return iniciarTurnoOffline(legajo, pass); // error de red, no de credenciales
      const r = data as { ok?: boolean; id?: string; legajo?: string; nombre?: string };
      if (!r?.ok) return 'Legajo o contraseña incorrectos';
      const c: CajeroActivo = { id: r.id!, legajo: r.legajo!, nombre: r.nombre!, desde: Date.now() };
      setCajero(c); persistir(c);
      // Renovar el fallback offline de este legajo (72 h).
      guardarCredencialOffline(clavePorLegajo(legajo), pass, { id: r.id, legajo: r.legajo, nombre: r.nombre });
      return null;
    } catch {
      return iniciarTurnoOffline(legajo, pass);
    }
  }, [comercio, iniciarTurnoOffline]);

  const entrarComoAdmin = useCallback((nombre = 'Administrador') => {
    const c: CajeroActivo = { id: 'admin', legajo: '—', nombre, admin: true, desde: Date.now() };
    setCajero(c); persistir(c);
  }, []);

  const cerrarTurno = useCallback(() => { setCajero(null); persistir(null); }, []);

  const entrarSinTurno = useCallback(() => {
    const c = { ...SIN_TURNO, desde: Date.now() };
    setCajero(c); persistir(c);
  }, []);

  // El turno del dueño se cierra solo tras los minutos de bloqueo sin tocar la pantalla: si deja
  // la tablet del local, el que sigue no entra con todo lo del dueño (antes no vencía nunca).
  useEffect(() => {
    if (!cajero?.admin) return;
    const tocar = () => { try { localStorage.setItem(KEY_ACTIVIDAD, String(Date.now())); } catch { /* */ } };
    const revisar = () => {
      if (Date.now() - Number(localStorage.getItem(KEY_ACTIVIDAD) ?? 0) > lockMin * 60_000) cerrarTurno();
    };
    tocar();
    window.addEventListener('pointerdown', tocar, true);
    window.addEventListener('keydown', tocar, true);
    document.addEventListener('visibilitychange', revisar);
    const t = setInterval(revisar, 30_000);
    return () => {
      clearInterval(t);
      window.removeEventListener('pointerdown', tocar, true);
      window.removeEventListener('keydown', tocar, true);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, [cajero?.admin, lockMin, cerrarTurno]);

  // Con un cajero en turno, toda la app lo trata como empleado (sin precios, reportes, etc.).
  const { setCajeroEnTurno } = useAuthStockly();
  useEffect(() => { setCajeroEnTurno(cajero && !cajero.admin ? cajero.nombre : null); }, [cajero, setCajeroEnTurno]);

  const hayEmpleados = empleados.some(e => e.activo !== false);

  return (
    <C.Provider value={{ cajero, empleados, hayEmpleados, cargando, iniciarTurno, entrarComoAdmin, entrarSinTurno, cerrarTurno, recargar }}>
      {children}
    </C.Provider>
  );
};

export const useEmpleado = () => {
  const ctx = useContext(C);
  if (!ctx) throw new Error('useEmpleado must be inside EmpleadoProvider');
  return ctx;
};
