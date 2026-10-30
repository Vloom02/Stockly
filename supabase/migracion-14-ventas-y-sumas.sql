-- Migración 14 · Ventas más firmes y sumas en el servidor (revisión 2026-10-29). Sin DROP, idempotente.
-- Volver atrás: supabase/volver-atras-migracion-14.sql (tiene DROP → SQL Editor).

-- A. registrar_venta: lotes trabados siempre en el mismo orden y sin fechas futuras.
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

  -- ON CONFLICT DO NOTHING: si otro reintento ya la insertó, no hay error.
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
      v_total := v_total + v_precio * v_pedido;

      for v_lote in
        select id, cantidad from lotes
        where comercio_id = v_comercio and producto_id = v_pid and sucursal_id = v_sucursal
          and retirado = false and cantidad > 0
        order by fecha_vencimiento asc nulls last
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

      -- Sin stock suficiente: el resto se descuenta igual y ese lote queda en negativo.
      if v_restante > 0 then
        select id, cantidad into v_lote from lotes
          where comercio_id = v_comercio and producto_id = v_pid and sucursal_id = v_sucursal
          order by (cantidad < 0) desc, creado_en desc
          limit 1
          for update;
        if not found then  -- nunca se cargó en esta sucursal
          insert into lotes (comercio_id, producto_id, sucursal_id, cantidad, fecha_vencimiento, retirado)
            values (v_comercio, v_pid, v_sucursal, 0, current_date, false)
            returning id, cantidad into v_lote;
        end if;
        update lotes set cantidad = cantidad - v_restante, retirado = false where id = v_lote.id;
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal, costo_unit)
          values (gen_random_uuid(), v_comercio, v_id, v_pid, v_lote.id, v_nombre, v_restante, v_precio, v_precio * v_restante, v_costo);
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
      values (gen_random_uuid(), v_comercio, v_id, p->>'cliente', v_total - v_desc, false, v_fecha);
  end if;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id,
                            'total', v_total - v_desc, 'faltantes', v_faltantes);
end $function$;

-- B. ajustar_stock: el "antes" del historial lo calcula el servidor y la fecha no puede ser futura.
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
          coalesce(p->>'tipo','ajuste'), v_delta,
          coalesce(v_ant, 0), v_nueva,
          nullif(p->>'usuario',''), nullif(p->>'notas',''),
          least(coalesce((p->>'fecha')::timestamptz, now()), now()));

  return jsonb_build_object('ok', true, 'duplicado', false, 'cantidad', v_nueva);
end $function$;

-- C. Unidades vendidas por producto, sumadas en el servidor (más vendidos de Vender y pedido sugerido).
--    Con los permisos de quien llama (RLS): cada uno ve solo lo de su comercio.
create or replace function public.vendido_por_producto(p_comercio uuid, p_sucursal uuid default null, p_dias int default 30, p_limite int default null)
 returns table (producto_id uuid, unidades numeric)
 language sql
 stable
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
  select i.producto_id, sum(i.cantidad)::numeric
  from ventas_items i
  join ventas_ventas v on v.id = i.venta_id
  where i.comercio_id = p_comercio and v.comercio_id = p_comercio and not v.anulada
    and v.fecha >= now() - make_interval(days => greatest(p_dias, 1))
    and (p_sucursal is null or v.sucursal_id = p_sucursal)
    and i.producto_id is not null
  group by i.producto_id
  order by 2 desc
  limit p_limite
$function$;
revoke all on function public.vendido_por_producto(uuid, uuid, int, int) from public, anon;
grant execute on function public.vendido_por_producto(uuid, uuid, int, int) to authenticated;
