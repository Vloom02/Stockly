-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 7 — Hardening de autenticación (auditoría 2026-07-11)
-- Aditiva e idempotente. Corrige dos hallazgos:
--   A) Fuerza bruta online: verificar_pin y verificar_empleado_venta no
--      limitaban intentos → un PIN de 4-6 dígitos se prueba entero vía RPC.
--      Fix: lockout de 15 min tras 5 fallos consecutivos (por comercio/clave).
--   B) Hashes sin sal: pin_hash y pass_hash eran SHA-256 pelado → crackeo
--      instantáneo si se filtra la DB. Fix: bcrypt (crypt/gen_salt de pgcrypto)
--      con upgrade perezoso: el hash legado SHA-256 se acepta y se re-hashea
--      a bcrypt en el primer login exitoso. No hace falta tocar los clientes.
-- ═══════════════════════════════════════════════════════════════════════════

-- A) Tabla de intentos fallidos. Sin policies a propósito: RLS habilitado y
--    acceso SOLO a través de las funciones SECURITY DEFINER de abajo.
create table if not exists auth_intentos (
  comercio_id    uuid not null references comercios(id) on delete cascade,
  clave          text not null,              -- 'pin' | 'legajo:<legajo>'
  fallos         int  not null default 0,
  bloqueado_hasta timestamptz,
  actualizado_en timestamptz not null default now(),
  primary key (comercio_id, clave)
);
alter table auth_intentos enable row level security;

-- Helper interno: devuelve true si la clave está bloqueada.
create or replace function _auth_bloqueado(p_comercio uuid, p_clave text)
returns boolean
language sql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select coalesce((select bloqueado_hasta > now() from auth_intentos
                   where comercio_id = p_comercio and clave = p_clave), false);
$$;

-- Helper interno: registra un intento fallido; 5 fallos → 15 min de bloqueo.
create or replace function _auth_fallo(p_comercio uuid, p_clave text)
returns void
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_fallos int;
  v_lock   timestamptz;
begin
  select fallos, bloqueado_hasta into v_fallos, v_lock
    from auth_intentos where comercio_id = p_comercio and clave = p_clave;
  if not found then v_fallos := 0; end if;
  if v_lock is not null and v_lock <= now() then v_fallos := 0; end if; -- lock vencido: arranca de nuevo
  v_fallos := v_fallos + 1;
  insert into auth_intentos (comercio_id, clave, fallos, bloqueado_hasta, actualizado_en)
    values (p_comercio, p_clave, v_fallos,
            case when v_fallos >= 5 then now() + interval '15 minutes' end, now())
  on conflict (comercio_id, clave) do update set
    fallos = excluded.fallos,
    bloqueado_hasta = excluded.bloqueado_hasta,
    actualizado_en = now();
end $$;

-- Helper interno: login OK → limpiar contador.
create or replace function _auth_exito(p_comercio uuid, p_clave text)
returns void
language sql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  delete from auth_intentos where comercio_id = p_comercio and clave = p_clave;
$$;

-- Helpers NO invocables desde la API pública.
revoke execute on function _auth_bloqueado(uuid, text) from public, anon, authenticated;
revoke execute on function _auth_fallo(uuid, text)     from public, anon, authenticated;
revoke execute on function _auth_exito(uuid, text)     from public, anon, authenticated;

-- Comparación con soporte de hash legado + upgrade perezoso.
-- Devuelve: null = no coincide; si coincide, el hash a persistir (bcrypt).
create or replace function _auth_verificar_hash(p_pass text, p_hash text)
returns text
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if p_hash is null or p_pass = '' then return null; end if;
  if p_hash like '$2%' then                             -- bcrypt
    if crypt(p_pass, p_hash) = p_hash then return p_hash; end if;
  elsif p_hash = encode(digest(p_pass, 'sha256'), 'hex') then  -- legado SHA-256
    return crypt(p_pass, gen_salt('bf'));               -- upgrade perezoso
  end if;
  return null;
