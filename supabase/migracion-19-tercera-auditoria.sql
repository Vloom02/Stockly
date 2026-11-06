-- Migración 19 · Tercera auditoría (2026-11): lo vencido se vende al final, locales con ventas no se borran, topes contra
-- abusos de cuentas nuevas, bloqueo de claves que no se reinicia solo, salida de caja al anular en efectivo, cobros de
-- fiado en el local donde entró la plata. Sin DROP, idempotente. Va después de la 18.
-- Volver atrás: supabase/volver-atras-migracion-19.sql (las funciones como estaban con la 18).
-- Los permisos y la columna nueva no molestan a las apps 1.2.12 y anteriores.

-- A. Borrar un local borraba en cascada todas sus ventas, aunque sean inmutables por API. La app nunca borra locales:
--    los desactiva. Nadie los borra por API, y uno con ventas no se borra de ninguna forma (salvo al borrar el comercio).
revoke delete on public.sucursales from authenticated, anon;

create or replace function public._proteger_sucursal_con_ventas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from comercios where id = old.comercio_id)
     and exists (select 1 from ventas_ventas where sucursal_id = old.id) then
    raise exception 'un local con ventas no se puede borrar: desactivalo';
  end if;
  return old;
end $$;
revoke execute on function public._proteger_sucursal_con_ventas() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'proteger_sucursal_con_ventas') then
    create trigger proteger_sucursal_con_ventas before delete on public.sucursales
      for each row execute function public._proteger_sucursal_con_ventas();
  end if;
end $$;

-- B. Celulares para avisos: solo por registrar_push_token, que pone un tope por comercio.
revoke insert, update on public.push_tokens from authenticated, anon;

-- C. Cobros de fiado: el local donde entró la plata (no el de la venta). Lo cobrado hasta hoy queda en el de la venta.
alter table public.ventas_pagos add column if not exists sucursal_id uuid references public.sucursales(id) on delete set null;
update public.ventas_pagos vp set sucursal_id = v.sucursal_id
  from public.ventas_deudas d join public.ventas_ventas v on v.id = d.venta_id
  where vp.deuda_id = d.id and vp.sucursal_id is null;
create index if not exists idx_vpagos_sucursal_fecha on public.ventas_pagos (sucursal_id, fecha);

-- D. Cupo de claves por comercio: cada comprobación de clave cuesta unos 50 ms de procesador y con una cuenta gratis se
--    podía saturar la base para todos. 30 por minuto sobran para un negocio. De paso limpia lo viejo (nunca los fallos
--    de la clave del dueño: la cuenta de intentos solo se limpia con un acierto).
create or replace function public._cupo_bcrypt(p_comercio uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usos int;
begin
  delete from auth_intentos where comercio_id = p_comercio and actualizado_en < now() - interval '1 day'
    and (clave like 'cupo:%' or (clave like 'legajo:%' and coalesce(bloqueado_hasta, now()) <= now()));
  insert into auth_intentos (comercio_id, clave, fallos, actualizado_en)
    values (p_comercio, 'cupo:' || to_char(now(), 'YYYYMMDDHH24MI'), 1, now())
  on conflict (comercio_id, clave) do update set fallos = auth_intentos.fallos + 1, actualizado_en = now()
  returning fallos into v_usos;
  return v_usos <= 30;
end $$;
revoke execute on function public._cupo_bcrypt(uuid) from public, anon, authenticated;

-- E. Lo más vendido y ventas por hora, sumado acá: la app bajaba todas las ventas y renglones del mes.
create or replace function public.estadisticas_ventas(p_comercio uuid, p_dias int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 366));
begin
  if p_comercio not in (select comercios_del_usuario()) then raise exception 'comercio no autorizado'; end if;
  return jsonb_build_object(
    'ventas', (select count(*) from ventas_ventas where comercio_id = p_comercio and not anulada and fecha >= v_desde),
    'plata', (select coalesce(sum(total), 0) from ventas_ventas where comercio_id = p_comercio and not anulada and fecha >= v_desde),
    'por_hora', (select jsonb_agg(h.n order by h.hora) from (
        select g as hora, count(v.id) as n
        from generate_series(0, 23) g
        left join ventas_ventas v on v.comercio_id = p_comercio and not v.anulada and v.fecha >= v_desde
          and extract(hour from v.fecha at time zone 'America/Argentina/Buenos_Aires') = g
        group by g) h),
    'top', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select i.nombre_producto as nombre, sum(i.cantidad) as cantidad, sum(i.subtotal) as plata
        from ventas_items i join ventas_ventas v on v.id = i.venta_id
        where v.comercio_id = p_comercio and not v.anulada and v.fecha >= v_desde
        group by i.nombre_producto order by 2 desc limit 10) t));
