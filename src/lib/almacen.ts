import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

/**
 * Almacenamiento persistente robusto.
 *
 * Problema: localStorage en el WebView de Android puede ser borrado por el
 * sistema al limpiar memoria, perdiendo config, sesión y caché.
 *
 * Solución: usar @capacitor/preferences (almacenamiento nativo persistente)
 * como fuente durable, manteniendo una caché en memoria para lecturas
 * SÍNCRONAS (el resto del código lee de forma síncrona).
 *
 * - En arranque: hidratar() carga todo de Preferences a la caché.
 * - Lecturas: síncronas, desde la caché en memoria.
 * - Escrituras: actualizan la caché y persisten en Preferences (async, sin bloquear).
 * - Fallback web: si no es plataforma nativa, usa localStorage.
 */

const cache = new Map<string, string>();
let hidratado = false;

const esNativo = () => Capacitor.isNativePlatform();

/** Carga todas las claves persistidas a la caché en memoria. Llamar al arrancar. */
export async function hidratarAlmacenamiento(): Promise<void> {
  if (hidratado) return;
  try {
    if (esNativo()) {
      const { keys } = await Preferences.keys();
      for (const k of keys) {
        const { value } = await Preferences.get({ key: k });
        if (value !== null) cache.set(k, value);
      }
    } else {
      // Web: copiar localStorage a la caché
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) cache.set(k, localStorage.getItem(k) || '');
      }
    }
  } catch (e) {
    console.warn('No se pudo hidratar el almacenamiento', e);
  }
  hidratado = true;
}

/** Lectura SÍNCRONA desde la caché en memoria. */
export function almacenGet(key: string, def = ''): string {
  const v = cache.get(key);
  return v !== undefined ? v : def;
}

/** Escritura: actualiza caché (inmediato) y persiste (async, sin bloquear). */
export function almacenSet(key: string, value: string): void {
  cache.set(key, value);
  if (esNativo()) {
    Preferences.set({ key, value }).catch(() => { /* */ });
  } else {
    try { localStorage.setItem(key, value); } catch { /* */ }
  }
}

/** Borrado: de caché y de almacenamiento persistente. */
export function almacenRemove(key: string): void {
  cache.delete(key);
  if (esNativo()) {
    Preferences.remove({ key }).catch(() => { /* */ });
  } else {
    try { localStorage.removeItem(key); } catch { /* */ }
  }
}
