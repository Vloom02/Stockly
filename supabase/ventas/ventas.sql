-- ═══════════════════════════════════════════════════════════════════════════
-- APP DE VENTAS — Tablas nuevas (correr en el MISMO proyecto Supabase de Stockly)
-- NO recrea comercios/miembros/sucursales/productos/lotes/movimientos (ya existen)
-- NO recrea comercios_del_usuario() (ya existe — solo se usa en las policies)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── VENTAS (cabecera) ────────────────────────────────────────────────────
create table if not exists ventas_ventas (
  id            uuid primary key default gen_random_uuid(),
  comercio_id   uuid not null references comercios(id) on delete cascade,
  sucursal_id   uuid not null references sucursales(id) on delete cascade,
  total         numeric(12,2) not null default 0,
  descuento     numeric(12,2) not null default 0,
  metodo_pago   text default 'efectivo',   -- efectivo | tarjeta | transferencia | qr
  cliente       text,
  fiado         boolean not null default false,
  usuario       text,
  notas         text,
  fecha         timestamptz not null default now()
);

-- ─── ITEMS de cada venta (detalle) ────────────────────────────────────────
create table if not exists ventas_items (
  id              uuid primary key default gen_random_uuid(),
  comercio_id     uuid not null references comercios(id) on delete cascade,
  venta_id        uuid not null references ventas_ventas(id) on delete cascade,
  producto_id     uuid references productos(id) on delete set null,
  lote_id         uuid references lotes(id) on delete set null,
  nombre_producto text,
  cantidad        int not null,
  precio_unit     numeric(12,2) not null,
  subtotal        numeric(12,2) not null
);

-- ─── DEUDAS / FIADO (propio de ventas) ────────────────────────────────────
create table if not exists ventas_deudas (
  id            uuid primary key default gen_random_uuid(),
  comercio_id   uuid not null references comercios(id) on delete cascade,
  venta_id      uuid references ventas_ventas(id) on delete set null,
  cliente       text not null,
  monto         numeric(12,2) not null,
  pagada        boolean not null default false,
  fecha         timestamptz not null default now()
);

-- ─── Índices ──────────────────────────────────────────────────────────────
create index if not exists idx_ventas_comercio on ventas_ventas(comercio_id);
create index if not exists idx_ventas_fecha     on ventas_ventas(fecha desc);
create index if not exists idx_vitems_venta     on ventas_items(venta_id);
create index if not exists idx_vdeudas_comercio on ventas_deudas(comercio_id);

-- ─── RLS (multi-tenant — usa comercios_del_usuario() existente) ────────────
alter table ventas_ventas enable row level security;
alter table ventas_items  enable row level security;
alter table ventas_deudas enable row level security;

-- Ventas/items/deudas: acceso total a cualquier MIEMBRO (vender es su trabajo),
-- siempre limitado al rol authenticated (F3) y al propio comercio.
create policy "acceso ventas propias" on ventas_ventas
  for all to authenticated using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));

-- items/deudas: además, el venta_id debe pertenecer al MISMO comercio (evita
-- inserts directos colgados de una venta ajena).
create policy "acceso items propios" on ventas_items
  for all to authenticated using (comercio_id in (select comercios_del_usuario()))
  with check (
    comercio_id in (select comercios_del_usuario())
    and exists (select 1 from ventas_ventas v where v.id = ventas_items.venta_id and v.comercio_id = ventas_items.comercio_id)
  );

