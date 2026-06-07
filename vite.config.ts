/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Separar los vendors pesados en chunks propios: se cachean entre deploys
    // (cambian poco) y se descargan en paralelo, acelerando la carga.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router', 'react-router-dom'],
          ionic: ['@ionic/react', '@ionic/react-router'],
          supabase: ['@supabase/supabase-js'],
          sentry: ['@sentry/react'],
        },
      },
    },
    chunkSizeWarningLimit: 1200, // el chunk de Ionic (~1.1 MB) es el framework: esperado y cacheado
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
