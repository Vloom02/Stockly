import { createClient } from '@supabase/supabase-js';

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

// Placeholders si faltan las env (tests/CI): importar este módulo no debe tirar
// "supabaseUrl is required". El uso real se gatea con supabaseConfigurado.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'placeholder-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const supabaseConfigurado = !!(url && anonKey);
