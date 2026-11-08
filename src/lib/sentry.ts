// ═══════════════════════════════════════════════════════════════════════════
// Sentry: captura de errores en producción (APK / build real).
// El DSN se lee de VITE_SENTRY_DSN si está en el .env; si no, usa el del proyecto.
// (El DSN solo permite ENVIAR errores, no leerlos: no es un secreto crítico.)
// ═══════════════════════════════════════════════════════════════════════════
import * as Sentry from '@sentry/react';

const DSN =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ||
  'https://634f83fe864c8f590430acd4420df286@o4511522176499712.ingest.us.sentry.io/4511522180169728';

export function initSentry(): void {
  // Solo reportar desde builds reales (APK / producción), nunca en `npm run dev`.
  if (!import.meta.env.PROD || !DSN) return;

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    release: `stockly@${__APP_VERSION__}`, // ver errores por versión antes de soltarla a todos
    sendDefaultPii: false,   // no enviar IP ni datos personales por defecto (privacidad)
    tracesSampleRate: 0,     // sin performance tracing → cuida la cuota del plan gratis
    // Ruido esperable en una app offline-first: no lo reportamos.
    ignoreErrors: ['Failed to fetch', 'NetworkError', 'Load failed', 'AbortError', 'Timeout'],
    // Los toques guardan el nombre del botón ("Cobrar a Marta", un empleado) y la consola puede llevar
    // datos de una fila: nada de eso viaja (datos personales de clientes y empleados).
    // Las direcciones de los pedidos, sin lo que va después del "?": ahí viajan el token del celular y lo que se buscó.
    beforeBreadcrumb: (b) => {
      if (b.category === 'ui.click' || b.category === 'console') return null;
      if ((b.category === 'fetch' || b.category === 'xhr') && typeof b.data?.url === 'string') b.data.url = b.data.url.split('?')[0];
      return b;
    },
  });
}
