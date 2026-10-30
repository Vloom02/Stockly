-- Migración 15 · Ofertas para lo que está por vencer (revisión 2026-10-30). Sin DROP, idempotente.
-- "Liquidar" pasa de ser un aviso a un descuento de verdad en la caja: un % desde la primera unidad,
-- que se apaga solo el día que vence el lote (hasta). Una por producto y comercio.
-- Volver atrás: drop table ventas_liquidaciones (SQL Editor). La app sigue andando sin ella.

create table if not exists public.ventas_liquidaciones (
  id          uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references public.comercios(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete cascade,
  pct         numeric not null check (pct > 0 and pct <= 90),
  hasta       date not null,
  creado_en   timestamptz not null default now(),
  unique (comercio_id, producto_id)
);
alter table public.ventas_liquidaciones enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ventas_liquidaciones' and policyname = 'ver ofertas por vencer (miembros)') then
    create policy "ver ofertas por vencer (miembros)" on public.ventas_liquidaciones for select to authenticated
      using (comercio_id in (select comercios_del_usuario()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ventas_liquidaciones' and policyname = 'manejar ofertas por vencer (dueno)') then
    create policy "manejar ofertas por vencer (dueno)" on public.ventas_liquidaciones for all to authenticated
      using (exists (select 1 from miembros m where m.user_id = (select auth.uid()) and m.comercio_id = ventas_liquidaciones.comercio_id and m.rol = 'dueno'))
      with check (exists (select 1 from miembros m where m.user_id = (select auth.uid()) and m.comercio_id = ventas_liquidaciones.comercio_id and m.rol = 'dueno')
        and exists (select 1 from productos p where p.id = ventas_liquidaciones.producto_id and p.comercio_id = ventas_liquidaciones.comercio_id));
  end if;
end $$;

grant select, insert, update, delete on public.ventas_liquidaciones to authenticated;
revoke all on public.ventas_liquidaciones from anon;
create index if not exists idx_vliquidaciones_producto on public.ventas_liquidaciones (producto_id);
