-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 5 — Performance (advisor Supabase, auditoría 2026-07)
-- Aditiva e idempotente.
--   A) Índices para FKs sin cubrir (joins y deletes en cascada más rápidos).
--   B) RLS initplan: auth.uid() envuelto en (select ...) para que Postgres lo
--      evalúe UNA vez por query y no por cada fila. Misma semántica exacta.
--   C) Policies permisivas duplicadas en SELECT: la policy del dueño en
--      productos/sucursales era FOR ALL y se solapaba con la de miembros en
--      los SELECT (doble evaluación por fila). El dueño ya puede leer por
--      "ver ... (miembros)"; su policy pasa a cubrir solo escritura.
-- ═══════════════════════════════════════════════════════════════════════════

-- A) Índices FK
create index if not exists idx_invitaciones_creada_por on invitaciones (creada_por);
create index if not exists idx_invitaciones_usada_por  on invitaciones (usada_por);
create index if not exists idx_miembros_comercio       on miembros (comercio_id);
create index if not exists idx_movimientos_lote        on movimientos (lote_id);
create index if not exists idx_movimientos_producto    on movimientos (producto_id);
create index if not exists idx_movimientos_sucursal    on movimientos (sucursal_id);
create index if not exists idx_push_tokens_comercio    on push_tokens (comercio_id);
create index if not exists idx_push_tokens_user        on push_tokens (user_id);
create index if not exists idx_vcaja_mov_sucursal      on ventas_caja_mov (sucursal_id);
create index if not exists idx_vcierres_sucursal       on ventas_cierres (sucursal_id);
create index if not exists idx_vdeudas_venta           on ventas_deudas (venta_id);
create index if not exists idx_vitems_comercio         on ventas_items (comercio_id);
create index if not exists idx_vitems_lote             on ventas_items (lote_id);
create index if not exists idx_vitems_producto         on ventas_items (producto_id);
create index if not exists idx_vventas_sucursal        on ventas_ventas (sucursal_id);

-- B) RLS initplan: (select auth.uid()) en vez de auth.uid() por fila.
--    (productos y sucursales se resuelven en C, que recrea sus policies)
do $$
begin
  if exists (select 1 from pg_policies where policyname = 'editar config (dueno)' and tablename = 'ventas_config') then
    alter policy "editar config (dueno)" on ventas_config
      using (exists (select 1 from miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id = ventas_config.comercio_id and m.rol = 'dueno'))
      with check (exists (select 1 from miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id = ventas_config.comercio_id and m.rol = 'dueno'));
  end if;
  if exists (select 1 from pg_policies where policyname = 'actualizar comercio propio' and tablename = 'comercios') then
    alter policy "actualizar comercio propio" on comercios
      using (exists (select 1 from miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id = comercios.id and m.rol = 'dueno'))
      with check (exists (select 1 from miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id = comercios.id and m.rol = 'dueno'));
  end if;
  if exists (select 1 from pg_policies where policyname = 'acceso tokens propios' and tablename = 'push_tokens') then
    alter policy "acceso tokens propios" on push_tokens
      using (comercio_id in (select comercios_del_usuario()))
      with check (comercio_id in (select comercios_del_usuario())
        and (user_id is null or user_id = (select auth.uid())));
  end if;
  if exists (select 1 from pg_policies where policyname = 'invitaciones (dueno)' and tablename = 'invitaciones') then
    alter policy "invitaciones (dueno)" on invitaciones
      using (exists (select 1 from miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id = invitaciones.comercio_id and m.rol = 'dueno'))
      with check (exists (select 1 from miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id = invitaciones.comercio_id and m.rol = 'dueno'));
  end if;
end $$;

-- C) Dueño: de FOR ALL a insert/update/delete (el SELECT queda solo en miembros).
drop policy if exists "editar productos (dueno)" on productos;
drop policy if exists "escribir productos (dueno)" on productos;
create policy "escribir productos (dueno)" on productos
  for insert to authenticated
  with check (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = productos.comercio_id and m.rol = 'dueno'));
drop policy if exists "modificar productos (dueno)" on productos;
create policy "modificar productos (dueno)" on productos
  for update to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = productos.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = productos.comercio_id and m.rol = 'dueno'));
drop policy if exists "borrar productos (dueno)" on productos;
create policy "borrar productos (dueno)" on productos
  for delete to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = productos.comercio_id and m.rol = 'dueno'));

drop policy if exists "editar sucursales (dueno)" on sucursales;
drop policy if exists "escribir sucursales (dueno)" on sucursales;
create policy "escribir sucursales (dueno)" on sucursales
  for insert to authenticated
  with check (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = sucursales.comercio_id and m.rol = 'dueno'));
drop policy if exists "modificar sucursales (dueno)" on sucursales;
create policy "modificar sucursales (dueno)" on sucursales
  for update to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = sucursales.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = sucursales.comercio_id and m.rol = 'dueno'));
drop policy if exists "borrar sucursales (dueno)" on sucursales;
create policy "borrar sucursales (dueno)" on sucursales
  for delete to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = sucursales.comercio_id and m.rol = 'dueno'));
