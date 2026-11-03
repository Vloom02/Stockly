-- Migración 17 · Ventas, fiado y stock (segunda auditoría 2026-11-02). Sin DROP, idempotente.
-- Volver atrás: supabase/volver-atras-migracion-17.sql (vuelve a las funciones de antes).
-- Va junto con la app 1.2.12: la 1.2.11 y anteriores siguen andando (los campos nuevos son opcionales).

-- A. Renglones vendidos sin stock: se marcan, para que anular devuelva las unidades a donde están hoy.
alter table public.ventas_items add column if not exists sin_stock boolean not null default false;

-- B. Cobros de fiado por fecha (arqueo y cierre del día filtran por comercio y fecha).
create index if not exists idx_vpagos_comercio_fecha on public.ventas_pagos (comercio_id, fecha);

-- C. ajustar_stock: el historial anota lo que de verdad cambió. Un retiro que no puede bajar de 0
--    anotaba el pedido (-10) aunque el lote pasara de 4 a 0.
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

-- D. registrar_venta:
--    · una venta con un id que ya existe en OTRO comercio no se da por "duplicada" (decía guardada sin guardarla);
--    · FEFO con desempate fijo (mismo vencimiento → siempre el mismo lote);
--    · lo vendido sin stock va a un lote vacío o en negativo, nunca a uno con stock dado de baja (lo revivía);
--      ese renglón queda marcado `sin_stock`;
--    · el costo es el del momento de la venta (lo manda la app; si no, el de la ficha);
--    · un fiado de $0 (todo con descuento) nace pagado.
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
        order by fecha_vencimiento asc nulls last, id
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
            values (v_comercio, v_pid, v_sucursal, 0, current_date, false)
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

-- E. anular_venta: lo vendido sin stock vuelve a donde están hoy esas unidades. Al cargar mercadería, el trigger
--    cubrir_faltante pasa unidades del lote nuevo al negativo; antes, al anular, volvían al lote viejo (vencido)
--    y saltaban avisos de vencido que no eran. Orden fijo (producto, lote): dos anulaciones a la vez no se traban.
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
  -- Cancelar la deuda de fiado asociada (si la había).
  update ventas_deudas set pagada = true where venta_id = v_id;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id);
end $function$;

-- F. registrar_pago_fiado: devuelve cuánto se cobró de verdad (la app avisa "devolvé $X" si otro equipo ya la
--    había cobrado), una deuda sin saldo queda cerrada, y la fecha no puede ser del futuro.
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

  insert into ventas_pagos (id, comercio_id, deuda_id, monto, usuario, fecha)
    values (v_pago, v_comercio, v_deuda, v_monto, v_usuario, v_fecha)
    on conflict (id) do nothing;

  select coalesce(sum(monto), 0) into v_pagado from ventas_pagos where deuda_id = v_deuda;
  if v_pagado >= v_d.monto then
    update ventas_deudas set pagada = true where id = v_deuda;
  end if;

  return jsonb_build_object('ok', true, 'cobrado', v_monto, 'pagado', v_pagado,
                            'saldo', greatest(0, v_d.monto - v_pagado),
                            'saldada', v_pagado >= v_d.monto);
end $function$;

-- G. configurar_pin: cambiar una clave que existe sin mandar la actual es un error (no un "ok: false" que la app
--    vieja, 1.2.10 o anterior, mostraba como "clave actualizada"). No cuenta como intento fallido.
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

-- H. Fotos de productos (Storage): lo que hoy está en producción, versionado. Si ya existe, no cambia nada.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('productos', 'productos', true, 512000, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'subir fotos productos (dueno)') then
    create policy "subir fotos productos (dueno)" on storage.objects for insert to authenticated
      with check (bucket_id = 'productos' and exists (select 1 from public.miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id::text = (storage.foldername(objects.name))[1] and m.rol = 'dueno'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'actualizar fotos productos (dueno)') then
    create policy "actualizar fotos productos (dueno)" on storage.objects for update to authenticated
      using (bucket_id = 'productos' and exists (select 1 from public.miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id::text = (storage.foldername(objects.name))[1] and m.rol = 'dueno'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'borrar fotos productos (dueno)') then
    create policy "borrar fotos productos (dueno)" on storage.objects for delete to authenticated
      using (bucket_id = 'productos' and exists (select 1 from public.miembros m
        where m.user_id = (select auth.uid()) and m.comercio_id::text = (storage.foldername(objects.name))[1] and m.rol = 'dueno'));
  end if;
end $$;
