// ═══════════════════════════════════════════════════════════════════════════
// Cajeros por legajo + contraseña (capa de la app, sobre la cuenta del negocio).
// El cajero inicia su turno → queda como "empleado activo" y sus ventas se
// atribuyen a él. Distinto de los empleados de Stockly (que son cuentas).
// ═══════════════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { openDB, getLocalSetting, setLocalSetting } from '../lib/outbox';
import { guardarCredencialOffline, verificarCredencialOffline, clavePorLegajo } from '../lib/authOffline';

export interface EmpleadoVenta { id: string; legajo: string; nombre: string; activo?: boolean; }
export interface CajeroActivo { id: string; legajo: string; nombre: string; admin?: boolean; desde?: number; }

const KEY = 'cajero-activo';

interface Ctx {
  cajero: CajeroActivo | null;
  empleados: EmpleadoVenta[];
  hayEmpleados: boolean;            // hay ≥1 cajero activo definido
  cargando: boolean;
  iniciarTurno: (legajo: string, pass: string) => Promise<string | null>; // null=ok, string=error
  entrarComoAdmin: (nombre?: string) => void;
  cerrarTurno: () => void;
  recargar: () => Promise<void>;
}

const C = createContext<Ctx | undefined>(undefined);

export const EmpleadoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { comercio } = useAuth();
  const [cajero, setCajero] = useState<CajeroActivo | null>(null);
  const [empleados, setEmpleados] = useState<EmpleadoVenta[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!comercio) { setEmpleados([]); return; }
    try {
      const { data } = await supabase.rpc('listar_empleados_venta', { p: { comercio_id: comercio.id } });
      setEmpleados((data as EmpleadoVenta[]) ?? []);
    } catch { /* sin red: dejamos lo que haya */ }
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
            setCajero(c);
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
    const { ok, extra } = await verificarCredencialOffline(clavePorLegajo(legajo), pass);
    const e = extra as { id?: string; legajo?: string; nombre?: string } | undefined;
    if (!ok || !e?.id) return 'Sin conexión y sin login reciente de este legajo';
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

  const hayEmpleados = empleados.some(e => e.activo !== false);

  return (
    <C.Provider value={{ cajero, empleados, hayEmpleados, cargando, iniciarTurno, entrarComoAdmin, cerrarTurno, recargar }}>
      {children}
    </C.Provider>
  );
};

export const useEmpleado = () => {
  const ctx = useContext(C);
  if (!ctx) throw new Error('useEmpleado must be inside EmpleadoProvider');
  return ctx;
};