end $$;
revoke execute on function public.estadisticas_ventas(uuid, int) from public, anon;
grant execute on function public.estadisticas_ventas(uuid, int) to authenticated;

CREATE OR REPLACE FUNCTION public._auth_fallo(p_comercio uuid, p_clave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_fallos int;
  v_lock   timestamptz;
begin
  select fallos, bloqueado_hasta into v_fallos, v_lock
    from auth_intentos where comercio_id = p_comercio and clave = p_clave;
  if not found then v_fallos := 0; end if;
  v_fallos := v_fallos + 1;
  insert into auth_intentos (comercio_id, clave, fallos, bloqueado_hasta, actualizado_en)
    values (p_comercio, p_clave, v_fallos,
            -- Cada 5 fallos, una espera que se duplica hasta 24 h; solo un acierto limpia la cuenta. Antes, al vencer el
            -- bloqueo arrancaba de cero: 480 intentos por día y un PIN de 4 números caía en unos 10 días.
            case when v_fallos % 5 = 0
              then now() + least(interval '15 minutes' * power(2, least(v_fallos / 5 - 1, 7)), interval '24 hours') end, now())
  on conflict (comercio_id, clave) do update set
    fallos = excluded.fallos,
    bloqueado_hasta = excluded.bloqueado_hasta,
    actualizado_en = now();
end $function$;

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
  -- Un intento a la vez por comercio: en paralelo, _auth_fallo perdía fallos y el bloqueo no llegaba.
  perform pg_advisory_xact_lock(hashtextextended(v_comercio::text || ':pin', 0));
  if _auth_bloqueado(v_comercio, 'pin') or not _cupo_bcrypt(v_comercio) then return false; end if;

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
  -- Legajos largos no anotan fallos (cada legajo inventado era una fila nueva en auth_intentos).
  if v_comercio is null or v_legajo = '' or v_pass = '' or length(v_legajo) > 20 then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_comercio::text || ':legajo:' || v_legajo, 0));
  if _auth_bloqueado(v_comercio, 'legajo:' || v_legajo) or not _cupo_bcrypt(v_comercio) then return jsonb_build_object('ok', false); end if;

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
  perform pg_advisory_xact_lock(hashtextextended(v_comercio::text || ':pin', 0));
  if not _cupo_bcrypt(v_comercio) then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
  select pin_hash into v_hash from ventas_config where comercio_id = v_comercio;
  if v_hash is not null then
    if v_actual = '' then
      raise exception 'falta la clave actual: actualizá la app para cambiar la clave';
    end if;
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
  if not _cupo_bcrypt(v_comercio) then raise exception 'demasiados intentos: probá en un minuto'; end if;

  if v_id is null then
    if v_pass = '' then raise exception 'falta la contraseña'; end if;
    insert into ventas_empleados (comercio_id, legajo, nombre, pass_hash)
      values (v_comercio, v_legajo, v_nombre, crypt(v_pass, gen_salt('bf', 10)))
      returning id into v_id;
  else
    update ventas_empleados
      set legajo = v_legajo, nombre = v_nombre,
          pass_hash = case when v_pass = '' then pass_hash else crypt(v_pass, gen_salt('bf', 10)) end,
          activo = coalesce((p->>'activo')::boolean, activo)
      where id = v_id and comercio_id = v_comercio;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.registrar_push_token(p_token text, p_comercio uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce(p_token, '') = '' or p_comercio is null then raise exception 'datos incompletos'; end if;
  if p_comercio not in (select comercios_del_usuario()) then raise exception 'comercio no autorizado'; end if;
  -- Tope por comercio: con miles de tokens falsos, una cuenta nueva dejaba a todos sin avisos de vencimiento.
  if not exists (select 1 from push_tokens where token = p_token)
     and (select count(*) from push_tokens where comercio_id = p_comercio) >= 20 then
    raise exception 'demasiados dispositivos';
  end if;
  insert into push_tokens (token, comercio_id, user_id, plataforma, updated_at)
    values (p_token, p_comercio, auth.uid(), 'android', now())
  on conflict (token) do update
    set comercio_id = excluded.comercio_id, user_id = excluded.user_id, updated_at = now()
    -- Solo si el token ya es de este usuario o de uno de sus comercios: con el token de otro se le quitaban los avisos.
    where push_tokens.user_id = auth.uid() or push_tokens.comercio_id in (select comercios_del_usuario());
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
  v_ant   int;
  v_pid_real uuid;
  v_suc_real uuid;
begin
  if v_mov is null or v_com is null or v_lote is null then
    raise exception 'datos de ajuste incompletos';
  end if;
  if v_com not in (select comercios_del_usuario()) then
    raise exception 'comercio no autorizado';
  end if;
  -- Dos reintentos del mismo ajuste a la vez: el segundo espera y ve que ya está.
  perform pg_advisory_xact_lock(hashtextextended(v_mov::text, 0));
  if exists (select 1 from movimientos where id = v_mov and comercio_id <> v_com) then raise exception 'movimiento inválido'; end if;
  if exists (select 1 from movimientos where id = v_mov) then
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;

  -- El "antes" del historial lo pone el servidor: el del equipo podía estar viejo.
  select cantidad into v_ant from lotes where id = v_lote and comercio_id = v_com for update;

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
          coalesce(p->>'tipo','ajuste'), v_nueva - coalesce(v_ant, 0),
          coalesce(v_ant, 0), v_nueva,
          nullif(p->>'usuario',''), nullif(p->>'notas',''),
          least(coalesce((p->>'fecha')::timestamptz, now()), now()));

  return jsonb_build_object('ok', true, 'duplicado', false, 'cantidad', v_nueva);
