-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  STOCKLY · Esquema multi-tenant para Supabase                          ║
-- ║  Ejecutar este script en: Supabase Dashboard → SQL Editor → New query  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ──────────────────────────────────────────────────────────────────────────
-- 1. COMERCIOS (tenants) — cada comercio que compra Stockly
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists comercios (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  plan        text not null default 'trial',        -- trial | activo | suspendido
  trial_hasta timestamptz default (now() + interval '14 days'),
  creado_en   timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. MIEMBROS — vincula usuarios (auth.users) con comercios + rol
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists miembros (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  comercio_id uuid not null references comercios(id) on delete cascade,
  rol         text not null default 'empleado',      -- dueno | empleado
  nombre      text,
  creado_en   timestamptz not null default now(),
  unique (user_id, comercio_id)
);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. SUCURSALES — pertenecen a un comercio
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists sucursales (
  id          uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id) on delete cascade,
  nombre      text not null,
  direccion   text,
  activa      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. PRODUCTOS — catálogo COMPARTIDO entre sucursales del mismo comercio
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists productos (
  id            uuid primary key default gen_random_uuid(),
  comercio_id   uuid not null references comercios(id) on delete cascade,
  nombre        text not null,
  codigo_barras text,
  categoria     text not null default 'Sin categoría',
  precio        numeric(12,2) not null default 0,
  dias_aviso_default int not null default 15,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. LOTES — stock real, vencimiento INDIVIDUAL por sucursal
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists lotes (
  id                uuid primary key default gen_random_uuid(),
  comercio_id       uuid not null references comercios(id) on delete cascade,
  producto_id       uuid not null references productos(id) on delete cascade,
  sucursal_id       uuid not null references sucursales(id) on delete cascade,
  cantidad          int not null default 0,
  fecha_vencimiento date not null,
  dias_aviso        int not null default 15,
  fecha_ingreso     date not null default current_date,
  proveedor         text,
  numero_lote       text,
  retirado          boolean not null default false,
  creado_en         timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 6. MOVIMIENTOS — audit log por comercio
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists movimientos (
  id                 uuid primary key default gen_random_uuid(),
  comercio_id        uuid not null references comercios(id) on delete cascade,
  lote_id            uuid references lotes(id) on delete set null,
  producto_id        uuid references productos(id) on delete set null,
  sucursal_id        uuid references sucursales(id) on delete set null,
  tipo               text not null,   -- ingreso|retiro_venta|retiro_vencido|retiro_roto|ajuste|creacion|edicion
  cantidad           int not null default 0,
  cantidad_anterior  int not null default 0,
  cantidad_nueva     int not null default 0,
  usuario            text,
  notas              text,
  fecha              timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- ÍNDICES para performance
-- ──────────────────────────────────────────────────────────────────────────
create index if not exists idx_productos_comercio  on productos(comercio_id);
create index if not exists idx_lotes_comercio       on lotes(comercio_id);
create index if not exists idx_lotes_sucursal       on lotes(sucursal_id);
create index if not exists idx_lotes_producto       on lotes(producto_id);
create index if not exists idx_lotes_venc           on lotes(fecha_vencimiento);
create index if not exists idx_movim_comercio       on movimientos(comercio_id);
create index if not exists idx_movim_fecha          on movimientos(fecha desc);
create index if not exists idx_sucursales_comercio  on sucursales(comercio_id);

-- ══════════════════════════════════════════════════════════════════════════
-- updated_at + trigger → habilita SYNC INCREMENTAL (bajar solo lo que cambió)
-- y resolución de conflictos last-write-wins por timestamp del servidor.
-- (movimientos no lo necesita: son inserts inmutables, se filtran por `fecha`.)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end $$;
revoke execute on function set_updated_at() from public, anon, authenticated;

alter table productos  add column if not exists updated_at timestamptz not null default now();
alter table lotes      add column if not exists updated_at timestamptz not null default now();
alter table sucursales add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_productos_updated_at on productos;
create trigger trg_productos_updated_at  before update on productos  for each row execute function set_updated_at();
drop trigger if exists trg_lotes_updated_at on lotes;
create trigger trg_lotes_updated_at      before update on lotes      for each row execute function set_updated_at();
drop trigger if exists trg_sucursales_updated_at on sucursales;
create trigger trg_sucursales_updated_at before update on sucursales for each row execute function set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) — corazón del multi-tenant
-- Cada usuario SOLO puede ver/editar datos de SU comercio.
-- ══════════════════════════════════════════════════════════════════════════

-- Función helper: devuelve los comercio_id a los que pertenece el usuario actual
create or replace function comercios_del_usuario()
returns setof uuid
language sql security definer stable
set search_path = public, pg_temp          -- F4: search_path fijo (anti-secuestro)
as $$
  select comercio_id from miembros where user_id = auth.uid()
$$;

-- Activar RLS en todas las tablas
alter table comercios   enable row level security;
alter table miembros    enable row level security;
alter table sucursales  enable row level security;
alter table productos   enable row level security;
alter table lotes       enable row level security;
alter table movimientos enable row level security;

-- NOTA DE SEGURIDAD: todas las policies aplican al rol `authenticated` (F3),
-- nunca a `public`/`anon`. La escritura de catálogo (productos, sucursales) la
-- restringe al rol 'dueno' (F2); los miembros comunes solo leen.

-- ─── COMERCIOS ───────────────────────────────────────────────────────────
create policy "ver comercio propio" on comercios
  for select to authenticated using (id in (select comercios_del_usuario()));
-- Solo el DUEÑO puede actualizar el comercio (plan/trial), con WITH CHECK
-- (evita que un empleado escale el plan).
create policy "actualizar comercio propio" on comercios
  for update to authenticated
  using (exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = comercios.id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = comercios.id and m.rol = 'dueno'));

-- ─── MIEMBROS ────────────────────────────────────────────────────────────
-- F1: NO existe policy de INSERT abierta. La membresía se crea SOLO por el
-- trigger on_auth_user_created (SECURITY DEFINER). Una policy `insert with
-- check (user_id = auth.uid())` permitiría a cualquiera auto-agregarse como
-- dueño de OTRO comercio → toma de control total. Para invitar empleados,
-- usar una función SECURITY DEFINER que valide que quien invita es dueño.
create policy "ver miembros de mi comercio" on miembros
  for select to authenticated using (comercio_id in (select comercios_del_usuario()));

-- ─── SUCURSALES (leen miembros · escribe solo dueño) ──────────────────────
create policy "ver sucursales (miembros)" on sucursales
  for select to authenticated using (comercio_id in (select comercios_del_usuario()));
create policy "editar sucursales (dueno)" on sucursales
  for all to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = sucursales.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = sucursales.comercio_id and m.rol = 'dueno'));

