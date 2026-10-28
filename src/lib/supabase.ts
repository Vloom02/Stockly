import { createClient, processLock } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Mensaje claro si faltan las claves
  console.error(
    '⚠️ Faltan las claves de Supabase. Creá un archivo .env en la raíz con:\n' +
    'VITE_SUPABASE_URL=...\nVITE_SUPABASE_ANON_KEY=...\n' +
    'Ver supabase/SETUP.md para más detalle.'
  );
}

/** fetch con tiempo límite: en el celular una red colgada dejaba consultas esperando para siempre.
 *  Al vencer falla como sin internet y la app sigue con lo guardado (la cola reintenta). */
export function fetchConLimite(ms: number, base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return (input, init) => {
    if (typeof AbortSignal.timeout !== 'function') return base(input, init); // WebView muy viejo
    const limite = AbortSignal.timeout(ms);
    const signal = init?.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, limite]) : (init?.signal ?? limite);
    return base(input, { ...init, signal });
  };
}

// Placeholders si faltan las env (tests/CI): importar este módulo no debe tirar
// "supabaseUrl is required". El uso real se gatea con supabaseConfigurado.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'placeholder-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // La app es una sola ventana (WebView): el candado del navegador (navigator.locks) puede quedar
    // tomado al volver de segundo plano en Android y trabar todas las consultas.
    lock: processLock,
  },
  global: { fetch: fetchConLimite(45_000) }, // 45 s: alcanza para subir una foto con señal floja
});

export const supabaseConfigurado = !!(url && anonKey);
