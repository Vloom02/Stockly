-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 8 — Rol "desarrollador / soporte" de la plataforma (aditiva e idempotente)
-- Requiere la migración 7 (el trigger que impide que el dueño se cambie el plan):
-- desde ahora el plan SOLO se cambia con admin_cambiar_plan, que verifica que
-- quien llama esté en plataforma_admins. Cada cambio queda auditado.
--
-- Para darte acceso (una sola vez, en el SQL editor de Supabase):
--   insert into plataforma_admins (user_id)
--   select id from auth.users where email = 'TU_EMAIL';
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists plataforma_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  creado_en timestamptz not null default now()
);
-- Sin policies a propósito: solo se lee desde las funciones SECURITY DEFINER.
alter table plataforma_admins enable row level security;

create table if not exists admin_auditoria (
  id          bigserial primary key,
  admin_id    uuid not null,
  comercio_id uuid not null references comercios(id) on delete cascade,
  accion      text not null,
  antes       jsonb,
  despues     jsonb,
  fecha       timestamptz not null default now()
);
alter table admin_auditoria enable row level security;

-- ¿El usuario actual es admin de la plataforma? (la app lo usa para mostrar el panel)
create or replace function es_admin_plataforma()
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from plataforma_admins where user_id = auth.uid());
$$;
revoke execute on function es_admin_plataforma() from public, anon;
grant  execute on function es_admin_plataforma() to authenticated;

-- Lista de comercios con lo necesario para dar soporte.
create or replace function admin_listar_comercios()
returns table (
  id uuid, nombre text, plan text, trial_hasta timestamptz, creado_en timestamptz,
  email_dueno text, miembros int, productos int, lotes int,
  ventas_30d int, ultima_actividad timestamptz
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if not es_admin_plataforma() then
    raise exception 'no autorizado';
  end if;
  return query
  select c.id, c.nombre, c.plan, c.trial_hasta, c.creado_en,
         (select u.email::text from miembros m join auth.users u on u.id = m.user_id
           where m.comercio_id = c.id and m.rol = 'dueno' order by m.user_id limit 1),
         (select count(*)::int from miembros m where m.comercio_id = c.id),
         (select count(*)::int from productos p where p.comercio_id = c.id and p.activo),
         (select count(*)::int from lotes l where l.comercio_id = c.id and not l.retirado),
         (select count(*)::int from ventas_ventas v where v.comercio_id = c.id and v.fecha > now() - interval '30 days'),
         (select max(mv.creado_en) from movimientos mv where mv.comercio_id = c.id)
  from comercios c
  order by c.creado_en desc;
end $$;
revoke execute on function admin_listar_comercios() from public, anon;
grant  execute on function admin_listar_comercios() to authenticated;

-- Cambiar el plan de un comercio: activo | trial (con fecha) | suspendido.
create or replace function admin_cambiar_plan(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_plan     text := p->>'plan';
  v_hasta    timestamptz := nullif(p->>'trial_hasta', '')::timestamptz;
  v_antes    jsonb;
begin
  if not es_admin_plataforma() then
    raise exception 'no autorizado';
  end if;
  if v_plan not in ('trial', 'activo', 'suspendido') then
    raise exception 'plan inválido';
  end if;
  if v_plan = 'trial' and v_hasta is null then
    raise exception 'falta la fecha de fin de la prueba';
  end if;

  select jsonb_build_object('plan', plan, 'trial_hasta', trial_hasta) into v_antes
    from comercios where id = v_comercio;
  if v_antes is null then
    raise exception 'comercio inexistente';
  end if;

  -- Corre como dueño de la función (no "authenticated"): el trigger de la migración 7 lo permite.
  update comercios
     set plan = v_plan,
         trial_hasta = case when v_plan = 'trial' then v_hasta else trial_hasta end
   where id = v_comercio;

  insert into admin_auditoria (admin_id, comercio_id, accion, antes, despues)
  values (auth.uid(), v_comercio, 'cambiar_plan', v_antes,
          jsonb_build_object('plan', v_plan, 'trial_hasta', v_hasta));

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function admin_cambiar_plan(jsonb) from public, anon;
grant  execute on function admin_cambiar_plan(jsonb) to authenticated;
