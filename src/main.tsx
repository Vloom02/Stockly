import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { aplicarColorMarca, obtenerColorMarcaGuardado, COLORES_MARCA } from './lib/tema';
import { hidratarAlmacenamiento } from './lib/almacen';

// Cargar el almacenamiento persistente a memoria ANTES de renderizar,
// así las lecturas síncronas (config, sucursal activa, etc.) tienen los datos.
async function arrancar() {
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
      <App />
    </React.StrictMode>
  );
}

arrancar();
