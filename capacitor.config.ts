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
    // mandarle estadísticas. Si una versión nueva no avisa "lista" en 30 s, vuelve a la anterior (con 10 s, una
    // tablet lenta tardaba en cargar + los 3 s de espera de main.tsx y volvía atrás una versión que andaba bien).
    CapacitorUpdater: {
      autoUpdate: false,
      statsUrl: '',
      channelUrl: '',
      updateUrl: '',
      appReadyTimeout: 30000,
      // Llave pública de las actualizaciones (la privada está fuera del repo): desde este APK solo se instalan
      // versiones firmadas con ella (scripts/cifrar-version.mjs). Cambiarla obliga a instalar un APK nuevo.
      publicKey: '-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA11ABlle8Y2LCijcyBea44JvVvyxabCxKJveKcDe/dC3VWp7Z4fV4\nT7diKGsAOQmcvSI6HbWLnJqCjE3RotW7zGuSg+ZYL6sNO7RTWT0JS7ykVWQ0cs8S\n/LXblZWGrQeWIngq7+ZWhqLq2AGlhfHyeHTuvCa27S2/biSGz0a000oXP9NH3nng\nV3Ob8rYJrErEg9jGxMENuYzwMEZpu0SThIak6eXinvaxWGU5OX5Z+etpdNdD+nGt\nZZ40nF+mmj7g/cCX5PaQ7pCuS6KMrmyddL3qAUTEnB3q0Sy3SwBweACDXFQEPVi/\nY7WCehECMumAbHseKIdwOuU9aIebljR9DwIDAQAB\n-----END RSA PUBLIC KEY-----',
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
