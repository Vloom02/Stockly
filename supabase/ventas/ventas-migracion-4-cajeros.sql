-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #4 (Ventas) — Cajeros por LEGAJO + contraseña.
-- Dentro de la cuenta del negocio (un solo login de Supabase), cada cajero
-- inicia su turno con su legajo + contraseña para ATRIBUIR las ventas. Es una
-- capa de la app (no un usuario de Supabase): distinto al sistema de empleados
-- de Stockly (que sí son cuentas por invitación).
--   • listar_empleados_venta:   lista (sin hash) para el selector.
--   • verificar_empleado_venta: valida legajo+contraseña, server-side.
--   • guardar_empleado_venta:   alta/edición (solo dueño).
--   • baja_empleado_venta:      desactiva (solo dueño).
-- Hashes con pgcrypto (extensions). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

create table if not exists ventas_empleados (
  id          uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id) on delete cascade,
  legajo      text not null,
  nombre      text not null,
  pass_hash   text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (comercio_id, legajo)
);

-- RLS: SIN policies de acceso directo → la tabla solo se toca por los RPCs
-- (SECURITY DEFINER, que validan membresía). Así el pass_hash nunca se expone
-- por PostgREST.
alter table ventas_empleados enable row level security;

create index if not exists idx_vempleados_comercio on ventas_empleados(comercio_id);

-- ─── helpers de autorización ────────────────────────────────────────────────
-- (inline en cada función para mantener search_path fijo)

-- ─── listar (sin hash) ──────────────────────────────────────────────────────
create or replace function listar_empleados_venta(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_res jsonb;
begin
  if v_comercio is null then raise exception 'datos incompletos'; end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'legajo', legajo, 'nombre', nombre, 'activo', activo
         ) order by nombre), '[]'::jsonb)
  into v_res
  from ventas_empleados where comercio_id = v_comercio;
  return v_res;
end $$;
revoke execute on function listar_empleados_venta(jsonb) from public, anon;
grant  execute on function listar_empleados_venta(jsonb) to authenticated;

-- ─── verificar legajo + contraseña ──────────────────────────────────────────
create or replace function verificar_empleado_venta(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_legajo   text := trim(coalesce(p->>'legajo',''));
  v_pass     text := coalesce(p->>'pass','');
  v_emp      record;
begin
  if v_comercio is null or v_legajo = '' or v_pass = '' then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  select * into v_emp from ventas_empleados
    where comercio_id = v_comercio and legajo = v_legajo and activo = true;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_emp.pass_hash <> encode(digest(v_pass,'sha256'),'hex') then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'id', v_emp.id, 'legajo', v_emp.legajo, 'nombre', v_emp.nombre);
end $$;
revoke execute on function verificar_empleado_venta(jsonb) from public, anon;
grant  execute on function verificar_empleado_venta(jsonb) to authenticated;

-- ─── alta / edición (solo dueño) ────────────────────────────────────────────
create or replace function guardar_empleado_venta(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id       uuid := nullif(p->>'id','')::uuid;
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_legajo   text := trim(coalesce(p->>'legajo',''));
  v_nombre   text := trim(coalesce(p->>'nombre',''));
  v_pass     text := coalesce(p->>'pass','');
begin
  if v_comercio is null or v_legajo = '' or v_nombre = '' then raise exception 'datos incompletos'; end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio and m.rol = 'dueno') then
    raise exception 'solo el dueño puede gestionar cajeros';
  end if;

  if v_id is null then
    if v_pass = '' then raise exception 'falta la contraseña'; end if;
    insert into ventas_empleados (comercio_id, legajo, nombre, pass_hash)
      values (v_comercio, v_legajo, v_nombre, encode(digest(v_pass,'sha256'),'hex'))
      returning id into v_id;
  else
    update ventas_empleados
      set legajo = v_legajo, nombre = v_nombre,
          pass_hash = case when v_pass = '' then pass_hash else encode(digest(v_pass,'sha256'),'hex') end,
          activo = coalesce((p->>'activo')::boolean, activo)
      where id = v_id and comercio_id = v_comercio;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function guardar_empleado_venta(jsonb) from public, anon;
grant  execute on function guardar_empleado_venta(jsonb) to authenticated;

-- ─── baja (desactivar) (solo dueño) ─────────────────────────────────────────
create or replace function baja_empleado_venta(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid := (p->>'id')::uuid;
  v_comercio uuid := (p->>'comercio_id')::uuid;
begin
  if v_id is null or v_comercio is null then raise exception 'datos incompletos'; end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio and m.rol = 'dueno') then
    raise exception 'solo el dueño puede gestionar cajeros';
  end if;
  update ventas_empleados set activo = false where id = v_id and comercio_id = v_comercio;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function baja_empleado_venta(jsonb) from public, anon;
grant  execute on function baja_empleado_venta(jsonb) to authenticated;
