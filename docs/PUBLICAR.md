# Publicar una versión de Stockly

Las tablets de los clientes se actualizan solas leyendo el **último release** de GitHub
(`src/lib/actualizacion.ts`). Lo que se publica llega a todas, así que hay que ir con cuidado.

## Pasos

1. Subí `"version"` en `package.json`. Si cambió algo nativo (un plugin de Capacitor, permisos,
   `capacitor.config.ts`), poné también `"apkMinimo"` igual a esa versión: esas tablets van a tener
   que instalar el APK nuevo.
2. Si hay una migración nueva en `supabase/`, probala en el entorno local y aplicala en producción
   **antes** de publicar (la app nueva puede depender de ella).
3. Commit, `git push` y esperá que **CI** y **Backend** terminen en verde en GitHub.
4. `bash scripts/publicar-version.sh "Notas para los comercios"`. El script frena si hay cambios sin
   guardar, si falta el push, si las pruebas de GitHub no están en verde, si el paquete apunta a la
   base de prueba o si cambió algo nativo sin subir `apkMinimo`. Sale en **borrador**: nadie lo ve.
5. Probá el APK de `.release/` en un equipo propio.
6. Publicalo: `gh release edit vX.Y.Z --draft=false --latest`.

## Volver atrás

La app nunca baja a una versión más vieja que la que tiene. Para deshacer, publicá una versión
**nueva** (X.Y.Z+1) con el código anterior (`git revert`). Si la parte web nueva no arranca,
Capgo vuelve sola a la anterior en ese equipo.

## Migraciones

- Orden: `supabase/orden-migraciones.txt`. Cada una tiene su `volver-atras-…` cuando hace falta.
- Lo que tiene `DROP` se corre a mano en el SQL Editor de Supabase.

## La llave de firma

`android/app/build.gradle` firma con la llave de `D:/Claude/firmas` (keystore + `keystore.properties`).
**Guardá una copia fuera de la compu** (pendrive o nube privada). Si se pierde, las tablets no pueden
actualizar el APK: hay que desinstalar la app y se pierde lo que no se subió.

## Si se regenera la carpeta `android/`

Volver a agregar en el `AndroidManifest.xml` el permiso de cámara y `allowBackup="false"`, la firma y la
versión en `build.gradle`, `google-services.json` y los íconos (`npx @capacitor/assets generate --android`).
