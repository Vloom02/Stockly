-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 11 — Stock negativo (2026-10-26). Idempotente.
-- Pedido del dueño: si se vende algo que no estaba cargado, el stock tiene que quedar
-- en negativo (así se ve que se vendió sin cargar) y el próximo ingreso lo tiene que
-- descontar: -2 polentas + entran 6 = quedan 4.
--   A) registrar_venta: lo que falta se descuenta igual. Va a un lote del producto en esa
--      sucursal (el que ya esté en negativo, o el último cargado; si nunca se cargó, uno
--      nuevo con vencimiento hoy). Queda el movimiento "Venta sin stock" con quién vendió.
--      Antes esas unidades se perdían: la venta salía pero el stock quedaba en 0.
--   B) cubrir_faltante (trigger al cargar un lote): el ingreso tapa primero lo negativo.
--      Deja los movimientos de los dos lados para el historial.
--   C) ajustar_stock: un lote en negativo puede subir (contar mercadería) sin saltar a 0.
--   D) anular_venta: si la devolución deja un lote en 0, queda retirado (no un lote vacío).
-- ═══════════════════════════════════════════════════════════════════════════

-- A) registrar_venta
create or replace function public.registrar_venta(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id        uuid := (p->>'id')::uuid;
  v_comercio  uuid := (p->>'comercio_id')::uuid;
  v_sucursal  uuid := (p->>'sucursal_id')::uuid;
  v_fecha     timestamptz := coalesce((p->>'fecha')::timestamptz, now());
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

  for v_item in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb))
  loop
    declare
      v_pid       uuid := (v_item->>'producto_id')::uuid;
      v_precio    numeric := coalesce((v_item->>'precio')::numeric, 0);
      v_nombre    text := v_item->>'nombre';
      v_pedido    int := greatest(0, coalesce((v_item->>'cantidad')::int, 0));
      v_restante  int := greatest(0, coalesce((v_item->>'cantidad')::int, 0));
      v_descontar int;
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
      if not exists (select 1 from productos where id = v_pid and comercio_id = v_comercio) then
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
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal)
          values (gen_random_uuid(), v_comercio, v_id, v_pid, v_lote.id, v_nombre, v_descontar, v_precio, v_precio * v_descontar);
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
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal)
          values (gen_random_uuid(), v_comercio, v_id, v_pid, v_lote.id, v_nombre, v_restante, v_precio, v_precio * v_restante);
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

-- B) Al cargar mercadería, lo que entra cubre primero lo que estaba en negativo.
--    SECURITY DEFINER: así _proteger_cantidad_lote deja cambiar la cantidad (como en las RPC).
create or replace function public.cubrir_faltante()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_neg   record;
  v_cubre int;
  v_resto int := new.cantidad;
begin
  if new.cantidad <= 0 then return null; end if;
  for v_neg in
    select id, cantidad from lotes
    where comercio_id = new.comercio_id and producto_id = new.producto_id and sucursal_id = new.sucursal_id
      and cantidad < 0 and id <> new.id
    order by creado_en
    for update
  loop
    exit when v_resto <= 0;
    v_cubre := least(-v_neg.cantidad, v_resto);
    update lotes set cantidad = cantidad + v_cubre, retirado = (cantidad + v_cubre) = 0 where id = v_neg.id;
    insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
      values (gen_random_uuid(), new.comercio_id, v_neg.id, new.producto_id, new.sucursal_id, 'ajuste',
              v_cubre, v_neg.cantidad, v_neg.cantidad + v_cubre, 'Automático',
              'Se cubrieron '||v_cubre||' vendidas sin stock con lo que entró', now());
    v_resto := v_resto - v_cubre;
  end loop;
  if v_resto < new.cantidad then
    update lotes set cantidad = v_resto, retirado = v_resto = 0 where id = new.id;
    insert into movimientos (id, comercio_id, lote_id, producto_id, sucursal_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, usuario, notas, fecha)
      values (gen_random_uuid(), new.comercio_id, new.id, new.producto_id, new.sucursal_id, 'ajuste',
              v_resto - new.cantidad, new.cantidad, v_resto, 'Automático',
              'Descuenta '||(new.cantidad - v_resto)||' que se habían vendido sin stock', now());
  end if;
  return null;
end $function$;

revoke execute on function public.cubrir_faltante() from public, anon, authenticated;
drop trigger if exists cubrir_faltante on lotes;
create trigger cubrir_faltante after insert on lotes for each row execute function public.cubrir_faltante();

-- C) ajustar_stock: nunca deja un lote más abajo de donde estaba (ni de 0 si era positivo),
--    pero uno en negativo puede subir de a poco (-2 + 1 = -1, antes saltaba a 0).
create or replace function public.ajustar_stock(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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

-- D) anular_venta: igual que antes, pero un lote que vuelve a 0 queda retirado.
create or replace function public.anular_venta(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
