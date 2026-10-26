-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 8 — Promociones del POS (2026-07)
-- Aditiva e idempotente. Promos simples por producto:
--   '2x1'          → cada 2 unidades, 1 gratis (min_cant fijo en 2).
--   'pct_cantidad' → comprando >= min_cant unidades, pct% de descuento
--                    sobre ese producto.
-- El descuento lo calcula el cliente (ventas-engine) y viaja en el campo
-- descuento de la venta; el server ya valida totales en registrar_venta.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists ventas_promos (
  id          uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  tipo        text not null check (tipo in ('2x1', 'pct_cantidad')),
  min_cant    int  not null default 2 check (min_cant >= 2),
  pct         numeric not null default 0 check (pct >= 0 and pct <= 90),
  activa      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (comercio_id, producto_id)
);
create index if not exists idx_vpromos_comercio on ventas_promos (comercio_id) where activa;

alter table ventas_promos enable row level security;

drop policy if exists "ver promos (miembros)" on ventas_promos;
create policy "ver promos (miembros)" on ventas_promos
  for select to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = ventas_promos.comercio_id));

drop policy if exists "escribir promos (dueno)" on ventas_promos;
create policy "escribir promos (dueno)" on ventas_promos
  for insert to authenticated
  with check (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = ventas_promos.comercio_id and m.rol = 'dueno'));

drop policy if exists "modificar promos (dueno)" on ventas_promos;
create policy "modificar promos (dueno)" on ventas_promos
  for update to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = ventas_promos.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = ventas_promos.comercio_id and m.rol = 'dueno'));

drop policy if exists "borrar promos (dueno)" on ventas_promos;
create policy "borrar promos (dueno)" on ventas_promos
  for delete to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = ventas_promos.comercio_id and m.rol = 'dueno'));
