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
  | { tipo: 'web'; version: string; url: string; checksum: string }    // se baja sola
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
  // Sin huella no se instala: un zip cambiado en el camino se instalaría con la sesión del dueño.
  const checksum = dato('sha256');
  if (!checksum) return { tipo: 'nada' };
  return { tipo: 'web', version, url: web, checksum };
}

export interface Actualizacion { version: string; url: string }
export type Resultado = { tipo: 'nada' } | { tipo: 'web'; version: string } | ({ tipo: 'apk' } & Actualizacion);
let consulta: Promise<Actualizacion | null> | null = null;

/** Mira el último release. Si hay parte web nueva, la deja bajada (se aplica con aplicarPendiente). */
async function revisar(): Promise<Resultado> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
  const rel: Release = await r.json();
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  const nativa = (await CapacitorUpdater.getBuiltinVersion()).version;
  const plan = planDeActualizacion(rel, __APP_VERSION__, nativa);
  const { bundles } = await CapacitorUpdater.list();
  // Freno: si se despublicó una versión, lo que ya se había bajado de ella no se aplica.
  const ultima = rel.tag_name?.replace(/^v/, '');
  for (const b of bundles) if (ultima && esMasNueva(b.version, ultima)) await CapacitorUpdater.delete({ id: b.id }).catch(() => {});
  if (plan.tipo === 'apk') return { tipo: 'apk', version: plan.version, url: plan.url };
  // Una versión que ya falló en este equipo (Capgo volvió atrás) no se vuelve a bajar en cada arranque.
  if (plan.tipo === 'nada' || fallidas().includes(plan.version)) return { tipo: 'nada' };
  // Si ya se bajó en otra apertura, no se vuelve a bajar. NO se usa next(): aplicaba la versión
  // al pasar a segundo plano y la recarga vaciaba el carrito (ir a WhatsApp o a Mercado Pago).
  if (!bundles.some(b => b.version === plan.version && listo(b.status))) {
    await CapacitorUpdater.download({ url: plan.url, version: plan.version, checksum: plan.checksum });
  }
  return { tipo: 'web', version: plan.version };
}

/**
 * Una vez por arranque (solo en la app instalada): si hay parte web nueva la baja y la deja lista
 * para la próxima apertura, sin preguntar. Devuelve algo solo si hace falta instalar un APK.
 */
export function buscarActualizacion(): Promise<Actualizacion | null> {
  if (!Capacitor.isNativePlatform() || !navigator.onLine) return Promise.resolve(null);
  return consulta ??= revisar()
    .then(res => res.tipo === 'apk' ? { version: res.version, url: res.url } : null)
    .catch(e => { console.warn('[actualizacion]', e); return null; });
}

/** "Buscar actualización" de Ajustes: revisa ya. Tira si no se pudo (sin red, GitHub caído). */
export async function buscarAhora(): Promise<Resultado> {
  await consulta; // si la del arranque está bajando la misma versión, se espera (no se baja dos veces)
  return revisar();
}

const KEY_INTENTO = 'actualizacion:intento';
const KEY_FALLIDAS = 'actualizacion:fallidas';
function fallidas(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY_FALLIDAS) ?? '[]'); } catch { return []; }
}

/** Si se intentó aplicar `intento` y la app arrancó en una versión más vieja, esa versión falló. */
export function anotarSiFallo(intento: string | null, actual: string, lista: string[]): string[] {
  return intento && esMasNueva(intento, actual) && !lista.includes(intento) ? [...lista, intento] : lista;
}

const listo = (s: string) => s !== 'error' && s !== 'deleted' && s !== 'deleting' && s !== 'downloading';

/** La versión bajada más nueva que la actual, o null. */
export function versionParaAplicar<B extends { version: string; status: string }>(bundles: B[], actual: string): B | null {
  return bundles.filter(b => listo(b.status) && esMasNueva(b.version, actual))
    .sort((a, b) => (esMasNueva(a.version, b.version) ? -1 : 1))[0] ?? null;
}

/**
 * Al arrancar de cero: si hay una versión bajada y sin aplicar, la aplica ya, antes de mostrar
 * nada (no hay carrito ni pantalla a medio usar). Devuelve true si la app se va a recargar.
 */
export async function aplicarPendiente(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const sig = versionParaAplicar((await CapacitorUpdater.list()).bundles, __APP_VERSION__);
    if (!sig || fallidas().includes(sig.version)) return false;
    try { localStorage.setItem(KEY_INTENTO, sig.version); } catch { /* */ }
    await CapacitorUpdater.set({ id: sig.id });
    return true;
  } catch (e) { console.warn('[actualizacion]', e); return false; }
}

/** Avisa que esta versión arrancó bien; si no se llama, Capgo vuelve a la anterior. */
export async function marcarArranqueOk(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    localStorage.setItem(KEY_FALLIDAS, JSON.stringify(anotarSiFallo(localStorage.getItem(KEY_INTENTO), __APP_VERSION__, fallidas())));
    localStorage.removeItem(KEY_INTENTO);
  } catch { /* */ }
  const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
  await CapacitorUpdater.notifyAppReady();
}
