/// <reference types="vitest" />
import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Sin google-services.json, PushNotifications.register() tira una excepción NATIVA
    // ("Default FirebaseApp is not initialized") que cierra la app y JS no puede atajar.
    // Se decide al compilar: solo se registra push si el APK lleva la config de Firebase.
    __PUSH_DISPONIBLE__: JSON.stringify(existsSync('android/app/google-services.json')),
  },
  build: {
    // Sin manualChunks: agrupar react/ionic a mano causó un error de inicialización
    // (TDZ) y pantalla en blanco en el build de producción de Ventas. El chunking
    // por defecto + lazy-load de rutas ya divide bien el bundle.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
