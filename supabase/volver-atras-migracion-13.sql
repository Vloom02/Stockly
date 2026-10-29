-- Volver atrás la migración 13 (correr en el SQL Editor de Supabase: tiene DROP).
-- Repone las funciones como estaban el 2026-10-29 y saca políticas, triggers y funciones nuevas.
begin;

drop policy if exists "solo por el servidor: crear" on public.ventas_ventas;
drop policy if exists "solo por el servidor: crear" on public.ventas_items;
drop policy if exists "solo por el servidor: crear" on public.ventas_deudas;
drop policy if exists "solo por el servidor: crear" on public.ventas_pagos;
drop policy if exists "inmutable: editar" on public.ventas_ventas;
drop policy if exists "inmutable: borrar" on public.ventas_ventas;
drop policy if exists "inmutable: editar" on public.ventas_items;
drop policy if exists "inmutable: borrar" on public.ventas_items;
drop policy if exists "inmutable: editar" on public.ventas_deudas;
drop policy if exists "inmutable: borrar" on public.ventas_deudas;
drop policy if exists "inmutable: editar" on public.ventas_pagos;
drop policy if exists "inmutable: borrar" on public.ventas_pagos;
drop policy if exists "inmutable: editar" on public.ventas_cierres;
drop policy if exists "inmutable: borrar" on public.ventas_cierres;
drop policy if exists "inmutable: editar" on public.ventas_caja_mov;
drop policy if exists "inmutable: borrar" on public.ventas_caja_mov;
drop policy if exists "lotes: mismo comercio (crear)" on public.lotes;
drop policy if exists "lotes: mismo comercio (editar)" on public.lotes;
drop trigger if exists trg_exigir_plan on public.ventas_ventas;
drop trigger if exists trg_exigir_plan on public.productos;
drop trigger if exists trg_exigir_plan on public.lotes;
drop trigger if exists trg_exigir_plan on public.movimientos;
drop function if exists public.exigir_plan_vigente();
drop function if exists public.plan_vigente(uuid);
drop function if exists public.registrar_push_token(text, uuid);
drop index if exists public.idx_vitems_comercio_id;
alter table public.movimientos alter column creado_en set default now();

CREATE OR REPLACE FUNCTION public.verificar_pin(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.verificar_empleado_venta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public._auth_verificar_hash(p_pass text, p_hash text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if p_hash is null or p_pass = '' then return null; end if;
  if p_hash like '$2%' then                             -- bcrypt
    if crypt(p_pass, p_hash) = p_hash then return p_hash; end if;
  elsif p_hash = encode(digest(p_pass, 'sha256'), 'hex') then  -- legado SHA-256
    return crypt(p_pass, gen_salt('bf'));               -- upgrade perezoso
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.configurar_pin(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.guardar_empleado_venta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.ajustar_stock(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    set cantidad = greatest(least(cantidad, 0), cantidad + v_delta),
        retirado = greatest(least(cantidad, 0), cantidad + v_delta) = 0
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
end $function$;

CREATE OR REPLACE FUNCTION public.anular_venta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id       uuid := (p->>'venta_id')::uuid;
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_usuario  text := nullif(p->>'usuario','');
  v_venta    record;
  v_item     record;
begin
  if v_id is null or v_comercio is null then
    raise exception 'datos incompletos';
  end if;
  if v_comercio not in (select comercios_del_usuario()) then
    raise exception 'comercio no autorizado';
  end if;

  select * into v_venta from ventas_ventas where id = v_id and comercio_id = v_comercio for update;
  if not found then
    raise exception 'venta no encontrada';
  end if;
  if v_venta.anulada then
    return jsonb_build_object('ok', true, 'duplicada', true, 'venta_id', v_id);
  end if;

  -- Re-stock: devolver al lote original cada item que salió de un lote.
  for v_item in
    select * from ventas_items where venta_id = v_id and lote_id is not null
  loop
    update lotes set cantidad = cantidad + v_item.cantidad, retirado = (cantidad + v_item.cantidad) = 0
      where id = v_item.lote_id and comercio_id = v_comercio;
    insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
      select gen_random_uuid(), v_comercio, v_item.lote_id, v_item.producto_id, v_venta.sucursal_id, 'ajuste',
             v_item.cantidad, l.cantidad - v_item.cantidad, l.cantidad, v_usuario,
             'Devolución venta '||left(v_id::text,8), now()
      from lotes l where l.id = v_item.lote_id;
  end loop;

  update ventas_ventas set anulada = true, anulada_en = now() where id = v_id;
  -- Cancelar la deuda de fiado asociada (si la había).
  update ventas_deudas set pagada = true where venta_id = v_id;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_fiado(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pago     uuid := coalesce((p->>'pago_id')::uuid, gen_random_uuid());
  v_deuda    uuid := (p->>'deuda_id')::uuid;
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_monto    numeric := coalesce((p->>'monto')::numeric, 0);
  v_usuario  text := nullif(p->>'usuario','');
  v_fecha    timestamptz := coalesce((p->>'fecha')::timestamptz, now());
  v_d        record;
  v_pagado   numeric;
begin
  if v_deuda is null or v_comercio is null or v_monto <= 0 then
    raise exception 'datos incompletos';
  end if;
  if v_comercio not in (select comercios_del_usuario()) then
    raise exception 'comercio no autorizado';
  end if;
  select * into v_d from ventas_deudas where id = v_deuda and comercio_id = v_comercio for update;
  if not found then
    raise exception 'deuda no encontrada';
  end if;

  insert into ventas_pagos (id, comercio_id, deuda_id, monto, usuario, fecha)
    values (v_pago, v_comercio, v_deuda, v_monto, v_usuario, v_fecha)
    on conflict (id) do nothing;

  select coalesce(sum(monto), 0) into v_pagado from ventas_pagos where deuda_id = v_deuda;
  if v_pagado >= v_d.monto then
    update ventas_deudas set pagada = true where id = v_deuda;
  end if;

  return jsonb_build_object('ok', true, 'pagado', v_pagado,
                            'saldo', greatest(0, v_d.monto - v_pagado),
                            'saldada', v_pagado >= v_d.monto);
end $function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin new.updated_at = now(); return new; end $function$;

commit;