end $$;
revoke execute on function _auth_verificar_hash(text, text) from public, anon, authenticated;

-- B1) verificar_pin con lockout + bcrypt (misma firma/retorno: boolean).
create or replace function verificar_pin(p jsonb)
returns boolean
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_pin   text := coalesce(p->>'pin','');
  v_hash  text;
  v_nuevo text;
begin
  if v_comercio is null or v_pin = '' then return false; end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  if _auth_bloqueado(v_comercio, 'pin') then return false; end if;

  select pin_hash into v_hash from ventas_config where comercio_id = v_comercio;
  v_nuevo := _auth_verificar_hash(v_pin, v_hash);
  if v_nuevo is null then
    perform _auth_fallo(v_comercio, 'pin');
    return false;
  end if;
  if v_nuevo <> v_hash then  -- hash legado → persistir bcrypt
    update ventas_config set pin_hash = v_nuevo where comercio_id = v_comercio;
  end if;
  perform _auth_exito(v_comercio, 'pin');
  return true;
end $$;

-- B2) verificar_empleado_venta con lockout por legajo + bcrypt (mismo retorno).
create or replace function verificar_empleado_venta(p jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_legajo text := trim(coalesce(p->>'legajo',''));
  v_pass   text := coalesce(p->>'pass','');
  v_emp    record;
  v_nuevo  text;
begin
  if v_comercio is null or v_legajo = '' or v_pass = '' then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  if _auth_bloqueado(v_comercio, 'legajo:' || v_legajo) then return jsonb_build_object('ok', false); end if;

  select * into v_emp from ventas_empleados
    where comercio_id = v_comercio and legajo = v_legajo and activo = true;
  v_nuevo := case when found then _auth_verificar_hash(v_pass, v_emp.pass_hash) end;
  if v_nuevo is null then
    perform _auth_fallo(v_comercio, 'legajo:' || v_legajo);
    return jsonb_build_object('ok', false);
  end if;
  if v_nuevo <> v_emp.pass_hash then  -- hash legado → persistir bcrypt
    update ventas_empleados set pass_hash = v_nuevo where id = v_emp.id;
  end if;
  perform _auth_exito(v_comercio, 'legajo:' || v_legajo);
  return jsonb_build_object('ok', true, 'id', v_emp.id, 'legajo', v_emp.legajo, 'nombre', v_emp.nombre);
end $$;

-- C) configurar_pin: el cliente manda el PIN en claro por TLS y el hash nace
--    en bcrypt server-side (antes el cliente escribía SHA-256 directo en
--    ventas_config). Solo el dueño puede configurarlo.
create or replace function configurar_pin(p jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_pin text := coalesce(p->>'pin','');
begin
  if v_comercio is null or length(v_pin) < 4 then
    raise exception 'PIN inválido (mínimo 4 dígitos)';
  end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio and m.rol = 'dueno') then
    raise exception 'solo el dueño puede configurar el PIN';
  end if;
  insert into ventas_config (comercio_id, pin_hash, updated_at)
    values (v_comercio, crypt(v_pin, gen_salt('bf')), now())
  on conflict (comercio_id) do update
    set pin_hash = excluded.pin_hash, updated_at = now();
  perform _auth_exito(v_comercio, 'pin');  -- PIN nuevo: resetear lockout
  return jsonb_build_object('ok', true);
end $$;

-- B3) Altas/cambios de contraseña de cajeros: directo a bcrypt.
create or replace function guardar_empleado_venta(p jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions', 'pg_temp'
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
      values (v_comercio, v_legajo, v_nombre, crypt(v_pass, gen_salt('bf')))
      returning id into v_id;
  else
    update ventas_empleados
      set legajo = v_legajo, nombre = v_nombre,
          pass_hash = case when v_pass = '' then pass_hash else crypt(v_pass, gen_salt('bf')) end,
          activo = coalesce((p->>'activo')::boolean, activo)
      where id = v_id and comercio_id = v_comercio;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
