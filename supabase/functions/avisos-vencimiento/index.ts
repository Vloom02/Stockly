// ═══════════════════════════════════════════════════════════════════════════
// Edge Function: avisos-vencimiento
// Recorre los lotes próximos a vencer por comercio y manda un push (FCM v1)
// a los dispositivos registrados (push_tokens). Pensada para correr 1x/día (cron).
// Secreto requerido: FCM_SERVICE_ACCOUNT (JSON del service account de Firebase).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los provee Supabase automáticamente.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SA = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
// Secreto compartido con el cron: sin él, cualquiera con la anon key (que va
// dentro del APK) podría invocar la función y spamear push a todos los comercios.
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const DIAS_AVISO = 7; // avisar lotes que vencen en 7 días o menos (incluye vencidos)

const b64url = (buf: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof buf === 'string'
    ? new TextEncoder().encode(buf)
    : buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                  .replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// OAuth2 access token (FCM HTTP v1) firmando un JWT con el service account.
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(SA.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('OAuth falló: ' + JSON.stringify(j));
  return j.access_token as string;
}

Deno.serve(async (req) => {
  // Solo el cron (que manda x-cron-secret) puede dispararla.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'no autorizado' }, 401);
  }
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const hoy = new Date();
    const limite = new Date(); limite.setDate(hoy.getDate() + DIAS_AVISO);
    const limiteISO = limite.toISOString().slice(0, 10);

    const { data: lotes, error } = await supa
      .from('lotes')
      .select('comercio_id, fecha_vencimiento')
      .eq('retirado', false).gt('cantidad', 0)
      .not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', limiteISO);
    if (error) return json({ error: error.message }, 500);

    const porComercio = new Map<string, { total: number; vencidos: number }>();
    for (const l of lotes ?? []) {
      const e = porComercio.get(l.comercio_id) ?? { total: 0, vencidos: 0 };
      e.total++;
      if (new Date(l.fecha_vencimiento + 'T00:00:00') < hoy) e.vencidos++;
      porComercio.set(l.comercio_id, e);
    }
    if (porComercio.size === 0) return json({ enviados: 0, msg: 'nada por vencer' });

    const accessToken = await getAccessToken();
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`;
    let enviados = 0, borrados = 0;

    for (const [comercioId, info] of porComercio) {
      const { data: tokens } = await supa.from('push_tokens').select('token').eq('comercio_id', comercioId);
      if (!tokens?.length) continue;

      const partes: string[] = [];
      const porVencer = info.total - info.vencidos;
      if (porVencer > 0) partes.push(`${porVencer} por vencer`);
      if (info.vencidos > 0) partes.push(`${info.vencidos} ya vencido${info.vencidos > 1 ? 's' : ''}`);
      const body = `Tenés ${partes.join(' y ')}. Priorizá venderlos antes de perderlos.`;

      for (const t of tokens) {
        const r = await fetch(fcmUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: { title: '📦 Stockly · Vencimientos', body },
              android: { priority: 'high' },
            },
          }),
        });
        if (r.ok) {
          enviados++;
        } else if (r.status === 404 || r.status === 400) {
          // token inválido o desregistrado → limpiarlo
          await supa.from('push_tokens').delete().eq('token', t.token);
          borrados++;
        }
      }
    }
    return json({ enviados, borrados, comercios: porComercio.size });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