-- ─── PRODUCTOS (leen miembros · escribe solo dueño) ───────────────────────
create policy "ver productos (miembros)" on productos
  for select to authenticated using (comercio_id in (select comercios_del_usuario()));
create policy "editar productos (dueno)" on productos
  for all to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = productos.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = productos.comercio_id and m.rol = 'dueno'));

-- ─── LOTES (acceso total a miembros: vender descuenta stock) ──────────────
create policy "acceso total lotes propios" on lotes
  for all to authenticated using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));

-- ─── MOVIMIENTOS (audit log: lo escribe cualquier miembro al vender) ──────
create policy "acceso total movimientos propios" on movimientos
  for all to authenticated using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));

-- ══════════════════════════════════════════════════════════════════════════
-- TRIGGER: al registrarse un usuario nuevo, crear su comercio + membresía
-- (esto hace que el onboarding sea automático)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function crear_comercio_para_nuevo_usuario()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp          -- F4: search_path fijo
as $$
declare
  nuevo_comercio_id uuid;
begin
  -- Crear comercio
  insert into comercios (nombre)
  values (coalesce(new.raw_user_meta_data->>'nombre_comercio', 'Mi comercio'))
  returning id into nuevo_comercio_id;

  -- Crear membresía como dueño
  insert into miembros (user_id, comercio_id, rol, nombre)
  values (new.id, nuevo_comercio_id, 'dueno', new.raw_user_meta_data->>'nombre');

  -- Crear sucursal principal por defecto
  insert into sucursales (comercio_id, nombre)
  values (nuevo_comercio_id, 'Principal');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function crear_comercio_para_nuevo_usuario();

