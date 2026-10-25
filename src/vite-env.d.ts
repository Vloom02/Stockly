/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

/** true si el build incluye android/app/google-services.json (ver vite.config.ts). */
declare const __PUSH_DISPONIBLE__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
