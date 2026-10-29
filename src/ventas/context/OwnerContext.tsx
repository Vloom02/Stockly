// ═══════════════════════════════════════════════════════════════════════════
// Modo Dueño protegido por PIN (escenario cuenta compartida).
// - El PIN se hashea SERVER-SIDE en bcrypt (RPC configurar_pin) y se verifica
//   server-side con lockout de intentos (RPC verificar_pin, migración 4).
// - Si no hay PIN configurado, el dueño lo crea la primera vez.
// - Una vez desbloqueado, se re-bloquea tras N min sin uso (15 por defecto), avisando
//   30 s antes con un botón para seguir (WCAG 2.2.1: poder extender el tiempo).
// ═══════════════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import {
  guardarCredencialOffline, verificarCredencialOffline, hayCredencialOffline, CLAVE_PIN_DUENO,
} from '../lib/authOffline';

// Minutos de inactividad antes de re-bloquear el modo dueño. Configurable por
// el dueño (preferencia local del dispositivo); antes era fijo en 5 min y el
// dueño terminaba tipeando el PIN decenas de veces por día.
const LOCK_KEY = 'ventas:pin-lock-min';
const TIENE_PIN_KEY = 'ventas:tiene-pin';
export const OPCIONES_LOCK = [5, 15, 30, 60, 120];
const AVISO_SEG = 30; // aviso antes de bloquear (WCAG 2.2.1 pide al menos 20 s)
const leerLockMin = (): number => {
  const v = parseInt(localStorage.getItem(LOCK_KEY) ?? '15', 10);
  return OPCIONES_LOCK.includes(v) ? v : 15;
};

interface OwnerCtx {
  hasPin: boolean;        // ya hay un PIN configurado en este comercio
  isUnlocked: boolean;    // modo dueño activo ahora
  loading: boolean;
  lockMin: number;        // minutos de auto-bloqueo por inactividad
  setLockMin: (m: number) => void;
  setPin:    (pin: string) => Promise<boolean>;   // crear/cambiar PIN (debe estar desbloqueado o ser primera vez)
  tryUnlock: (pin: string) => Promise<boolean>;   // verificar PIN e ingresar a modo dueño
  lock:      () => void;                           // salir de modo dueño
  keepAlive: () => void;                           // resetea el timer de inactividad
  avisoBloqueo: boolean;                           // faltan AVISO_SEG para bloquearse
}

const Ctx = createContext<OwnerCtx | undefined>(undefined);

