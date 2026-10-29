import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Comercio, Miembro } from '../types';
import { almacenGet, almacenSet, almacenRemove } from '../lib/almacen';
import { useConfirm } from '../lib/useConfirm';
import { olvidarPush } from '../lib/push';

interface AuthContextValue {
  session: Session | null;
  comercio: Comercio | null;
  miembro: Miembro | null;
  /** true salvo para empleados o mientras un cajero tiene el turno en este dispositivo.
   *  Sin miembro cargado (offline) no se recorta nada. */
  esDueno: boolean;
  /** Cajero (no el dueño) con el turno abierto con PIN en este dispositivo; lo avisa EmpleadoProvider.
   *  Lo que hace queda a su nombre en el historial. */
  cajeroEnTurno: string | null;
  setCajeroEnTurno: (nombre: string | null) => void;
  /** Desarrollador / soporte de la plataforma (tabla plataforma_admins). */
  esAdminPlataforma: boolean;
  cargando: boolean;
  registrarse: (email: string, password: string, nombre: string, nombreComercio: string) => Promise<{ error?: string }>;
  iniciarSesion: (email: string, password: string) => Promise<{ error?: string }>;
  /** Olvidé mi contraseña: manda un código al email y con ese código se elige una nueva. */
  pedirCodigo: (email: string) => Promise<{ error?: string }>;
  cambiarConCodigo: (email: string, codigo: string, password: string) => Promise<{ error?: string }>;
  cerrarSesion: () => Promise<void>;
  recargarComercio: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [miembro, setMiembro] = useState<Miembro | null>(null);
  const [esAdminPlataforma, setEsAdminPlataforma] = useState(false);
  const adminConsultadoPara = useRef<string | null>(null); // es_admin_plataforma: una vez por usuario
  const [cargando, setCargando] = useState(true);
  const [cajeroEnTurno, setCajeroEnTurno] = useState<string | null>(null);
  const cargadoPara = useRef<string | null>(null); // usuario con datos ya traídos del servidor

  // Cargar comercio + membresía del usuario logueado
  const cargarDatosUsuario = async (userId: string) => {
    // Rol de soporte: si la función no existe (migración 8 sin aplicar) queda en false.
    if (adminConsultadoPara.current !== userId) {
      adminConsultadoPara.current = userId;
      supabase.rpc('es_admin_plataforma').then(({ data, error }) => {
        if (error) adminConsultadoPara.current = null; // sin red: se vuelve a preguntar después
        else setEsAdminPlataforma(data === true);
      }, () => { adminConsultadoPara.current = null; });
    }
    const { data: miembros, error } = await supabase
      .from('miembros')
      .select('*, comercios(*)')
      .eq('user_id', userId)
      .limit(1);
    // Sin red Supabase no tira: devuelve el error. Se sigue con lo guardado en el celular.
    if (error) throw new Error(error.message);
    cargadoPara.current = userId;

    if (miembros && miembros.length > 0) {
      const m = miembros[0] as any;
      const miembroData = {
        id: m.id,
        userId: m.user_id,
        comercioId: m.comercio_id,
        rol: m.rol,
        nombre: m.nombre,
      };
      setMiembro(miembroData);
      almacenSet('stockly:cache-miembro', JSON.stringify(miembroData));

      if (m.comercios) {
        const comercioData = {
          id: m.comercios.id,
          nombre: m.comercios.nombre,
          plan: m.comercios.plan,
          trialHasta: m.comercios.trial_hasta,
        };
        setComercio(comercioData);
        almacenSet('stockly:cache-comercio', JSON.stringify(comercioData));
      }
    }
  };

  // Respaldo offline: comercio/miembro guardados en el celular. Devuelve si había datos de ESTE usuario.
  const cargarDesdeCache = (userId: string): boolean => {
    try {
      const c = almacenGet('stockly:cache-comercio');
      const m = almacenGet('stockly:cache-miembro');
      if (!c || !m) return false;
      const mi = JSON.parse(m) as Miembro;
      if (mi.userId !== userId) return false; // quedó de otra cuenta
      setMiembro(mi);
      setComercio(JSON.parse(c));
      return true;
    } catch { return false; }
  };

