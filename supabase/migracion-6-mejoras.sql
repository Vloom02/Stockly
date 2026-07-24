-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 6 — Mejoras de producto (2026-07)
-- Aditiva e idempotente.
--   A) productos.stock_minimo: alerta de reposición ("quedan pocas unidades").
--   B) productos.foto_url: miniatura del producto (Supabase Storage).
--   C) precios_historial + trigger: registra TODO cambio de precio (venga de
--      ProductoPage, de Suba de precios o del sync) sin tocar los clientes.
-- ═══════════════════════════════════════════════════════════════════════════

-- A y B
alter table productos add column if not exists stock_minimo int not null default 0;
alter table productos add column if not exists foto_url text;

-- C) Historial de precios
create table if not exists precios_historial (
  id              uuid primary key default gen_random_uuid(),
  comercio_id     uuid not null references comercios(id) on delete cascade,
  producto_id     uuid not null references productos(id) on delete cascade,
  precio_anterior numeric not null,
  precio_nuevo    numeric not null,
  cambiado_en     timestamptz not null default now()
);
create index if not exists idx_preciosh_producto on precios_historial (producto_id, cambiado_en desc);
create index if not exists idx_preciosh_comercio on precios_historial (comercio_id);

alter table precios_historial enable row level security;
-- Miembros del comercio pueden LEER su historial. Nadie escribe directo:
-- inserta solo el trigger (security definer).
drop policy if exists "ver historial precios (miembros)" on precios_historial;
create policy "ver historial precios (miembros)" on precios_historial
  for select to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = (select auth.uid()) and m.comercio_id = precios_historial.comercio_id));

create or replace function _log_precio()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into precios_historial (comercio_id, producto_id, precio_anterior, precio_nuevo)
    values (new.comercio_id, new.id, old.precio, new.precio);
  return new;
end $$;
revoke execute on function _log_precio() from public, anon, authenticated;

drop trigger if exists trg_log_precio on productos;
create trigger trg_log_precio
  after update of precio on productos
  for each row
  when (old.precio is distinct from new.precio)
  execute function _log_precio();
