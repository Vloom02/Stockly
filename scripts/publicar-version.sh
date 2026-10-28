#!/usr/bin/env bash
# Publica la versión de package.json en los Releases de GitHub para que las apps se actualicen:
#   stockly-web-X.Y.Z.zip  → la parte web; las apps la bajan solas al abrirse (lib/actualizacion.ts)
#   Stockly-X.Y.Z.apk      → para instalar de cero, o si el APK instalado es más viejo que "apkMinimo"
# Antes: subir "version" en package.json. Si cambió algo NATIVO (plugin nuevo, permisos, Capacitor),
# poner también "apkMinimo" = esa versión. Necesita la llave de firma (D:\Claude\firmas) y gh logueado.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
MIN=$(node -p "require('./package.json').apkMinimo")
SAL=.release && rm -rf "$SAL" && mkdir -p "$SAL"

npm run build
npx cap sync android
(cd android && ./gradlew.bat assembleRelease --no-daemon -q)
cp android/app/build/outputs/apk/release/app-release.apk "$SAL/Stockly-$V.apk"
# Zip con index.html en la raíz (lo que espera Capgo) y su huella sha256.
python -I -c "
import zipfile, pathlib, sys
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as z:
    for f in pathlib.Path(sys.argv[1]).rglob('*'):
        if f.is_file(): z.write(f, f.relative_to(sys.argv[1]).as_posix())
" dist "$SAL/stockly-web-$V.zip"
SHA=$(python -I -c "import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$SAL/stockly-web-$V.zip")

gh release create "v$V" "$SAL/stockly-web-$V.zip" "$SAL/Stockly-$V.apk" --title "Stockly $V" \
  --notes "$(printf 'apk-minimo: %s\nsha256: %s\n\n%s' "$MIN" "$SHA" "${1:-Actualización de Stockly.}")"
echo "Publicada v$V (apk mínimo $MIN)"