  useEffect(() => {
    let montado = true;

    // Muestra lo guardado al instante y trae lo del servidor por detrás.
    // Sin datos guardados (primer ingreso) espera al servidor.
    const arrancarCon = async (s: Session | null) => {
      setSession(s);
      if (!s?.user) return;
      const uid = s.user.id;
      const pedido = cargarDatosUsuario(uid).catch(e => console.warn('Sin datos del servidor, sigo con lo guardado', e));
      if (!cargarDesdeCache(uid)) await pedido;
    };

    // Timeout de seguridad: si en 8s no resolvió, dejamos de cargar igual
    // (evita spinner infinito si no hay internet al abrir)
    const timeoutId = setTimeout(() => {
      if (!montado) return;
      const s = sesionGuardada();
      if (s) { setSession(prev => prev ?? s); cargarDesdeCache(s.user.id); }
      setCargando(false);
    }, 8000);

    // Sesión inicial. Sin internet y con el token vencido, getSession() da null con error
    // pero la sesión sigue guardada: se trabaja con ella y al volver la red se renueva sola.
    supabase.auth.getSession()
      .then(async ({ data, error }) => {
        if (!montado) return;
        await arrancarCon(data.session ?? (error ? sesionGuardada() : null));
      })
      .catch(async (e) => {
        console.warn('Error obteniendo sesión', e);
        if (montado) await arrancarCon(sesionGuardada());
      })
      .finally(() => {
        if (montado) {
          clearTimeout(timeoutId);
          setCargando(false);
        }
      });

    // Escuchar cambios de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, session) => {
      // El arranque lo resuelve getSession (con el respaldo sin internet): INITIAL_SESSION llega
      // en null cuando el token venció offline y cerraría la sesión.
      if (!montado || evento === 'INITIAL_SESSION') return;
      setSession(session);
      if (session?.user) {
        // Misma cuenta ya cargada: no hay nada que recargar. Si arrancó sin internet, ahora sí.
        if (evento === 'TOKEN_REFRESHED' && cargadoPara.current === session.user.id) return;
        // Fuera del aviso: consultar Supabase adentro del callback traba el candado de la sesión.
        const uid = session.user.id;
        setTimeout(() => { cargarDatosUsuario(uid).catch(e => console.warn('No se pudieron cargar datos del usuario', e)); }, 0);
      } else {
        cargadoPara.current = null;
        adminConsultadoPara.current = null;
        setComercio(null);
        setMiembro(null);
        setEsAdminPlataforma(false);
      }
    });

