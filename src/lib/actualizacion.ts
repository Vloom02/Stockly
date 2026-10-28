// Actualizaciones. La última versión publicada está en los Releases de GitHub del repo:
//  - stockly-web-X.Y.Z.zip: la parte web (pantallas y lógica). Se baja sola al abrir la app y se
//    aplica la próxima vez que se abre (Capgo Updater, modo manual). Si no arranca, vuelve sola atrás.
//  - Stockly-X.Y.Z.apk: solo hace falta cuando cambia algo nativo (un plugin, permisos). Para eso
//    el release dice "apk-minimo: X.Y.Z" y el dueño ve el aviso para bajar el APK.
// Lo arma scripts/publicar-version.sh.
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

interface Release { tag_name?: string; body?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] }

export type Plan =
  | { tipo: 'nada' }
  | { tipo: 'web'; version: string; url: string; checksum?: string }   // se baja sola
  | { tipo: 'apk'; version: string; url: string };                      // hay que instalar el APK

/** Qué hacer con el último release: nada, bajar la parte web, o pedir el APK (si el nativo quedó viejo). */
export function planDeActualizacion(rel: Release | null, versionWeb: string, versionNativa: string): Plan {
  if (!rel?.tag_name || !esMasNueva(rel.tag_name, versionWeb)) return { tipo: 'nada' };
  const version = rel.tag_name.replace(/^v/, '');
  const dato = (clave: string) => rel.body?.match(new RegExp(`^${clave}:\\s*(\\S+)`, 'm'))?.[1];
  const archivo = (fin: string) => rel.assets?.find(a => a.name.endsWith(fin))?.browser_download_url;
  const apkMinimo = dato('apk-minimo');
  const web = archivo('.zip');
  if ((apkMinimo && esMasNueva(apkMinimo, versionNativa)) || !web) {
    return { tipo: 'apk', version, url: archivo('.apk') ?? rel.html_url ?? `https://github.com/${REPO}/releases/latest` };
  }
  return { tipo: 'web', version, url: web, checksum: dato('sha256') };
}

export interface Actualizacion { version: string; url: string }
let consulta: Promise<Actualizacion | null> | null = null;

/**
 * Una vez por arranque (solo en la app instalada): si hay parte web nueva la baja y la deja lista
 * para la próxima apertura, sin preguntar. Devuelve algo solo si hace falta instalar un APK.
 */
export function buscarActualizacion(): Promise<Actualizacion | null> {
  if (!Capacitor.isNativePlatform() || !navigator.onLine) return Promise.resolve(null);
  return consulta ??= (async () => {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    const rel: Release | null = r.ok ? await r.json() : null;
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const nativa = (await CapacitorUpdater.getBuiltinVersion()).version;
    const plan = planDeActualizacion(rel, __APP_VERSION__, nativa);
    if (plan.tipo === 'apk') return { version: plan.version, url: plan.url };
    if (plan.tipo === 'web') {
      // Si ya se bajó en otra apertura, no se vuelve a bajar.
      const { bundles } = await CapacitorUpdater.list();
      const ya = bundles.find(b => b.version === plan.version && b.status !== 'error' && b.status !== 'deleted');
      const id = ya?.id ?? (await CapacitorUpdater.download({ url: plan.url, version: plan.version, checksum: plan.checksum })).id;
      await CapacitorUpdater.next({ id }); // se aplica al pasar a segundo plano o en el próximo arranque
    }
    return null;
  })().catch(e => { console.warn('[actualizacion]', e); return null; });
}

/**
 * Al arrancar: si quedó una versión bajada sin aplicar (la app se cerró del todo en vez de ir a
 * segundo plano), la aplica ya, antes de mostrar nada. Devuelve true si la app se va a recargar.
 */
export async function aplicarPendiente(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const sig = await CapacitorUpdater.getNextBundle();
    if (!sig || sig.status === 'error' || !esMasNueva(sig.version, __APP_VERSION__)) return false;
    await CapacitorUpdater.set({ id: sig.id });
    return true;
  } catch (e) { console.warn('[actualizacion]', e); return false; }
}

/** Avisa que esta versión arrancó bien; si no se llama, Capgo vuelve a la anterior. */
export async function marcarArranqueOk(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  await CapacitorUpdater.notifyAppReady();
}