create policy "acceso deudas propias" on ventas_deudas
  for all to authenticated using (comercio_id in (select comercios_del_usuario()))
  with check (
    comercio_id in (select comercios_del_usuario())
    and (venta_id is null or exists (select 1 from ventas_ventas v where v.id = ventas_deudas.venta_id and v.comercio_id = ventas_deudas.comercio_id))
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- PIN del dueño (escenario cuenta compartida). Se guarda HASHEADO, nunca plano.
-- Un PIN por comercio. Solo el dueño lo configura.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists ventas_config (
  comercio_id uuid primary key references comercios(id) on delete cascade,
  pin_hash    text,           -- SHA-256 del PIN (nunca el PIN en texto)
  updated_at  timestamptz not null default now()
);

alter table ventas_config enable row level security;

-- F2: el PIN lo LEEN todos los miembros (para validar al ingresar) pero solo
-- el DUEÑO puede configurarlo/cambiarlo.
drop policy if exists "acceso config propia" on ventas_config;
drop policy if exists "ver config (miembros)" on ventas_config;
drop policy if exists "editar config (dueno)" on ventas_config;
create policy "ver config (miembros)" on ventas_config
  for select to authenticated using (comercio_id in (select comercios_del_usuario()));
create policy "editar config (dueno)" on ventas_config
  for all to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = ventas_config.comercio_id and m.rol = 'dueno'))
  with check (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = ventas_config.comercio_id and m.rol = 'dueno'));

-- ═══════════════════════════════════════════════════════════════════════════
-- registrar_venta(p jsonb): registra una venta COMPLETA de forma ATÓMICA.
-- Reemplaza los writes sueltos del cliente (cabecera/items/lotes/movimientos).
--   • Atomicidad: todo o nada (una sola transacción → función).
--   • Idempotencia: si la venta (id) ya existe, no reprocesa → sin doble descuento.
--   • Sin overselling/lost-update: FEFO con SELECT ... FOR UPDATE (lock de lotes).
--   • Multi-tenant: valida que el comercio sea del usuario.
-- El cliente la llama con: supabase.rpc('registrar_venta', { p: payload })
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function registrar_venta(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- La sucursal debe pertenecer al comercio (evita referencias cruzadas).
  if not exists (select 1 from sucursales where id = v_sucursal and comercio_id = v_comercio) then
    raise exception 'sucursal no pertenece al comercio';
  end if;
  if exists (select 1 from ventas_ventas where id = v_id) then
    return jsonb_build_object('ok', true, 'duplicada', true, 'venta_id', v_id);
  end if;

  insert into ventas_ventas (id, comercio_id, sucursal_id, total, descuento, metodo_pago, cliente, fiado, usuario, fecha)
  values (v_id, v_comercio, v_sucursal, 0, v_desc,
          coalesce(p->>'metodo_pago','efectivo'), nullif(p->>'cliente',''),
          coalesce((p->>'fiado')::boolean, false), v_usuario, v_fecha);

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
      -- Cada producto del item debe ser del comercio (evita oráculo cross-tenant).
      if v_pid is null or not exists (select 1 from productos where id = v_pid and comercio_id = v_comercio) then
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
      if v_restante > 0 then
        insert into ventas_items (id, comercio_id, venta_id, producto_id, lote_id, nombre_producto, cantidad, precio_unit, subtotal)
          values (gen_random_uuid(), v_comercio, v_id, v_pid, null, v_nombre, v_restante, v_precio, v_precio * v_restante);
        v_faltantes := v_faltantes || jsonb_build_object('producto_id', v_pid, 'nombre', v_nombre, 'faltante', v_restante);
      end if;
    end;
  end loop;

  update ventas_ventas set total = greatest(0, v_total - v_desc) where id = v_id;

  if coalesce((p->>'fiado')::boolean, false) and nullif(p->>'cliente','') is not null then
    insert into ventas_deudas (id, comercio_id, venta_id, cliente, monto, pagada, fecha)
      values (gen_random_uuid(), v_comercio, v_id, p->>'cliente', greatest(0, v_total - v_desc), false, v_fecha);
  end if;

  return jsonb_build_object('ok', true, 'duplicada', false, 'venta_id', v_id,
                            'total', greatest(0, v_total - v_desc), 'faltantes', v_faltantes);
end $$;

revoke execute on function registrar_venta(jsonb) from public, anon;
grant  execute on function registrar_venta(jsonb) to authenticated;
