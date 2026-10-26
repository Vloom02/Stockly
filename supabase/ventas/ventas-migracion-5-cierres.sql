-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #5 (Ventas) — Cierres de caja por cajero.
-- Al terminar su turno, el cajero arquea su caja (cuenta el efectivo) y cierra.
-- Queda registrado para que el dueño lo revise (quién, cuánto, qué diferencia).
-- Acceso directo por RLS (cuenta del comercio); sin hash → no hace falta RPC.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists ventas_cierres (
  id                 uuid primary key default gen_random_uuid(),
  comercio_id        uuid not null references comercios(id) on delete cascade,
  sucursal_id        uuid references sucursales(id) on delete set null,
  cajero_legajo      text,
  cajero_nombre      text,
  desde              timestamptz,
  hasta              timestamptz not null default now(),
  ventas_cant        int not null default 0,
  total              numeric(12,2) not null default 0,
  fondo_inicial      numeric(12,2) not null default 0,
  efectivo_esperado  numeric(12,2) not null default 0,
  efectivo_contado   numeric(12,2) not null default 0,
  diferencia         numeric(12,2) not null default 0,
  metodos            jsonb not null default '{}'::jsonb,
  notas              text,
  creado_en          timestamptz not null default now()
);

create index if not exists idx_vcierres_comercio on ventas_cierres(comercio_id, hasta desc);

alter table ventas_cierres enable row level security;

-- Cualquier miembro del comercio (la cuenta compartida) puede registrar y leer
-- sus cierres. El dueño los revisa desde Caja.
drop policy if exists "acceso cierres propios" on ventas_cierres;
create policy "acceso cierres propios" on ventas_cierres
  for all to authenticated
  using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));
