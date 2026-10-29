// ═══════════════════════════════════════════════════════════════════════════
// Push notifications (FCM). Solo en Android nativo.
// Pide permiso, registra el dispositivo y guarda el token en Supabase
// (tabla push_tokens) para que el envío de avisos de vencimiento llegue
// aunque la app esté cerrada. El envío se hace desde el servidor (Edge Function).
// ═══════════════════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import { almacenGet, almacenSet, almacenRemove } from './almacen';

const KEY_TOKEN = 'stockly:push-token';
const KEY_PUSH_OK = 'stockly:push-ok'; // = notificaciones.ts: con push andando no se programa el aviso local

let yaRegistrado = false;

export async function registrarPush(comercioId: string): Promise<void> {
  // Push real solo en Android. En web no hace nada (ahí ya hay notificaciones locales).
  if (!Capacitor.isNativePlatform() || !comercioId || yaRegistrado) return;
  if (!__PUSH_DISPONIBLE__) return; // APK sin Firebase: registrar cerraría la app
  yaRegistrado = true;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') { yaRegistrado = false; return; }

    // Cuando FCM devuelve el token, lo guardamos (upsert por token = idempotente).
    await PushNotifications.addListener('registration', async (token) => {
      try {
        // Por función del servidor: si el equipo cambió de cuenta, el upsert directo lo rechazaba la
        // RLS y seguían llegando los avisos del comercio anterior. Sin la migración 13, el upsert de antes.
        let { error } = await supabase.rpc('registrar_push_token', { p_token: token.value, p_comercio: comercioId });
        if (error) {
          const { data: { user } } = await supabase.auth.getUser();
          ({ error } = await supabase.from('push_tokens').upsert({
            token: token.value, comercio_id: comercioId, user_id: user?.id ?? null,
            plataforma: 'android', updated_at: new Date().toISOString(),
          }));
        }
        if (error) throw error;
        almacenSet(KEY_TOKEN, token.value);
        almacenSet(KEY_PUSH_OK, '1');
      } catch (e) {
        console.warn('[push] no se pudo guardar el token', e);
      }
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] error de registro', err);
    });

    await PushNotifications.register();
  } catch (e) {
    yaRegistrado = false;
    console.warn('[push] no disponible', e);
  }
}

/** Al cerrar sesión: este equipo deja de recibir los avisos de ese comercio. */
export async function olvidarPush(): Promise<void> {
  const token = almacenGet(KEY_TOKEN);
  yaRegistrado = false;
  almacenRemove(KEY_TOKEN);
  almacenRemove(KEY_PUSH_OK);
  try {
    if (token) await supabase.from('push_tokens').delete().eq('token', token);
    if (Capacitor.isNativePlatform() && __PUSH_DISPONIBLE__) {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.removeAllListeners();
    }
  } catch { /* sin internet: el servidor lo limpia cuando el token deje de servir */ }
}