-- F5: la función de onboarding NO debe poder llamarse por RPC (solo la usa el
-- trigger, que corre como definer). Revocar EXECUTE a todos los roles externos.
revoke execute on function crear_comercio_para_nuevo_usuario() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- ajustar_stock(p jsonb): aplica un DELTA atómico a la cantidad de un lote y
-- registra el movimiento (idempotente por id de movimiento, multi-tenant).
-- Stockly usa esto para retiros/ajustes en vez de pisar `cantidad` con un upsert,
-- así no revierte lo que descontó la app de Ventas (registrar_venta).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function ajustar_stock(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mov   uuid := (p->>'mov_id')::uuid;
  v_com   uuid := (p->>'comercio_id')::uuid;
  v_lote  uuid := (p->>'lote_id')::uuid;
  v_delta int  := coalesce((p->>'delta')::int, 0);
  v_nueva int;
  v_pid_real uuid;
  v_suc_real uuid;
begin
  if v_mov is null or v_com is null or v_lote is null then
    raise exception 'datos de ajuste incompletos';
  end if;
  if v_com not in (select comercios_del_usuario()) then
    raise exception 'comercio no autorizado';
  end if;
  if exists (select 1 from movimientos where id = v_mov) then
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;

  -- Deriva producto_id/sucursal_id del PROPIO lote (no confía en el cliente).
  update lotes
    set cantidad = greatest(0, cantidad + v_delta),
        retirado = greatest(0, cantidad + v_delta) <= 0
    where id = v_lote and comercio_id = v_com
    returning cantidad, producto_id, sucursal_id into v_nueva, v_pid_real, v_suc_real;
  if v_nueva is null then
    raise exception 'lote inexistente o de otro comercio';
  end if;

  insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo,
                           cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
  values (v_mov, v_com, v_lote, v_pid_real, v_suc_real,
          coalesce(p->>'tipo','ajuste'), v_delta,
          coalesce((p->>'cantidad_anterior')::int, 0), v_nueva,
          nullif(p->>'usuario',''), nullif(p->>'notas',''),
          coalesce((p->>'fecha')::timestamptz, now()));

  return jsonb_build_object('ok', true, 'duplicado', false, 'cantidad', v_nueva);
end $$;

revoke execute on function ajustar_stock(jsonb) from public, anon;
grant  execute on function ajustar_stock(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- push_tokens: tokens FCM de los dispositivos, por comercio (notificaciones de
-- vencimiento). RLS multi-tenant + un miembro no puede registrar a nombre de otro.
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists push_tokens (
  token       text primary key,
  comercio_id uuid not null references comercios(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  plataforma  text default 'android',
  updated_at  timestamptz not null default now()
);
alter table push_tokens enable row level security;
drop policy if exists "acceso tokens propios" on push_tokens;
create policy "acceso tokens propios" on push_tokens
  for all to authenticated
  using (comercio_id in (select comercios_del_usuario()))
  with check (
    comercio_id in (select comercios_del_usuario())
    and (user_id is null or user_id = auth.uid())
  );

-- ══════════════════════════════════════════════════════════════════════════
-- LISTO. Ahora activá Realtime para sincronización entre dispositivos:
-- Dashboard → Database → Replication → activá: productos, lotes, movimientos, sucursales
-- ══════════════════════════════════════════════════════════════════════════
