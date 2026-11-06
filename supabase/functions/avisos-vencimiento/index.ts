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
    // El día de Argentina, no el del servidor (UTC): a las 9 de la mañana decía "ya vencido" a lo que vence hoy.
    const diaAR = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
    const hoyAR = diaAR(new Date());
    const limiteISO = diaAR(new Date(Date.now() + DIAS_AVISO * 86400000));

    // De a 1.000 (el tope del servidor): con más lotes por vencer entre todos los comercios,
    // los últimos se quedaban sin aviso.
    const lotes: { comercio_id: string; fecha_vencimiento: string }[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supa
        .from('lotes')
        .select('comercio_id, fecha_vencimiento')
        .eq('retirado', false).gt('cantidad', 0)
        .not('fecha_vencimiento', 'is', null)
        .lte('fecha_vencimiento', limiteISO)
        .order('id').range(desde, desde + 999);
      if (error) return json({ error: error.message }, 500);
      lotes.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const porComercio = new Map<string, { total: number; vencidos: number }>();
    for (const l of lotes) {
      const e = porComercio.get(l.comercio_id) ?? { total: 0, vencidos: 0 };
      e.total++;
      if (l.fecha_vencimiento < hoyAR) e.vencidos++;
      porComercio.set(l.comercio_id, e);
    }
    if (porComercio.size === 0) return json({ enviados: 0, msg: 'nada por vencer' });

    const accessToken = await getAccessToken();
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`;
    let enviados = 0, borrados = 0;

    // Los celulares de los comercios, de a 200 comercios y de a 1.000 filas: el servidor corta en 1.000 y una lista
    // de ids muy larga no entra en la dirección del pedido (pasada cierta cantidad, a algunos no les llegaba el aviso).
    const tokensDe = new Map<string, { token: string }[]>();
    const ids = [...porComercio.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      for (let desde = 0; ; desde += 1000) {
        const { data, error: errTokens } = await supa.from('push_tokens').select('token, comercio_id')
          .in('comercio_id', ids.slice(i, i + 200)).order('token').range(desde, desde + 999);
        if (errTokens) return json({ error: errTokens.message }, 500);
        // Hasta 20 por comercio: con miles de tokens falsos en uno solo, la función se quedaba sin tiempo y no le llegaba
        // el aviso a nadie.
        for (const t of data ?? []) {
          const lista = tokensDe.get(t.comercio_id) ?? [];
          if (lista.length < 20) lista.push({ token: t.token });
          tokensDe.set(t.comercio_id, lista);
        }
        if (!data || data.length < 1000) break;
      }
    }

    for (const [comercioId, info] of porComercio) {
      const tokens = tokensDe.get(comercioId);
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
        } else {
          // Se borra solo si FCM dice que ese celular ya no existe (UNREGISTERED). Un 400 por un error del mensaje
          // borraba los tokens de todos y nadie volvía a recibir avisos.
          const err = await r.json().catch(() => null) as { error?: { details?: { errorCode?: string }[] } } | null;
          if (err?.error?.details?.some(d => d.errorCode === 'UNREGISTERED')) {
            await supa.from('push_tokens').delete().eq('token', t.token);
            borrados++;
          } else console.warn('FCM', r.status, JSON.stringify(err));
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
