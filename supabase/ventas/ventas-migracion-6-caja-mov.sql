-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #6 (Ventas) — Movimientos de caja del turno.
--   • apertura: el cajero declara el fondo inicial al abrir.
--   • ingreso/egreso: efectivo que entra o sale durante el turno (con motivo).
-- El cierre de caja calcula: esperado = apertura + efectivo de ventas
--   + ingresos − egresos, y lo compara con lo contado.
-- Acceso directo por RLS (cuenta del comercio).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists ventas_caja_mov (
  id            uuid primary key default gen_random_uuid(),
  comercio_id   uuid not null references comercios(id) on delete cascade,
  sucursal_id   uuid references sucursales(id) on delete set null,
  cajero_legajo text,
  cajero_nombre text,
  turno_desde   timestamptz,                 -- agrupa los movimientos de un turno
  tipo          text not null check (tipo in ('apertura','ingreso','egreso')),
  monto         numeric(12,2) not null,
  motivo        text,
  fecha         timestamptz not null default now()
);

create index if not exists idx_vcajamov_comercio on ventas_caja_mov(comercio_id, turno_desde);

alter table ventas_caja_mov enable row level security;

drop policy if exists "acceso caja_mov propios" on ventas_caja_mov;
create policy "acceso caja_mov propios" on ventas_caja_mov
  for all to authenticated
  using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));
