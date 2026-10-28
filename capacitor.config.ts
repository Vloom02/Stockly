import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vloom.stockly',
  appName: 'Stockly',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#1c160d',
  },
  plugins: {
    // Actualizaciones en vivo propias (lib/actualizacion.ts): sin el servicio de Capgo y sin
    // mandarle estadísticas. Si una versión nueva no avisa "lista" en 10 s, vuelve a la anterior.
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      channelUrl: '',
      updateUrl: '',
      appReadyTimeout: 10000,
    },
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#1c160d',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
