-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 9 — Rendimiento (advisor Supabase + consultas de la app, 2026-10-26)
-- Idempotente. No cambia permisos ni datos.
--   A) RLS initplan: la migración 7 recreó "borrar lotes (dueno)" con auth.uid()
--      por fila; vuelve a (select auth.uid()). Misma semántica exacta.
--   B) Índices para FKs sin cubrir (advisor).
--   C) Índices compuestos para lo que la app consulta todo el tiempo; todas las
--      consultas filtran primero por comercio (multi-tenant):
--        · sync incremental: productos/lotes por comercio + updated_at
--        · lector de códigos en Vender: productos por comercio + codigo_barras
--        · movimientos por comercio + creado_en, ventas por comercio + fecha
--      Los índices de una sola columna (comercio_id) quedan cubiertos por estos
--      (comercio_id es la primera columna) y se borran: menos trabajo al escribir.
-- ═══════════════════════════════════════════════════════════════════════════

-- A) RLS initplan
alter policy "borrar lotes (dueno)" on lotes
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = lotes.comercio_id and m.rol = 'dueno'));

-- B) Índices FK
create index if not exists idx_admin_auditoria_comercio on admin_auditoria (comercio_id);
create index if not exists idx_vpromos_producto         on ventas_promos (producto_id);

-- C) Consultas frecuentes
create index if not exists idx_productos_comercio_upd    on productos (comercio_id, updated_at);
create index if not exists idx_productos_comercio_codigo on productos (comercio_id, codigo_barras);
create index if not exists idx_lotes_comercio_upd        on lotes (comercio_id, updated_at);
create index if not exists idx_movim_comercio_creado     on movimientos (comercio_id, creado_en);
create index if not exists idx_ventas_comercio_fecha     on ventas_ventas (comercio_id, fecha desc);

drop index if exists idx_productos_comercio;
drop index if exists idx_lotes_comercio;
drop index if exists idx_movim_comercio;
drop index if exists idx_ventas_comercio;
