/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