    return () => {
      montado = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const registrarse = async (email: string, password: string, nombre: string, nombreComercio: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nombre, nombre_comercio: nombreComercio } },
    });
    if (error) return { error: traducirError(error.message) };
    // Con confirmación por email, Supabase no da error si el mail ya existe: devuelve un usuario sin identidades.
    if (data.user && data.user.identities?.length === 0) {
      return { error: 'Ese email ya está registrado. Iniciá sesión con esa cuenta.' };
    }
    return {};
  };

  const iniciarSesion = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: traducirError(error.message) };
    return {};
  };

  const pedirCodigo = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return { error: traducirError(error.message) };
    return {};
  };

  // Con el código queda la sesión abierta y enseguida se guarda la contraseña nueva.
  const cambiarConCodigo = async (email: string, codigo: string, password: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token: codigo, type: 'recovery' });
    if (error) return { error: traducirError(error.message) };
    const { error: e2 } = await supabase.auth.updateUser({ password });
    if (e2) return { error: traducirError(e2.message) };
    return {};
  };

  const cerrarSesion = async () => {
    // Que este equipo deje de recibir los avisos de este comercio (necesita la sesión todavía).
    await Promise.race([olvidarPush(), new Promise(r => setTimeout(r, 3000))]);
    // Limpiar caché local primero (esto siempre funciona)
    try {
      const { limpiarTodoLocal } = await import('../lib/localDb');
      await limpiarTodoLocal();
    } catch { /* */ }
    try {
      almacenRemove('stockly:cache-comercio');
      almacenRemove('stockly:cache-miembro');
      localStorage.removeItem('ventas:carrito');
    } catch { /* */ }
    // Intentar signOut en la nube, pero sin bloquear si no hay internet
    try {
      await Promise.race([
        // Solo ESTE dispositivo: la misma cuenta puede estar abierta en el celular y en la tablet.
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    } catch { /* */ }
    // Pase lo que pase, limpiamos el estado local → vuelve al login
    cargadoPara.current = null;
    adminConsultadoPara.current = null;
    setCajeroEnTurno(null);
    setSession(null);
    setComercio(null);
    setMiembro(null);
    setEsAdminPlataforma(false);
  };

  // Volver a traer los datos del comercio (ej: tras activar la suscripción)
  const recargarComercio = async () => {
    if (session?.user) {
      await cargarDatosUsuario(session.user.id).catch(() => { /* */ });
    }
  };

  return (
    <AuthContext.Provider value={{
      session, comercio, miembro, esDueno: miembro?.rol !== 'empleado' && !cajeroEnTurno, cajeroEnTurno, setCajeroEnTurno,
      esAdminPlataforma, cargando,
      registrarse, iniciarSesion, pedirCodigo, cambiarConCodigo, cerrarSesion, recargarComercio,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}

/** Cerrar sesión borra lo guardado en el celular: si quedó algo sin mandar, antes se avisa. */
export function useCerrarSesion(): () => Promise<void> {
  const { cerrarSesion } = useAuth();
  const confirmar = useConfirm();
  return async () => {
    const { contarSinSubir } = await import('../lib/localDb');
    const n = await contarSinSubir().catch(() => 0);
    if (n > 0) {
      const s = n === 1 ? '' : 's';
      const ok = await confirmar(
        `Hay ${n} cambio${s} o venta${s} en este celular que todavía no llegaron a internet. Si cerrás la sesión ahora, se pierden. Conectate a internet y esperá a que se manden solos.`,
        { titulo: 'Quedan cosas sin mandar', okText: 'Cerrar igual y perderlos', peligro: true },
      );
      if (!ok) return;
    }
    await cerrarSesion();
  };
}

/** Sesión que Supabase dejó guardada. Sin internet y con el token vencido, getSession() da null
 *  pero no la borra: con ella se sigue trabajando y al volver la red se renueva (TOKEN_REFRESHED). */
function sesionGuardada(): Session | null {
  try {
    const clave = (supabase.auth as unknown as { storageKey: string }).storageKey;
    const s = JSON.parse(localStorage.getItem(clave) ?? 'null');
    return s?.user?.id && s.refresh_token ? s : null;
  } catch { return null; }
}

// Traducir errores comunes de Supabase al español
function traducirError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos';
  if (msg.includes('User already registered')) return 'Ese email ya está registrado';
  if (msg.includes('Password should be at least')) return 'La contraseña es muy corta (mínimo 8 caracteres)';
  if (msg.includes('Unable to validate email')) return 'El email no es válido';
  if (msg.includes('Email not confirmed')) return 'Confirmá tu email antes de iniciar sesión';
  if (msg.includes('Token has expired or is invalid')) return 'El código no es correcto o ya venció. Pedí uno nuevo.';
  if (msg.includes('security purposes') || msg.includes('rate limit')) return 'Esperá un minuto antes de pedir otro código.';
  if (msg.includes('should be different')) return 'La contraseña nueva tiene que ser distinta de la anterior.';
  return msg;
}
