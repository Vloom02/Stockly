import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { aplicarColorMarca, obtenerColorMarcaGuardado, COLORES_MARCA } from './lib/tema';
import { hidratarAlmacenamiento } from './lib/almacen';
import { initSentry } from './lib/sentry';

// Cargar el almacenamiento persistente a memoria ANTES de renderizar,
// así las lecturas síncronas (config, sucursal activa, etc.) tienen los datos.
async function arrancar() {
  initSentry(); // captura de errores (no-op en desarrollo)
  await hidratarAlmacenamiento();

  // Aplicar el color de marca elegido por el usuario
  const colorId = obtenerColorMarcaGuardado();
  aplicarColorMarca(colorId);
  const colorActual = COLORES_MARCA.find(c => c.id === colorId) || COLORES_MARCA[0];

  // Configurar la barra de estado de Android
  if (Capacitor.getPlatform() === 'android') {
    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: colorActual.tonos[1] });
    } catch (e) { /* en web no existe */ }
  }

  const container = document.getElementById('root');
  const root = createRoot(container!);
  root.render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={
          <div style={{
            padding: 24, textAlign: 'center', fontFamily: 'system-ui',
            color: 'var(--text, #111)',
          }}>
            <h2>Ups, algo salió mal</h2>
            <p>Cerrá y volvé a abrir la app. Ya nos llegó el aviso para revisarlo.</p>
          </div>
        }
      >
        <App />
      </Sentry.ErrorBoundary>
    </React.StrictMode>
  );
}

arrancar();
