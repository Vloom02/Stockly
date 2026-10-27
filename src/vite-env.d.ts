/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

/** true si el build incluye android/app/google-services.json (ver vite.config.ts). */
declare const __PUSH_DISPONIBLE__: boolean;
declare const __APP_VERSION__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