export const OwnerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { comercio } = useAuth();
  const [hasPin, setHasPin]       = useState(false);
  const [isUnlocked, setUnlocked] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [lockMin, setLockMinState] = useState(leerLockMin);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [avisoBloqueo, setAvisoBloqueo] = useState(false);

  const setLockMin = useCallback((m: number) => {
    localStorage.setItem(LOCK_KEY, String(m));
    setLockMinState(m);
  }, []);

  // Cargar si el comercio ya tiene PIN configurado
  useEffect(() => {
    (async () => {
      if (!comercio) { setLoading(false); return; }
      setLoading(true);
      try {
        // RPC: los miembros ya no leen el hash directamente (hardening del PIN).
        const { data, error } = await supabase.rpc('tiene_pin', { p: { comercio_id: comercio.id } });
        if (error) throw error;
        setHasPin(data === true);
        localStorage.setItem(TIENE_PIN_KEY, data === true ? '1' : '');
      } catch {
        // Sin conexión: lo último que dijo el servidor, o un PIN cacheado vigente. Antes, vencido
        // el PIN cacheado (72 h), "no había PIN" y la tablet quedaba sin pedir turno.
        setHasPin(localStorage.getItem(TIENE_PIN_KEY) === '1' || await hayCredencialOffline(CLAVE_PIN_DUENO));
      }
      setUnlocked(false);
      setLoading(false);
    })();
  }, [comercio]);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (avisoRef.current) { clearTimeout(avisoRef.current); avisoRef.current = null; }
    setAvisoBloqueo(false);
  };

  const lock = useCallback(() => {
    clearTimer();
    setUnlocked(false);
  }, []);

  const keepAlive = useCallback(() => {
    if (!isUnlocked) return;
    clearTimer();
    const total = lockMin * 60 * 1000;
    avisoRef.current = setTimeout(() => setAvisoBloqueo(true), total - AVISO_SEG * 1000);
    timerRef.current = setTimeout(() => { setAvisoBloqueo(false); setUnlocked(false); }, total);
  }, [isUnlocked, lockMin]);

  // Arrancar timer al desbloquear, y reiniciarlo si el dueño cambia los minutos
  // (keepAlive cambia con lockMin; antes seguía corriendo con el valor viejo).
  useEffect(() => {
    if (isUnlocked) keepAlive();
    return clearTimer;
  }, [isUnlocked, keepAlive]);

  const setPin = useCallback(async (pin: string) => {
    if (!comercio || pin.length < 4) return false;
    try {
      // Server-side: hashea en bcrypt y valida que seas el dueño.
      const { error } = await supabase.rpc('configurar_pin', {
        p: { comercio_id: comercio.id, pin },
      });
      if (error) { console.error('[owner] setPin:', error.message); return false; }
      setHasPin(true);
      setUnlocked(true); // al crear el PIN, queda en modo dueño
      guardarCredencialOffline(CLAVE_PIN_DUENO, pin); // habilitar fallback offline
      return true;
    } catch (e) {
      console.error('[owner] setPin error:', e);
      return false;
    }
  }, [comercio]);

  // Sin conexión: verificar contra la cache local (PBKDF2, vence a las 72 h
  // del último desbloqueo online). Ver lib/authOffline.ts.
  const unlockOffline = useCallback(async (pin: string) => {
    const { ok } = await verificarCredencialOffline(CLAVE_PIN_DUENO, pin);
    if (ok) setUnlocked(true);
    return ok;
  }, []);

  const tryUnlock = useCallback(async (pin: string) => {
    if (!comercio) return false;
    try {
      // Verificación SERVER-SIDE: el hash nunca viaja al cliente, así un
      // empleado no puede leerlo y crackear el PIN offline.
      const { data, error } = await supabase.rpc('verificar_pin', {
        p: { comercio_id: comercio.id, pin },
      });
      if (error) {
        // Error de red/RPC (no un PIN incorrecto) → intentar fallback offline.
        console.error('[owner] tryUnlock:', error.message);
        return unlockOffline(pin);
      }
      if (data === true) {
        setUnlocked(true);
        guardarCredencialOffline(CLAVE_PIN_DUENO, pin); // renovar cache offline
        return true;
      }
      return false; // PIN incorrecto online: NO probar la cache
    } catch (e) {
      console.error('[owner] tryUnlock error:', e);
      return unlockOffline(pin);
    }
  }, [comercio, unlockOffline]);

  return (
    <Ctx.Provider value={{ hasPin, isUnlocked, loading, lockMin, setLockMin, setPin, tryUnlock, lock, keepAlive, avisoBloqueo }}>
      {children}
      {isUnlocked && avisoBloqueo && (
        <div role="alertdialog" aria-live="assertive" className="anim-subir"
          style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(84px + var(--sab, env(safe-area-inset-bottom)))', zIndex: 2000, padding: 16, borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '2px solid var(--color-primary)', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Se va a bloquear en 30 segundos</div>
          <div style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 12 }}>Por seguridad, las opciones del dueño se cierran si no se usan.</div>
          <button type="button" onClick={keepAlive} className="pressable boton-marca"
            style={{ width: '100%', minHeight: 52, borderRadius: 'var(--radius)', border: 'none', fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Seguir usando
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
};

export const useOwner = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOwner must be inside OwnerProvider');
  return ctx;
};