end $function$;

CREATE OR REPLACE FUNCTION public.registrar_venta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id        uuid := (p->>'id')::uuid;
  v_comercio  uuid := (p->>'comercio_id')::uuid;
  v_sucursal  uuid := (p->>'sucursal_id')::uuid;
  -- Una tablet con la hora adelantada no mete ventas en otro día (atrasada sí vale: venta sin internet).
  v_fecha     timestamptz := least(coalesce((p->>'fecha')::timestamptz, now()), now());
  v_usuario   text := nullif(p->>'usuario','');
  v_desc      numeric := coalesce((p->>'descuento')::numeric, 0);
  v_item      jsonb;
  v_lote      record;
  v_total     numeric := 0;
  v_faltantes jsonb := '[]'::jsonb;
  v_dueno_id  uuid;
  v_hoy       date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if v_id is null or v_comercio is null or v_sucursal is null then
    raise exception 'datos de venta incompletos';
  end if;
  if v_comercio not in (select comercios_del_usuario()) then
    raise exception 'comercio no autorizado';
  end if;
  if not exists (select 1 from sucursales where id = v_sucursal and comercio_id = v_comercio) then
    raise exception 'sucursal no pertenece al comercio';
  end if;
  if v_desc < 0 then
    raise exception 'descuento inválido';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) i
             where coalesce((i->>'precio')::numeric, 0) < 0) then
    raise exception 'precio inválido';
  end if;

  -- Reintento de la misma venta: no se vuelve a vender. Si el id es de otro comercio, es un error.
  select comercio_id into v_dueno_id from ventas_ventas where id = v_id;
  if found then
    if v_dueno_id <> v_comercio then raise exception 'venta inválida'; end if;
    return jsonb_build_object('ok', true, 'duplicada', true, 'venta_id', v_id);
  end if;

  -- ON CONFLICT DO NOTHING: si otro reintento la insertó recién (a la vez), no hay error.
  insert into ventas_ventas (id, comercio_id, sucursal_id, total, descuento, metodo_pago, cliente, fiado, usuario, fecha)
  values (v_id, v_comercio, v_sucursal, 0, v_desc,
          coalesce(p->>'metodo_pago','efectivo'), nullif(p->>'cliente',''),
          coalesce((p->>'fiado')::boolean, false), v_usuario, v_fecha)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'duplicada', true, 'venta_id', v_id);
  end if;

  -- Siempre en el mismo orden (por producto): dos equipos vendiendo A,B y B,A se esperaban uno al otro.
  for v_item in select value from jsonb_array_elements(coalesce(p->'items','[]'::jsonb))
                order by value->>'producto_id' nulls first
  loop
    declare
      v_pid       uuid := (v_item->>'producto_id')::uuid;
      v_precio    numeric := coalesce((v_item->>'precio')::numeric, 0);
      v_nombre    text := v_item->>'nombre';
      v_pedido    int := greatest(0, coalesce((v_item->>'cantidad')::int, 0));
      v_restante  int := greatest(0, coalesce((v_item->>'cantidad')::int, 0));
      v_descontar int;
      v_costo     numeric;
    begin
      -- Venta rápida / monto libre: item sin producto → línea sin stock.
      if v_pid is null then
        v_total := v_total + v_precio * v_pedido;
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal)
          values (gen_random_uuid(), v_comercio, v_id, null, null,
                  coalesce(nullif(v_nombre,''), 'Venta rápida'), v_pedido, v_precio, v_precio * v_pedido);
        continue;
      end if;

      -- Con producto: debe ser del comercio (evita oráculo cross-tenant).
      select costo into v_costo from productos where id = v_pid and comercio_id = v_comercio;
      if not found then
        raise exception 'producto del item no pertenece al comercio';
      end if;
      -- El costo de cuando se vendió: una venta sin internet que sube días después tomaba el costo nuevo.
      if (v_item->>'costo') is not null and (v_item->>'costo')::numeric >= 0 then
        v_costo := (v_item->>'costo')::numeric;
      end if;
      v_total := v_total + v_precio * v_pedido;

      for v_lote in
        select id, cantidad from lotes
        where comercio_id = v_comercio and producto_id = v_pid and sucursal_id = v_sucursal
          and retirado = false and cantidad > 0
        order by (fecha_vencimiento < v_hoy) nulls last, fecha_vencimiento asc nulls last, id
        for update
      loop
        exit when v_restante <= 0;
        v_descontar := least(v_restante, v_lote.cantidad);
        update lotes set cantidad = cantidad - v_descontar,
                         retirado = (cantidad - v_descontar) <= 0
          where id = v_lote.id;
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal, costo_unit)
          values (gen_random_uuid(), v_comercio, v_id, v_pid, v_lote.id, v_nombre, v_descontar, v_precio, v_precio * v_descontar, v_costo);
        insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
          values (gen_random_uuid(), v_comercio, v_lote.id, v_pid, v_sucursal, 'retiro_venta',
                  v_descontar, v_lote.cantidad, v_lote.cantidad - v_descontar, v_usuario, 'Venta '||left(v_id::text,8), v_fecha);
        v_restante := v_restante - v_descontar;
      end loop;

      -- Sin stock suficiente: el resto se descuenta igual y ese lote queda en negativo. Solo un lote vacío o ya
      -- en negativo: uno con stock dado de baja (retirado) volvía a aparecer.
      if v_restante > 0 then
        select id, cantidad into v_lote from lotes
          where comercio_id = v_comercio and producto_id = v_pid and sucursal_id = v_sucursal
            and cantidad <= 0
          order by (cantidad < 0) desc, creado_en desc, id
          limit 1
          for update;
        if not found then  -- nunca se cargó en esta sucursal (o todo lo que hay está dado de baja)
          insert into lotes (comercio_id, producto_id, sucursal_id, cantidad, fecha_vencimiento, retirado)
            values (v_comercio, v_pid, v_sucursal, 0, v_hoy, false)
            returning id, cantidad into v_lote;
        end if;
        update lotes set cantidad = cantidad - v_restante, retirado = false where id = v_lote.id;
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal, costo_unit, sin_stock)
          values (gen_random_uuid(), v_comercio, v_id, v_pid, v_lote.id, v_nombre, v_restante, v_precio, v_precio * v_restante, v_costo, true);
        insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
          values (gen_random_uuid(), v_comercio, v_lote.id, v_pid, v_sucursal, 'retiro_venta',
                  v_restante, v_lote.cantidad, v_lote.cantidad - v_restante, v_usuario,
                  'Venta sin stock '||left(v_id::text,8), v_fecha);
        v_faltantes := v_faltantes || jsonb_build_object('producto_id', v_pid, 'nombre', v_nombre, 'faltante', v_restante);
      end if;
    end;
  end loop;

  v_desc := least(v_desc, v_total);  -- el descuento no supera el subtotal
  update ventas_ventas set total = v_total - v_desc, descuento = v_desc where id = v_id;

  if coalesce((p->>'fiado')::boolean, false) and nullif(p->>'cliente','') is not null then
    insert into ventas_deudas (id, comercio_id, venta_id, cliente, monto, pagada, fecha)
      values (gen_random_uuid(), v_comercio, v_id, p->>'cliente', v_total - v_desc, (v_total - v_desc) <= 0, v_fecha);
  end if;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id,
                            'total', v_total - v_desc, 'faltantes', v_faltantes);
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
  v_fecha    timestamptz := least(coalesce((p->>'fecha')::timestamptz, now()), now());
  v_d        record;
  v_pagado   numeric;
  v_saldo    numeric;
  v_antes    numeric;
  v_caja     uuid := nullif(p->>'sucursal_id', '')::uuid;
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

  if exists (select 1 from ventas_pagos where id = v_pago and comercio_id <> v_comercio) then raise exception 'pago inválido'; end if;
  -- Reintento del mismo pago: no se vuelve a cobrar.
  select monto into v_antes from ventas_pagos where id = v_pago;
  if found then
    select coalesce(sum(monto), 0) into v_pagado from ventas_pagos where deuda_id = v_deuda;
    return jsonb_build_object('ok', true, 'duplicado', true, 'cobrado', v_antes, 'pagado', v_pagado,
                              'saldo', greatest(0, v_d.monto - v_pagado), 'saldada', v_pagado >= v_d.monto);
  end if;
  -- Nunca más que el saldo (un cobro hecho sin internet en otro equipo ya la pudo saldar).
  select coalesce(sum(monto), 0) into v_pagado from ventas_pagos where deuda_id = v_deuda;
  v_saldo := greatest(0, v_d.monto - v_pagado);
  if v_d.pagada or v_saldo <= 0 then
    if not v_d.pagada then update ventas_deudas set pagada = true where id = v_deuda; end if;
    return jsonb_build_object('ok', true, 'sin_saldo', true, 'cobrado', 0, 'pagado', v_pagado, 'saldo', 0, 'saldada', true);
  end if;
  v_monto := least(v_monto, v_saldo);

  -- El local donde entró la plata (el que manda la app); si no viene o no es del comercio, el de la venta.
  if v_caja is null or not exists (select 1 from sucursales where id = v_caja and comercio_id = v_comercio) then
    select sucursal_id into v_caja from ventas_ventas where id = v_d.venta_id;
  end if;
  insert into ventas_pagos (id, comercio_id, deuda_id, monto, usuario, fecha, sucursal_id)
    values (v_pago, v_comercio, v_deuda, v_monto, v_usuario, v_fecha, v_caja)
    on conflict (id) do nothing;

  select coalesce(sum(monto), 0) into v_pagado from ventas_pagos where deuda_id = v_deuda;
  if v_pagado >= v_d.monto then
    update ventas_deudas set pagada = true where id = v_deuda;
  end if;

  return jsonb_build_object('ok', true, 'cobrado', v_monto, 'pagado', v_pagado,
                            'saldo', greatest(0, v_d.monto - v_pagado),
                            'saldada', v_pagado >= v_d.monto);
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
  v_lote     uuid;
  v_ant      int;
  v_al_mismo int;
  v_resto    int;
  v_devolver numeric;
  v_fecha    timestamptz := least(coalesce((p->>'fecha')::timestamptz, now()), now());
  v_caja     uuid := nullif(p->>'sucursal_id', '')::uuid;
