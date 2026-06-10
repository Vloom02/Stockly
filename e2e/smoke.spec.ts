import { test, expect } from '@playwright/test';

// Smoke: la app debe bootear y mostrar el login (no quedar en blanco).
// Atraparía un error de inicialización del bundle como el que tuvo Ventas.
test('arranca y muestra el login', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', e => errores.push(e.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Bienvenido/ })).toBeVisible({ timeout: 15_000 });
  expect(errores, errores.join('\n')).toHaveLength(0);
});

test('muestra los campos de ingreso', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByPlaceholder('tu@email.com')).toBeVisible({ timeout: 15_000 });
});
