-- Migración 16 · Seguridad, auditoría 2026-11-01 (sesión de la tablet = sesión del dueño). Sin DROP, idempotente.
-- Volver atrás: supabase/volver-atras-migracion-16.sql (tiene DROP → SQL Editor).

-- A. ventas_config: nadie la lee ni la escribe directo (la app solo usa RPC). Con la sesión de la tablet se
--    podía leer el hash de la clave del dueño y romperlo fuera de línea, sin el bloqueo por intentos.
revoke select, insert, update, delete on public.ventas_config from authenticated, anon;

-- B. configurar_pin: cambiar una clave existente pide la actual.
CREATE OR REPLACE FUNCTION public.configurar_pin(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_pin text := coalesce(p->>'pin','');
  v_actual text := coalesce(p->>'pin_actual','');
  v_hash text;
begin
  if v_comercio is null or length(v_pin) < 4 then
    raise exception 'PIN inválido (mínimo 4 dígitos)';
  end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio and m.rol = 'dueno') then
    raise exception 'solo el dueño puede configurar el PIN';
  end if;
  -- Cambiar una clave que ya existe pide la actual: con solo la sesión de la tablet se podía
  -- poner una clave nueva y quedarse con el modo dueño. Mismo bloqueo por intentos que verificar_pin.
  perform pg_advisory_xact_lock(hashtextextended(v_comercio::text || ':pin', 0));
  select pin_hash into v_hash from ventas_config where comercio_id = v_comercio;
  if v_hash is not null then
    if _auth_bloqueado(v_comercio, 'pin') then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
    if _auth_verificar_hash(v_actual, v_hash) is null then
      perform _auth_fallo(v_comercio, 'pin');  -- sin raise: así el fallo queda anotado
      return jsonb_build_object('ok', false, 'motivo', 'clave_actual');
    end if;
  end if;
  insert into ventas_config (comercio_id, pin_hash, updated_at)
    values (v_comercio, crypt(v_pin, gen_salt('bf', 10)), now())
  on conflict (comercio_id) do update
    set pin_hash = excluded.pin_hash, updated_at = now();
  perform _auth_exito(v_comercio, 'pin');  -- PIN nuevo: resetear lockout
  return jsonb_build_object('ok', true);
end $function$;

-- C. verificar_empleado_venta: no revela qué legajos existen y no llena auth_intentos con legajos inventados.
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
  -- Legajos largos no anotan fallos (cada legajo inventado era una fila nueva en auth_intentos).
  if v_comercio is null or v_legajo = '' or v_pass = '' or length(v_legajo) > 20 then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_comercio::text || ':legajo:' || v_legajo, 0));
  if _auth_bloqueado(v_comercio, 'legajo:' || v_legajo) then return jsonb_build_object('ok', false); end if;

  select * into v_emp from ventas_empleados
    where comercio_id = v_comercio and legajo = v_legajo and activo = true;
  -- Sin el legajo igual se calcula un bcrypt: si no, la respuesta rápida decía qué legajos existen.
  if not found then perform crypt(v_pass, gen_salt('bf', 10)); end if;
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

-- D. Historial: un movimiento propio no puede apuntar al lote, producto o local de otro comercio.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'movimientos' and policyname = 'movimientos: mismo comercio (crear)') then
    create policy "movimientos: mismo comercio (crear)" on public.movimientos as restrictive for insert to authenticated with check (
      (lote_id is null or exists (select 1 from lotes l where l.id = lote_id and l.comercio_id = movimientos.comercio_id)) and
      (producto_id is null or exists (select 1 from productos p where p.id = producto_id and p.comercio_id = movimientos.comercio_id)) and
      (sucursal_id is null or exists (select 1 from sucursales s where s.id = sucursal_id and s.comercio_id = movimientos.comercio_id)));
  end if;
end $$;

-- E. comercios_del_usuario: solo para sesiones (todas las políticas la usan; primero el grant).
grant execute on function public.comercios_del_usuario() to authenticated;
revoke execute on function public.comercios_del_usuario() from public, anon;

-- F. Invitaciones: la app ya no invita (migración 10); que no se puedan crear a mano.
revoke insert on public.invitaciones from authenticated;
