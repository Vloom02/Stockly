// ═══════════════════════════════════════════════════════════════════════════
// Push notifications (FCM). Solo en Android nativo.
// Pide permiso, registra el dispositivo y guarda el token en Supabase
// (tabla push_tokens) para que el envío de avisos de vencimiento llegue
// aunque la app esté cerrada. El envío se hace desde el servidor (Edge Function).
// ═══════════════════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

let yaRegistrado = false;

export async function registrarPush(comercioId: string): Promise<void> {
  // Push real solo en Android. En web no hace nada (ahí ya hay notificaciones locales).
  if (!Capacitor.isNativePlatform() || !comercioId || yaRegistrado) return;
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
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('push_tokens').upsert({
          token: token.value,
          comercio_id: comercioId,
          user_id: user?.id ?? null,
          plataforma: 'android',
          updated_at: new Date().toISOString(),
        });
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
