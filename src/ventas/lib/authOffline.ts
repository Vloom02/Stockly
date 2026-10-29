// ═══════════════════════════════════════════════════════════════════════════
// Fallback OFFLINE para el PIN del dueño y el login de cajeros.
// Tras una verificación online exitosa se guarda un hash PBKDF2-SHA256
// (150.000 iteraciones, sal aleatoria) del secreto en IndexedDB, con
// vencimiento de 72 h. Si el RPC falla por falta de conexión, se verifica
// contra ese hash local. Nunca se guarda el secreto en claro; PBKDF2 con sal
// hace caro el crackeo incluso con acceso físico al dispositivo, y el
// vencimiento corto limita la ventana si el dueño cambia el PIN o da de baja
// a un cajero mientras el equipo está sin internet.
// ═══════════════════════════════════════════════════════════════════════════
import { openDB, getLocalSetting, setLocalSetting } from './outbox';

const VIGENCIA_MS = 72 * 60 * 60 * 1000; // 72 horas desde el último login online
const ITERACIONES = 150_000;

interface Entrada {
  salt: string;   // base64
  hash: string;   // base64
  exp: number;    // epoch ms
  extra?: unknown; // datos para reconstruir la sesión offline (ej. cajero)
}

async function pbkdf2(secreto: string, saltB64: string): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERACIONES }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

/** Cachear una credencial verificada online (pisa la anterior). */
export async function guardarCredencialOffline(clave: string, secreto: string, extra?: unknown): Promise<void> {
  try {
    await openDB();
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = btoa(String.fromCharCode(...saltBytes));
    const hash = await pbkdf2(secreto, salt);
    const e: Entrada = { salt, hash, exp: Date.now() + VIGENCIA_MS, extra };
    await setLocalSetting(clave, JSON.stringify(e));
    await setLocalSetting(claveFallos(clave), ''); // entró bien con internet: se perdonan los fallos
  } catch { /* sin cache no hay fallback offline, pero el login online no se rompe */ }
}

// Intentos sin internet: igual que el servidor, cada 5 fallos se traba un rato (15 min, 30, 45…).
// Antes se podían probar los 10.000 PIN de 4 números con el celular en modo avión.
const FALLOS_POR_BLOQUEO = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
interface Fallos { n: number; hasta: number }
const claveFallos = (clave: string) => `${clave}:fallos`;

async function leerFallos(clave: string): Promise<Fallos> {
  try { return JSON.parse((await getLocalSetting(claveFallos(clave))) || '{"n":0,"hasta":0}'); } catch { return { n: 0, hasta: 0 }; }
}

/** Verificar contra la cache local. Solo usar cuando el RPC falló por conexión. */
export async function verificarCredencialOffline(
  clave: string, secreto: string,
): Promise<{ ok: boolean; extra?: unknown; bloqueadoHasta?: number }> {
  try {
    await openDB();
    const f = await leerFallos(clave);
    if (Date.now() < f.hasta) return { ok: false, bloqueadoHasta: f.hasta };
    const raw = await getLocalSetting(clave);
    if (!raw) return { ok: false };
    const e = JSON.parse(raw) as Entrada;
    if (!e.salt || !e.hash || Date.now() > e.exp) return { ok: false };
    const hash = await pbkdf2(secreto, e.salt);
    if (hash === e.hash) {
      await setLocalSetting(claveFallos(clave), '');
      return { ok: true, extra: e.extra };
    }
    const n = f.n + 1;
    const hasta = n % FALLOS_POR_BLOQUEO === 0 ? Date.now() + BLOQUEO_MS * (n / FALLOS_POR_BLOQUEO) : 0;
    await setLocalSetting(claveFallos(clave), JSON.stringify({ n, hasta }));
    return hasta ? { ok: false, bloqueadoHasta: hasta } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** ¿Hay una credencial cacheada vigente? (para UI offline, sin verificar el secreto) */
export async function hayCredencialOffline(clave: string): Promise<boolean> {
  try {
    await openDB();
    const raw = await getLocalSetting(clave);
    if (!raw) return false;
    const e = JSON.parse(raw) as Entrada;
    return !!e.hash && Date.now() <= e.exp;
  } catch {
    return false;
  }
}

export const CLAVE_PIN_DUENO = 'auth_offline_pin_dueno';
export const clavePorLegajo = (legajo: string) => `auth_offline_cajero_${legajo.trim().toLowerCase()}`;
