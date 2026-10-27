// Aviso de versión nueva: la última versión publicada está en los Releases de GitHub del repo
// (con el APK firmado como archivo adjunto). Solo en la app instalada y una vez por arranque.
import { Capacitor } from '@capacitor/core';

const REPO = 'Vloom02/Stockly';

/** "v1.2.0" > "1.1.9" → true. Compara número por número. */
export function esMasNueva(publicada: string, actual: string): boolean {
  const n = (v: string) => v.replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
  const [a, b] = [n(publicada), n(actual)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export interface Actualizacion { version: string; url: string }
let consulta: Promise<Actualizacion | null> | null = null;

export function buscarActualizacion(): Promise<Actualizacion | null> {
  if (!Capacitor.isNativePlatform() || !navigator.onLine) return Promise.resolve(null);
  return consulta ??= fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then(r => (r.ok ? r.json() : null))
    .then(rel => {
      if (!rel?.tag_name || !esMasNueva(rel.tag_name, __APP_VERSION__)) return null;
      const apk = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith('.apk'));
      return { version: rel.tag_name.replace(/^v/, ''), url: apk?.browser_download_url ?? rel.html_url };
    })
    .catch(() => null);
}
