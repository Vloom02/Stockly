-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #2 (segura: solo agrega columnas/tablas/funciones).
--   #16 Devoluciones/anulaciones de venta  → anular_venta(p jsonb)
--   #17 Fiado con pagos parciales          → ventas_pagos + registrar_pago_fiado(p jsonb)
-- Correr en el MISMO proyecto Supabase. Idempotente (if not exists / or replace).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- #16 — DEVOLUCIONES / ANULACIONES
-- ─────────────────────────────────────────────────────────────────────────────
alter table ventas_ventas add column if not exists anulada    boolean not null default false;
alter table ventas_ventas add column if not exists anulada_en timestamptz;

-- Anula una venta de forma ATÓMICA: devuelve el stock a los lotes originales,
-- registra el movimiento de ajuste, marca la venta anulada y cancela el fiado.
-- Idempotente: si ya está anulada, no reprocesa.
create or replace function anular_venta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
    update lotes set cantidad = cantidad + v_item.cantidad, retirado = false
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
end $$;

revoke execute on function anular_venta(jsonb) from public, anon;
grant  execute on function anular_venta(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- #17 — FIADO CON PAGOS PARCIALES
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists ventas_pagos (
  id          uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id) on delete cascade,
  deuda_id    uuid not null references ventas_deudas(id) on delete cascade,
  monto       numeric(12,2) not null,
  usuario     text,
  fecha       timestamptz not null default now()
);
create index if not exists idx_vpagos_deuda    on ventas_pagos(deuda_id);
create index if not exists idx_vpagos_comercio on ventas_pagos(comercio_id);

alter table ventas_pagos enable row level security;
drop policy if exists "acceso pagos propios" on ventas_pagos;
create policy "acceso pagos propios" on ventas_pagos
  for all to authenticated
  using (comercio_id in (select comercios_del_usuario()))
  with check (
    comercio_id in (select comercios_del_usuario())
    and exists (select 1 from ventas_deudas d where d.id = ventas_pagos.deuda_id and d.comercio_id = ventas_pagos.comercio_id)
  );

-- Registra un pago parcial y, si cubre la deuda, la marca como saldada. Atómico.
-- IDEMPOTENTE por pago_id (opcional): si el cliente reintenta (outbox offline)
-- con el mismo id, no inserta dos veces el pago.
create or replace function registrar_pago_fiado(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
end $$;

revoke execute on function registrar_pago_fiado(jsonb) from public, anon;
grant  execute on function registrar_pago_fiado(jsonb) to authenticated;
