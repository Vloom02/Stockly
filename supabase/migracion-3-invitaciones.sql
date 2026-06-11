-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #3 — Gestión de empleados por código de invitación.
--   • Tabla invitaciones (código de un solo uso, vence a los 7 días).
--   • crear_invitacion(p):   el dueño genera un código.
--   • validar_invitacion(p): chequeo previo al registro (anon) → nombre comercio.
--   • quitar_miembro(p):     el dueño da de baja a un empleado.
--   • Trigger de registro actualizado: si el usuario trae código válido,
--     se une como EMPLEADO a ese comercio en vez de crear uno propio.
-- Idempotente (if not exists / or replace). Correr en el mismo proyecto.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists invitaciones (
  id          uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id) on delete cascade,
  codigo      text not null unique,
  creada_por  uuid references auth.users(id) on delete set null,
  creado_en   timestamptz not null default now(),
  expira_en   timestamptz not null default now() + interval '7 days',
  usada_por   uuid references auth.users(id) on delete set null,
  usada_en    timestamptz
);

create index if not exists idx_invitaciones_comercio on invitaciones(comercio_id);

alter table invitaciones enable row level security;

-- Solo el DUEÑO del comercio ve y administra sus invitaciones.
drop policy if exists "invitaciones (dueno)" on invitaciones;
create policy "invitaciones (dueno)" on invitaciones
  for all to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = invitaciones.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = invitaciones.comercio_id and m.rol = 'dueno'));

-- ─── crear_invitacion: genera un código de un solo uso (solo dueño) ─────────
create or replace function crear_invitacion(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_codigo   text;
begin
  if v_comercio is null then raise exception 'datos incompletos'; end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio and m.rol = 'dueno') then
    raise exception 'solo el dueño puede invitar';
  end if;

  -- Código legible de 8 caracteres (sin 0/O ni 1/I para evitar confusiones).
  v_codigo := (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                             1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 8)
  );

  insert into invitaciones (comercio_id, codigo, creada_por)
  values (v_comercio, v_codigo, auth.uid());

  return jsonb_build_object('ok', true, 'codigo', v_codigo,
                            'expira_en', (now() + interval '7 days'));
end $$;

revoke execute on function crear_invitacion(jsonb) from public, anon;
grant  execute on function crear_invitacion(jsonb) to authenticated;

-- ─── validar_invitacion: chequeo previo al registro (callable sin sesión) ───
-- Devuelve SOLO el nombre del comercio si el código está vigente. No expone ids.
create or replace function validar_invitacion(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text := upper(trim(coalesce(p->>'codigo','')));
  v_nombre text;
begin
  select c.nombre into v_nombre
  from invitaciones i join comercios c on c.id = i.comercio_id
  where i.codigo = v_codigo and i.usada_por is null and i.expira_en > now();

  if v_nombre is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'comercio', v_nombre);
end $$;

grant execute on function validar_invitacion(jsonb) to anon, authenticated;

-- ─── quitar_miembro: el dueño da de baja a un empleado (nunca a un dueño) ───
create or replace function quitar_miembro(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_miembro  uuid := (p->>'miembro_id')::uuid;
  v_m        record;
begin
  if v_miembro is null then raise exception 'datos incompletos'; end if;
  select * into v_m from miembros where id = v_miembro;
  if not found then raise exception 'miembro inexistente'; end if;
  if v_m.rol <> 'empleado' then raise exception 'solo se puede quitar empleados'; end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_m.comercio_id and m.rol = 'dueno') then
    raise exception 'solo el dueño puede quitar miembros';
  end if;

  delete from miembros where id = v_miembro;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function quitar_miembro(jsonb) from public, anon;
grant  execute on function quitar_miembro(jsonb) to authenticated;

-- ─── Trigger de registro: honrar el código de invitación si viene ───────────
create or replace function crear_comercio_para_nuevo_usuario()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  nuevo_comercio_id uuid;
  v_codigo text := upper(trim(coalesce(new.raw_user_meta_data->>'codigo_invitacion','')));
  v_inv    record;
begin
  -- ¿Viene con código de invitación vigente? → unirse como EMPLEADO, sin crear comercio.
  if v_codigo <> '' then
    select * into v_inv from invitaciones
    where codigo = v_codigo and usada_por is null and expira_en > now()
    for update;
    if found then
      insert into miembros (user_id, comercio_id, rol, nombre)
      values (new.id, v_inv.comercio_id, 'empleado', new.raw_user_meta_data->>'nombre');
      update invitaciones set usada_por = new.id, usada_en = now() where id = v_inv.id;
      return new;
    end if;
    -- Código inválido/vencido: seguimos con el alta normal (comercio propio).
  end if;

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

revoke execute on function crear_comercio_para_nuevo_usuario() from public, anon, authenticated;
