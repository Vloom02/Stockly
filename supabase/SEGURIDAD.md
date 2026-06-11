# Notas de seguridad (escaneo 2026-06-10)

Escaneo a fondo de código + base de datos (advisors de Supabase, RLS, funciones,
secretos, permisos Android, dependencias). Resultado y decisiones:

## Corregido en este escaneo
- **PIN de dueño (Ventas) — brecha real**: la policy `ver config (miembros)`
  permitía que cualquier miembro (empleado) leyera el `pin_hash`; un PIN de 4-6
  dígitos en SHA-256 se crackea offline al instante. Fix: verificación
  server-side (`verificar_pin` / `tiene_pin`), el hash ya no es legible por
  miembros. Migración: `almacen-ventas-final/src/lib/ventas-migracion-3-pin.sql`.
- **`comercios_del_usuario()` ejecutable por `anon`**: revocado (higiene; con
  `auth.uid()` nulo devolvía vacío, pero no tenía por qué estar expuesta).

## Verificado y limpio
- RLS habilitado en las 13 tablas de `public`, todas con policies.
- Todas las funciones `SECURITY DEFINER` tienen `search_path` fijo.
- Sin secretos hardcodeados en `src/` de ninguna app (URL/keys por env).
- Sin `dangerouslySetInnerHTML` / `eval` / `innerHTML` directo.
- Sin logs de datos sensibles (password/token/pin).
- `.env` y keystores fuera de git (verificado con `git ls-files`).
- Permisos Android mínimos: INTERNET (+ CAMERA solo en Stockly, para el escáner).
- `npm audit` sin vulnerabilidades high/critical en dependencias de producción.

## Warnings aceptados (con motivo)
- **`pg_net` en schema `public`**: lo usa el cron `avisos-vencimiento-diario`
  (edge function de avisos). La versión instalada no soporta `SET SCHEMA`.
  No eliminar.
- **`validar_invitacion` ejecutable por `anon`**: intencional — valida el código
  de invitación ANTES del registro. Solo devuelve el nombre del comercio si el
  código está vigente; espacio de códigos 32^8 (~1.1 billones) → fuerza bruta
  inviable, un solo uso y vencen a los 7 días.
- **RPCs `SECURITY DEFINER` para `authenticated`** (registrar_venta,
  anular_venta, registrar_pago_fiado, ajustar_stock, crear_invitacion,
  quitar_miembro, tiene_pin, verificar_pin, comercios_del_usuario): es la API
  de la app. Cada una valida internamente membresía/rol y tiene search_path fijo.
- **Protección de contraseñas filtradas (HaveIBeenPwned)**: requiere plan Pro
  de Supabase. Activarla si se hace upgrade.

## Pendiente del lado del usuario
- Rotar el access token `sbp_...` de Supabase (se usó en chats para migraciones).
- Backup del keystore de firma (`Downloads/APKs/keystore/`): si se pierde, no
  hay actualizaciones de las apps publicadas con esa firma.
