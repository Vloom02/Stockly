/// <reference types="vitest" />
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Lista de lo que la app puede cargar (CSP): si se colara un script (un nombre de producto con código, una librería
// comprometida), no puede mandar datos a otro lado ni cargar nada de afuera. Solo al compilar: en desarrollo Vite
// mete scripts en línea. El Supabase sale del .env del build (producción o el local de pruebas).
function csp(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const supa = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : '';
  const sentry = new URL(env.VITE_SENTRY_DSN || 'https://o4511522176499712.ingest.us.sentry.io').origin;
  const politica = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // estilos en línea de React e Ionic
    `img-src 'self' data: blob: ${supa}`, // fotos de productos (Storage)
    "font-src 'self' data:",
    // Destinos exactos: con "*.sentry.io" o toda la API de GitHub, un script colado podía mandar datos a una cuenta propia.
    `connect-src 'self' ${supa} ${supa.replace(/^http/, 'ws')} https://api.github.com/repos/Vloom02/Stockly/releases/latest ${sentry}`,
    "media-src 'self' blob: mediastream:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'stockly-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: politica }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), csp(mode)],
  define: {
    // Sin google-services.json, PushNotifications.register() tira una excepción NATIVA
    // ("Default FirebaseApp is not initialized") que cierra la app y JS no puede atajar.
    // Se decide al compilar: solo se registra push si el APK lleva la config de Firebase.
    __PUSH_DISPONIBLE__: JSON.stringify(existsSync('android/app/google-services.json')),
    // Versión instalada, para el aviso de versión nueva (lib/actualizacion.ts).
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
  },
  build: {
    // Sin manualChunks: agrupar react/ionic a mano causó un error de inicialización
    // (TDZ) y pantalla en blanco en el build de producción de Ventas. El chunking
    // por defecto + lazy-load de rutas ya divide bien el bundle.
    chunkSizeWarningLimit: 2000,
    // Ionic no marca sus componentes como "sin efectos al importarse" y entraban los ~90, aunque la app usa
    // unos pocos: así queda solo lo que se importa (el paquete principal baja ~38%). No cambia cómo se
    // parte el paquete (el problema de manualChunks era ese).
    rollupOptions: {
      treeshake: { moduleSideEffects: id => !/@ionic[\\/]core[\\/]components[\\/]ion-[^\\/]+\.js$/.test(id) },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
}));
