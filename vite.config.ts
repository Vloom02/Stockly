/// <reference types="vitest" />
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
});
