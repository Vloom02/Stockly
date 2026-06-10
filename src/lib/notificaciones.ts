// ═══════════════════════════════════════════════════════════════════════════
// Notificaciones LOCALES de vencimiento (sin servidor / sin Firebase).
// Cada vez que cambian los lotes, reprogramamos un aviso para la próxima mañana
// con el resumen de productos vencidos / por vencer. Si el usuario abre la app
// antes de esa hora, se reprograma → solo molesta cuando NO revisó el stock.
// ═══════════════════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LoteConProducto } from '../types';
import { ordenNivel } from './vencimientos';
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

/**
 * Reprograma el aviso de vencimiento a partir de los lotes enriquecidos.
 * No-op fuera de Android. Pide permiso solo si los avisos están activos.
 */
export async function sincronizarNotificaciones(lotes: LoteConProducto[]): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;

  try {
    // Siempre limpiamos el aviso anterior antes de decidir.
    await LocalNotifications.cancel({ notifications: [{ id: NOTIF_ID }] });

    if (!notificacionesActivas()) return;

    // Solo lo accionable: vencidos + críticos + urgentes.
    const relevantes = lotes
      .filter(l => l.nivelAlerta === 'vencido' || l.nivelAlerta === 'critico' || l.nivelAlerta === 'urgente')
      .sort((a, b) => ordenNivel(a.nivelAlerta) - ordenNivel(b.nivelAlerta) || a.diasRestantes - b.diasRestantes);

    if (relevantes.length === 0) return;

    // Permiso (solo lo pedimos si hay algo para avisar).
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return;
    }

    const vencidos = relevantes.filter(l => l.nivelAlerta === 'vencido').length;
    const top = relevantes.slice(0, 3).map(l => `• ${l.productoNombre} — ${textoVence(l.diasRestantes)}`);
    const resto = relevantes.length - top.length;
    if (resto > 0) top.push(`…y ${resto} más`);

    const title = vencidos > 0
      ? `⚠️ ${vencidos} producto${vencidos !== 1 ? 's' : ''} vencido${vencidos !== 1 ? 's' : ''}`
      : `${relevantes.length} producto${relevantes.length !== 1 ? 's' : ''} por vencer`;

    await LocalNotifications.schedule({
      notifications: [{
        id: NOTIF_ID,
        title,
        body: top.join('\n'),
        largeBody: top.join('\n'),
        summaryText: 'Vencimientos',
        schedule: { at: proximaHora(horaNotificacion()), allowWhileIdle: true },
        smallIcon: 'ic_stat_icon',
        iconColor: '#e7bd4d',
      }],
    });
  } catch (e) {
    // En web o si el plugin no está, no rompemos la app.
    console.warn('No se pudo programar la notificación de vencimiento', e);
  }
}
