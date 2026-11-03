-- Migración 18 · Anular una venta fiada que ya tenía pagos: lo cobrado vuelve como salida de caja. Sin DROP, idempotente.
-- Regla pedida por el dueño (2026-11-03). Volver atrás: supabase/volver-atras-migracion-18.sql (anular_venta de la 17).
-- La app 1.2.13 muestra cuánto devolver ('devuelto'); las anteriores anulan igual y la salida queda anotada.

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
  -- Si era fiado y ya había pagado algo, esa plata se le devuelve: queda como salida de caja (si no, el arqueo
  -- esperaba en la caja una plata que ya no está). Una sola vez: una venta anulada no vuelve a pasar por acá.
  select coalesce(sum(vp.monto), 0) into v_devolver
    from ventas_pagos vp join ventas_deudas d on d.id = vp.deuda_id
    where d.venta_id = v_id and d.comercio_id = v_comercio;
  if v_devolver > 0 then
    insert into ventas_caja_mov (id, comercio_id, sucursal_id, cajero_nombre, turno_desde, tipo, monto, motivo, fecha)
      values (gen_random_uuid(), v_comercio, v_venta.sucursal_id, v_usuario, nullif(p->>'turno_desde', '')::timestamptz,
              'egreso', v_devolver, 'Devolución de lo pagado del fiado (venta anulada ' || left(v_id::text, 8) || ')', now());
  end if;
  -- Cancelar la deuda de fiado asociada (si la había).
  update ventas_deudas set pagada = true where venta_id = v_id;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id, 'devuelto', v_devolver);
end $function$;
