# Notas de seguridad

## Auditoría 2026-07 (Fable) — corregido y aplicado a prod

- **Fuerza bruta online en `verificar_pin` / `verificar_empleado_venta`**: sin
  límite de intentos, un miembro podía probar todos los PINs de 4-6 dígitos vía
  RPC. Fix: lockout de 15 min tras 5 fallos (tabla `auth_intentos`, RLS sin
  policies — acceso solo por funciones). Migración:
  `almacen-ventas-final/src/lib/ventas-migracion-4-auth-hardening.sql`.
- **Hashes sin sal (SHA-256)** en `pin_hash` y `pass_hash`: migrados a bcrypt
  (`crypt`/`gen_salt('bf')`) con upgrade perezoso — el hash legado se acepta y
  se re-hashea en el primer login OK. Altas nuevas nacen en bcrypt
  (`guardar_empleado_venta`, `configurar_pin`). El cliente ya no escribe
  `pin_hash` (usa RPC `configurar_pin`).
- **Edge Function `avisos-vencimiento` invocable con la anon key** (extraíble
  del APK) → spam de push. Fix: header `x-cron-secret` obligatorio (secreto
  `CRON_SECRET` en la función, enviado por el cron). Verificado: sin secreto
  401, con secreto 200.
- **CSV injection** en `exportar.ts` (ambas apps): textos que empiezan con
  `= + - @ \t` se neutralizan con apóstrofe (Excel los interpretaba como
  fórmula).
- **npm audit**: 1 critical + 1 high pero SOLO en devDependencies (vite 5 /
  vitest). No afectan a los APK. Upgrade a Vite 7+ pendiente como tarea aparte.
- **`ventas_empleados` con RLS y sin policies**: intencional (deny-all; acceso
  únicamente vía RPCs SECURITY DEFINER).

# Escaneo 2026-06-10

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