begin
  if v_id is null or v_comercio is null then
    raise exception 'datos incompletos';
  end if;
  if v_comercio not in (select comercios_del_usuario()) then
    raise exception 'comercio no autorizado';
  end if;
  if not exists (select 1 from miembros m where m.user_id = auth.uid() and m.comercio_id = v_comercio and m.rol = 'dueno') then
    raise exception 'no autorizado: solo el dueño anula ventas';
  end if;

  select * into v_venta from ventas_ventas where id = v_id and comercio_id = v_comercio for update;
  if not found then
    raise exception 'venta no encontrada';
  end if;
  if v_venta.anulada then
    return jsonb_build_object('ok', true, 'duplicada', true, 'venta_id', v_id);
  end if;

  for v_item in
    select * from ventas_items where venta_id = v_id and lote_id is not null
    order by producto_id, lote_id
  loop
    v_al_mismo := v_item.cantidad;
    v_resto := 0;
    if v_item.sin_stock then
      -- Al lote del renglón, solo lo que todavía falta ahí; el resto, al lote con stock más nuevo del producto.
      select cantidad into v_ant from lotes where id = v_item.lote_id and comercio_id = v_comercio for update;
      v_al_mismo := least(v_item.cantidad, greatest(0, -coalesce(v_ant, 0)));
      v_resto := v_item.cantidad - v_al_mismo;
    end if;

    if v_al_mismo > 0 then
      update lotes set cantidad = cantidad + v_al_mismo, retirado = (cantidad + v_al_mismo) = 0
        where id = v_item.lote_id and comercio_id = v_comercio
        returning cantidad into v_ant;
      if found then  -- el lote pudo haberse borrado: entonces no hay a dónde devolver
      insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
        values (gen_random_uuid(), v_comercio, v_item.lote_id, v_item.producto_id, v_venta.sucursal_id, 'ajuste',
                v_al_mismo, v_ant - v_al_mismo, v_ant, v_usuario, 'Devolución venta '||left(v_id::text,8), now());
      end if;
    end if;

    if v_resto > 0 then
      select id into v_lote from lotes
        where comercio_id = v_comercio and producto_id = v_item.producto_id and sucursal_id = v_venta.sucursal_id
          and retirado = false and cantidad > 0
        order by creado_en desc, id
        limit 1
        for update;
      if not found then v_lote := v_item.lote_id; end if;  -- no hay otro: al mismo, como antes
      update lotes set cantidad = cantidad + v_resto, retirado = (cantidad + v_resto) = 0
        where id = v_lote and comercio_id = v_comercio
        returning cantidad into v_ant;
      if found then
      insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
        values (gen_random_uuid(), v_comercio, v_lote, v_item.producto_id, v_venta.sucursal_id, 'ajuste',
                v_resto, v_ant - v_resto, v_ant, v_usuario, 'Devolución venta '||left(v_id::text,8), now());
      end if;
    end if;
  end loop;

  update ventas_ventas set anulada = true, anulada_en = now() where id = v_id;
  -- La plata que se le devuelve al cliente queda como salida de caja, en el día y el local de la devolución (si no, el
  -- arqueo esperaba en la caja una plata que ya no está). Fiado: lo que ya había pagado. Efectivo: la venta entera (el
  -- arqueo la sigue contando en su turno, así un turno ya cerrado no cambia). Tarjeta o transferencia no salen del cajón.
  -- La deuda se bloquea: un cobro simultáneo en otro equipo quedaba afuera de lo devuelto. Una sola vez: una venta anulada
  -- no vuelve a pasar por acá.
  perform 1 from ventas_deudas where venta_id = v_id and comercio_id = v_comercio for update;
  select coalesce(sum(vp.monto), 0) into v_devolver
    from ventas_pagos vp join ventas_deudas d on d.id = vp.deuda_id
    where d.venta_id = v_id and d.comercio_id = v_comercio;
  if not coalesce(v_venta.fiado, false) and v_venta.metodo_pago = 'efectivo' then v_devolver := v_venta.total; end if;
  if v_devolver > 0 then
    if v_caja is null or not exists (select 1 from sucursales where id = v_caja and comercio_id = v_comercio) then
      v_caja := v_venta.sucursal_id;
    end if;
    insert into ventas_caja_mov (id, comercio_id, sucursal_id, cajero_nombre, turno_desde, tipo, monto, motivo, fecha)
      values (gen_random_uuid(), v_comercio, v_caja, v_usuario, nullif(p->>'turno_desde', '')::timestamptz,
              'egreso', v_devolver, 'Devolución de venta anulada ' || left(v_id::text, 8), v_fecha);
  end if;
  -- Cancelar la deuda de fiado asociada (si la había).
  update ventas_deudas set pagada = true where venta_id = v_id;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id, 'devuelto', v_devolver);
end $function$;
