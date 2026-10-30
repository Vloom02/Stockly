#!/usr/bin/env bash
# Publica la versión de package.json en los Releases de GitHub para que las apps se actualicen:
#   stockly-web-X.Y.Z.zip  → la parte web; las apps la bajan solas al abrirse (lib/actualizacion.ts)
#   Stockly-X.Y.Z.apk      → para instalar de cero, o si el APK instalado es más viejo que "apkMinimo"
# Antes: subir "version" en package.json. Si cambió algo NATIVO (plugin nuevo, permisos, Capacitor),
# poner también "apkMinimo" = esa versión. Necesita la llave de firma (D:\Claude\firmas) y gh logueado.
# Sale en BORRADOR (las tablets no lo ven): probalo en un equipo y después
#   gh release edit vX.Y.Z --draft=false --latest
# Guía completa: docs/PUBLICAR.md
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
MIN=$(node -p "require('./package.json').apkMinimo")
SAL=.release && rm -rf "$SAL" && mkdir -p "$SAL"

# Controles: lo que se publica llega solo a TODAS las tablets.
falla() { echo "NO SE PUBLICA: $1" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || falla "hay cambios sin guardar en git"
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || falla "lo de la compu no es igual a origin/main (falta push o pull)"
VERDES=$(gh run list --commit "$(git rev-parse HEAD)" --json status,conclusion \
  -q 'if length > 0 and all(.status == "completed" and .conclusion == "success") then "si" else "no" end')
[ "$VERDES" = "si" ] || falla "las pruebas de GitHub (CI y Backend) no terminaron en verde para este commit"
ANT=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -n "$ANT" ] && git diff --name-only "$ANT" HEAD | grep -q '^supabase/migracion-'; then
  read -r -p "Hay migraciones nuevas desde $ANT. ¿Ya están aplicadas en producción? (s/N) " R
  [ "$R" = "s" ] || falla "primero aplicá la migración en producción"
fi
if [ -n "$ANT" ] && git diff "$ANT" HEAD -- package.json capacitor.config.ts | grep -qE '^[+-].*"@(capacitor|capgo)/|^[+-].*(plugins|server)'; then
  [ "$MIN" = "$V" ] || falla "cambió algo nativo (Capacitor/plugins): poné \"apkMinimo\": \"$V\" en package.json"
fi
npx tsc --noEmit -p . && npm test --silent

npm run build
grep -rq 'localhost:54321\|127.0.0.1:54321' dist && falla "el paquete apunta a la base de prueba local"
grep -rq 'diytllvtweghnagqjnrc' dist || falla "el paquete no apunta a la base de producción"
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

gh release create "v$V" "$SAL/stockly-web-$V.zip" "$SAL/Stockly-$V.apk" --title "Stockly $V" --draft --target "$(git rev-parse HEAD)" \
  --notes "$(printf 'apk-minimo: %s\nsha256: %s\n\n%s' "$MIN" "$SHA" "${1:-Actualización de Stockly.}")"
echo "Borrador v$V listo (apk mínimo $MIN). Probalo y publicalo con: gh release edit v$V --draft=false --latest"
