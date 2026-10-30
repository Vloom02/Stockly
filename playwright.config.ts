import { defineConfig } from '@playwright/test';

// Smoke E2E sobre el paquete REAL (vite preview del build), no el dev server: los errores de
// inicialización del bundle (como el de manualChunks) solo aparecen compilado. En CI el build ya está hecho.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `${process.env.CI ? '' : 'npm run build && '}npx vite preview --port 4173 --strictPort`,
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
