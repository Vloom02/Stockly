# Personalizaciones nativas de Android

La carpeta `android/` está en `.gitignore` (se regenera con `npx cap add android`).
Si alguna vez se regenera, **reaplicar estos cambios manuales**:

## 1. Áreas seguras (edge-to-edge, Android 15/16)

Con `targetSdk 35+` Android fuerza edge-to-edge y la WebView **no** reporta el
inset inferior a CSS (`env(safe-area-inset-bottom)` queda en 0), por lo que la
barra inferior queda tapada por los botones del sistema.

**Fix:** en `android/app/src/main/java/com/vloom/stockly/MainActivity.java`,
leer el inset nativo e inyectarlo como `--ion-safe-area-bottom` / `--sab`:

```java
package com.vloom.stockly;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final WebView webView = getBridge().getWebView();
        final float density = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            final int bottom = Math.round(bars.bottom / density);
            webView.post(() -> webView.evaluateJavascript(
                "document.documentElement.style.setProperty('--ion-safe-area-bottom','" + bottom + "px');" +
                "document.documentElement.style.setProperty('--sab','" + bottom + "px');", null));
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}
```

En el CSS de la app, las barras fijas usan `var(--sab, env(safe-area-inset-bottom))`
(fallback a `env()` para web/iOS). En Ventas la `IonTabBar` lo toma sola vía
`--ion-safe-area-bottom`.

## 2. Firma release (keystore)

En `android/app/build.gradle`, dentro de `android { }`, leer el keystore externo
(que vive fuera del repo en `C:\Users\alanm\Downloads\APKs\keystore\`):

```gradle
def ksFile = file("C:/Users/alanm/Downloads/APKs/keystore/apps.keystore")
def ksProps = file("C:/Users/alanm/Downloads/APKs/keystore/keystore.properties")
if (ksFile.exists() && ksProps.exists()) {
    def props = new Properties()
    ksProps.withInputStream { props.load(it) }
    signingConfigs {
        release {
            storeFile ksFile
            storePassword props['storePassword']
            keyAlias 'stockly'          // 'almacen' en la app de Ventas
            keyPassword props['keyPassword']
        }
    }
}
buildTypes {
    release {
        // ...
        if (ksFile.exists() && ksProps.exists()) { signingConfig signingConfigs.release }
    }
}
```

## 3. Íconos / splash

Se generan con `@capacitor/assets` desde la carpeta `assets/` de cada proyecto:
`npx capacitor-assets generate --android` (más `ic_stat_icon` para notificaciones).
