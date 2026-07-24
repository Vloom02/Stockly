// ═══════════════════════════════════════════════════════════════════════════
// Notificaciones LOCALES de vencimiento (sin servidor / sin Firebase).
// Cada vez que cambian los lotes, reprogramamos un aviso para la próxima mañana
// con el resumen de productos vencidos / por vencer. Si el usuario abre la app
// antes de esa hora, se reprograma → solo molesta cuando NO revisó el stock.
// ═══════════════════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LoteConProducto } from '../types';
import { ordenNivel, diasRestantes, nivelPorDias, UmbralesVencimiento } from './vencimientos';
import { almacenGet, almacenSet } from './almacen';

const NOTIF_ID = 4090; // id fijo: siempre pisamos el aviso anterior
const PREFIX = 'stockly:';
const KEY_ACTIVO = PREFIX + 'notif-vencimiento';
const KEY_HORA = PREFIX + 'notif-hora';

const getSetting = (k: string, def = '') => almacenGet(k, def);
const setSetting = (k: string, v: string) => almacenSet(k, v);

export function notificacionesActivas(): boolean {
  return getSetting(KEY_ACTIVO, '1') !== '0';
}
export function setNotificacionesActivas(v: boolean): void {
  setSetting(KEY_ACTIVO, v ? '1' : '0');
}
export function horaNotificacion(): number {
  const h = parseInt(getSetting(KEY_HORA, '9'), 10);
  return Number.isNaN(h) ? 9 : Math.min(23, Math.max(0, h));
}
export function setHoraNotificacion(h: number): void {
  setSetting(KEY_HORA, String(h));
}

function textoVence(dias: number): string {
  if (dias < 0) return dias === -1 ? 'venció ayer' : `venció hace ${-dias} días`;
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  return `vence en ${dias} días`;
}

/** Próxima ocurrencia de la hora elegida (hoy si todavía no pasó, si no mañana). */
function proximaHora(h: number): Date {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

// Umbrales configurables (mismos defaults que StoreContext).
function umbrales(): UmbralesVencimiento {
  const n = (k: string, def: number) => parseInt(getSetting(PREFIX + k, String(def)), 10) || def;
  return { critico: n('umbral-critico', 7), urgente: n('umbral-urgente', 30), aviso: n('umbral-aviso', 60) };
}

/**
 * Reprograma los avisos de vencimiento para los PRÓXIMOS 7 DÍAS a partir de los
 * lotes enriquecidos. Cada día se recalcula contra su fecha objetivo, así el
 * aviso del día 5 es correcto aunque el usuario no abra la app en el medio.
 * Al abrir la app, todo se reprograma con datos frescos.
 * No-op fuera de Android. Pide permiso solo si los avisos están activos.
 */
export async function sincronizarNotificaciones(lotes: LoteConProducto[]): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;

  const DIAS = 7;
  try {
    // Siempre limpiamos los avisos anteriores antes de decidir.
    await LocalNotifications.cancel({
      notifications: Array.from({ length: DIAS }, (_, d) => ({ id: NOTIF_ID + d })),
    });

    if (!notificacionesActivas()) return;

    const u = umbrales();
    const base = proximaHora(horaNotificacion());
    const aProgramar = [];

    for (let d = 0; d < DIAS; d++) {
      const objetivo = new Date(base);
      objetivo.setDate(objetivo.getDate() + d);

      // Recalcular qué estará vencido/crítico/urgente EN esa fecha.
      const relevantes = lotes
        .map(l => ({ lote: l, dias: diasRestantes(l.fechaVencimiento, objetivo) }))
        .map(x => ({ ...x, nivel: nivelPorDias(x.dias, u, x.lote.diasAviso) }))
        .filter(x => x.nivel === 'vencido' || x.nivel === 'critico' || x.nivel === 'urgente')
        .sort((a, b) => ordenNivel(a.nivel) - ordenNivel(b.nivel) || a.dias - b.dias);

      if (relevantes.length === 0) continue;

      const vencidos = relevantes.filter(x => x.nivel === 'vencido').length;
      const top = relevantes.slice(0, 3).map(x => `• ${x.lote.productoNombre} — ${textoVence(x.dias)}`);
      const resto = relevantes.length - Math.min(3, relevantes.length);
      if (resto > 0) top.push(`…y ${resto} más`);

      aProgramar.push({
        id: NOTIF_ID + d,
        title: vencidos > 0
          ? `⚠️ ${vencidos} producto${vencidos !== 1 ? 's' : ''} vencido${vencidos !== 1 ? 's' : ''}`
          : `${relevantes.length} producto${relevantes.length !== 1 ? 's' : ''} por vencer`,
        body: top.join('\n'),
        largeBody: top.join('\n'),
        summaryText: 'Vencimientos',
        schedule: { at: objetivo, allowWhileIdle: true },
        smallIcon: 'ic_stat_icon',
        iconColor: '#e7bd4d',
      });
    }

    if (aProgramar.length === 0) return;

    // Permiso (solo lo pedimos si hay algo para avisar).
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return;
    }

    await LocalNotifications.schedule({ notifications: aProgramar });
  } catch (e) {
    // En web o si el plugin no está, no rompemos la app.
    console.warn('No se pudo programar las notificaciones de vencimiento', e);
  }
}
