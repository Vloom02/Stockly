# PRD — Stockly (inventario + punto de venta)

**Versión:** 1.0 · **Fecha:** junio 2026 · **Estado:** en producción (beta privada)
**Repo:** [Vloom02/Stockly](https://github.com/Vloom02/Stockly)

> **Octubre 2026:** Almacén Ventas se unió a Stockly. Es una sola app (pestaña **Vender**,
> código en `src/ventas/`, migraciones en `supabase/ventas/`). Este documento conserva la
> descripción original de las dos partes.

---

## 1. Resumen ejecutivo

Suite de dos aplicaciones Android (con base web) para **comercios de barrio
argentinos** (almacenes, despensas, kioscos) que comparten un mismo backend:

- **Stockly** — control de inventario por lotes con foco en **vencimientos**
  (FEFO: lo que vence primero, sale primero). *App prioritaria.*
- **Almacén Ventas** — punto de venta (POS) rápido que descuenta el mismo
  stock de Stockly en tiempo real.

La propuesta de valor central: **que al comerciante no se le venza la
mercadería** (plata tirada) y que la venta diaria mantenga el inventario al
día sin trabajo extra.

## 2. Problema

1. En un almacén típico, la mercadería vencida es pérdida directa y frecuente:
   no hay visibilidad de qué vence ni cuándo, y se descubre tarde.
2. Los sistemas POS/stock existentes son caros, complejos, pensados para
   supermercados, y suelen requerir internet permanente — inviable con la
   conectividad real de un barrio.
3. El control en papel/planilla no escala: el stock "del sistema" nunca
   coincide con la góndola y nadie sabe cuánta plata se pierde por vencimiento.

## 3. Usuarios

| Persona | Necesita | Usa |
|---|---|---|
| **Dueño/a** | Saber qué vence, cuánto pierde, qué reponer, cuánto vendió, controlar la caja y el fiado | Stockly (admin) + Ventas (números) |
| **Empleado/a** | Vender rápido, consultar stock/precios | Ventas (sin acceso a números del negocio) |

Contexto de uso: celular Android de gama media/baja, internet intermitente,
poco tiempo, sin formación técnica. Idioma: español rioplatense (es-AR).

## 4. Objetivos y métricas de éxito

| Objetivo | Métrica |
|---|---|
| Reducir pérdidas por vencimiento | $ perdido/mes (reporte de pérdidas) tendiendo a bajar |
| Venta sin fricción | Venta completa (escaneo → cobro) en menos de 15 segundos |
| Confiable sin internet | 100% de ventas offline sincronizadas sin pérdida ni duplicado |
| Adopción | El dueño carga su stock real y opera ambas apps a diario |

## 5. Alcance del producto

### 5.1 Stockly (inventario / vencimientos) — ✅ implementado

- **Inventario por lotes**: cada ingreso registra cantidad + fecha de
  vencimiento + proveedor/lote, por sucursal (multi-sucursal).
- **Semáforo de vencimiento** configurable (vencido / crítico / urgente /
  aviso / ok) con umbrales por comercio y por producto.
- **Dashboard editorial**: stock valorizado, donut por categoría, niveles de
  alerta, sello "AL DÍA", sugerencias de liquidación FEFO con % de descuento
  configurables.
- **Alertas de vencimiento**: notificaciones locales programadas a 7 días
  (recalculadas por fecha objetivo; sin servidor) + aviso diario vía cron +
  edge function (push).
- **Reportes**: pérdidas mensuales ($ vencido/roto), valor por categoría,
  calendario de vencimientos, **lista de reposición** (sin stock / por vencer /
  stock bajo) compartible por WhatsApp.
- **Operatoria**: escáner de código de barras (cámara), inventario físico
  (conteo guiado con ajuste en lote), **suba de precios** rápida (chips de %),
  etiquetas de precio imprimibles, export CSV (stock y movimientos) + backup
  JSON con restauración.
- **Movimientos**: historial completo (ingresos, ventas, vencidos, rotos,
  ajustes) con filtros — las ventas del POS aparecen acá.
- **Personalización**: 8 paletas de marca, tema claro/oscuro (cálido
  editorial), tamaño de texto ajustable (85–150%).

### 5.2 Almacén Ventas (POS) — ✅ implementado

- **Venta**: escaneo o búsqueda → carrito → confirmación. Descuento de stock
  **FEFO atómico en el servidor** (RPC con locks; sin sobreventa).
- **Cobro**: efectivo / transferencia / tarjeta / QR, descuentos, **ticket**
  compartible por WhatsApp (texto monoespaciado, apto impresora térmica).
- **Fiado (cuenta corriente)**: deuda por cliente, **pagos parciales** con
  saldo, saldar, recordatorio por WhatsApp.
- **Devoluciones/anulaciones**: revierte la venta y repone el stock a los
  lotes originales (atómico, idempotente).
- **Caja por turnos**: mañana/tarde/noche con **horarios configurables**,
  arqueo de efectivo (contado vs. sistema, diferencia), totales por método.
- **Dashboard**: hoy / 7 días, comparativa vs. período anterior, gráfico por
  día/turno, top productos, export CSV. **Historial** con filtros y anulación.
- **Modo dueño**: Dashboard/Caja/Historial/Deudas protegidos por PIN
  (verificación server-side; el empleado solo vende y ve stock).
- **Estética**: tema "terminal retro-futurista" ámbar + modo claro papel;
  onboarding de primera vez (solo comercios vacíos).

### 5.3 Backend compartido (Supabase) — ✅ implementado

- **Multi-tenant con RLS**: cada comercio ve solo sus datos; roles
  dueño/empleado con permisos diferenciados a nivel fila.
- **Gestión de empleados**: invitación por código de un solo uso (vence a los
  7 días); el empleado se registra con el código y se une al comercio
  (trigger de registro). Alta/baja desde Stockly.
- **API por RPCs atómicos** (`SECURITY DEFINER`, `search_path` fijo,
  validación interna de membresía): `registrar_venta`, `anular_venta`,
  `registrar_pago_fiado`, `ajustar_stock`, `crear/validar_invitacion`,
  `quitar_miembro`, `tiene_pin`/`verificar_pin`.
- **Migraciones**: siempre aditivas e idempotentes, versionadas en los repos.

### 5.4 Offline-first (requisito central) — ✅ implementado

- Lectura: caché local (IndexedDB) → la app abre y opera sin internet.
- Escritura: **outbox** con reintentos; los RPCs son **idempotentes** (id
  generado en el cliente) → reintentar nunca duplica ventas, pagos ni
  anulaciones.
- **Cuarentena**: un item que falla con error permanente se bloquea visible
  para reintento manual; **nunca se borra** una operación no confirmada.
- Al reconectar, la venta offline recalcula FEFO contra el stock más reciente.

## 6. Arquitectura técnica

| Capa | Tecnología |
|---|---|
| Frontend | Ionic React 8 · TypeScript 5.9 · Vite 5 (sin `manualChunks`; lazy routes) |
| Nativo | Capacitor 8 (Android; APK release firmado, keystore propio) |
| Backend | Supabase: Postgres 17 + RLS, Auth, edge functions, cron (`pg_cron` + `pg_net`) |
| Datos locales | IndexedDB (catálogo, outbox, settings) + Capacitor Preferences |
| Observabilidad | Sentry (solo producción, sin PII, tag por app) |
| Calidad | Vitest (70 tests unitarios: 42 Stockly + 28 Ventas) · Playwright (smoke E2E anti-pantalla-blanca) · CI en GitHub Actions |

Flujo clave: `Ventas (carrito) → RPC registrar_venta → lotes (FEFO, lock) +
movimientos → visible en Stockly`. La devolución recorre el camino inverso.

## 7. Seguridad

Escaneo completo documentado en [`supabase/SEGURIDAD.md`](../supabase/SEGURIDAD.md). Resumen:

- RLS en el 100% de las tablas, policies por rol; funciones definer con
  `search_path` fijo; PIN verificado server-side (el hash no viaja al cliente).
- Sin secretos en el código; `.env` y keystore fuera de git; permisos Android
  mínimos (INTERNET + cámara en ambas apps: escáner de códigos).
- Warnings aceptados y justificados: `pg_net` en `public` (lo usa el cron),
  `validar_invitacion` anónima (pre-registro; fuerza bruta inviable),
  HaveIBeenPwned (requiere plan Pro).

## 8. Requisitos no funcionales

- **Idioma**: es-AR en toda la UI, mensajes y documentación.
- **Rendimiento**: arranque < 3 s en gama media (lazy-load; bundle inicial sin
  páginas secundarias); listas fluidas hasta cientos de productos.
- **Accesibilidad**: `aria-label` en controles solo-ícono, tamaño de texto
  ajustable, contraste verificado en ambos temas.
- **Resiliencia**: toda operación de negocio debe sobrevivir a cortes de red
  y cierres de app (outbox + idempotencia).

## 9. Roadmap (acordado)

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Todo lo descripto en §5 | ✅ Hecho |
| 2 | **Validación en uso real**: cargar stock real y operar a diario; corregir lo que duela | 🔜 Ahora |
| 3 | Impresión térmica Bluetooth (ESC/POS) · push FCM real | Pendiente |
| 4 | **PWA + hosting web** (instalable por link, iPhone) | Al final |
| 5 | **Mercado Pago** (cobro de suscripción) | Lo último de todo |

Fuera de alcance por ahora: facturación electrónica (AFIP/ARCA), lectores de
código dedicados, multi-moneda, monorepo de código compartido.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Pérdida del keystore de firma | Backup obligatorio de `APKs/keystore/` (documentado; sin él no hay updates) |
| Conflictos de stock con varios vendedores | Locks de fila en el RPC (`FOR UPDATE`) + idempotencia |
| Datos viejos en avisos locales | Reprogramación total al abrir la app; cada día recalcula su fecha objetivo |
| Token de gestión expuesto en chats | **Rotar `sbp_...`** (pendiente del lado del dueño) |
| Dependencia de un solo desarrollador | notas de desarrollo por repo + migraciones versionadas + PRD (este doc) |

## 11. Decisiones de producto registradas

- **Stockly primero**: se perfecciona la app de inventario antes de invertir
  más en Ventas (genera los datos que alimentan todo).
- **Suba de precios producto por producto** (no masiva): el comerciante revisa
  cada precio; los chips de % solo asisten.
- **Cuenta compartida + PIN** convive con **cuentas de empleado** por
  invitación: el comercio elige su modelo.
- **Sin datos demo**: el catálogo es compartido entre apps; sembrar datos de
  prueba contaminaría el inventario real. El onboarding es solo guía.
- **Distribución por APK firmado** mientras dure la beta; tienda/PWA después.
