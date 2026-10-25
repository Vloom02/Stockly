-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 7 — Hallazgos de la auditoría 2026-10 (aditiva e idempotente)
--   A) El dueño podía cambiarse `plan`/`trial_hasta` desde la app (UPDATE
--      permitido por RLS) y saltear el bloqueo del trial. Ahora solo los
--      cambia el sistema (SQL editor, service_role o funciones definer).
--   B) Cualquier miembro podía editar `cantidad` de un lote directo (sin RPC)
--      y borrar lotes. Ahora la cantidad de un lote existente solo cambia por
--      ajustar_stock / registrar_venta (delta atómico) y solo el dueño borra.
--   C) `movimientos` es un audit log: nadie lo edita ni lo borra desde la app.
-- El chequeo `current_user = 'authenticated'` distingue el request directo
-- de PostgREST (rol authenticated) de las funciones SECURITY DEFINER, que
-- corren como su dueño (postgres) y siguen pudiendo escribir.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── A) plan / trial_hasta: solo el sistema ────────────────────────────────
create or replace function _proteger_plan_comercio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.plan is distinct from old.plan or new.trial_hasta is distinct from old.trial_hasta) then
    raise exception 'el plan del comercio no se puede modificar desde la app';
  end if;
  return new;
end $$;
revoke execute on function _proteger_plan_comercio() from public, anon, authenticated;

drop trigger if exists proteger_plan_comercio on comercios;
create trigger proteger_plan_comercio
  before update on comercios
  for each row execute function _proteger_plan_comercio();

-- ─── B) lotes: cantidad solo por delta (RPC); borrar solo el dueño ─────────
-- Un UPDATE directo conserva la cantidad que hay en la base (no falla): así un
-- reintento del alta de un lote ya subido no pisa lo que descontó Ventas, y un
-- cliente modificado no puede fijar stock a mano.
create or replace function _proteger_cantidad_lote()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' then
    new.cantidad := old.cantidad;
  end if;
  return new;
end $$;
revoke execute on function _proteger_cantidad_lote() from public, anon, authenticated;

drop trigger if exists proteger_cantidad_lote on lotes;
create trigger proteger_cantidad_lote
  before update on lotes
  for each row execute function _proteger_cantidad_lote();

drop policy if exists "acceso total lotes propios" on lotes;
drop policy if exists "ver lotes (miembros)" on lotes;
drop policy if exists "crear lotes (miembros)" on lotes;
drop policy if exists "modificar lotes (miembros)" on lotes;
drop policy if exists "borrar lotes (dueno)" on lotes;
create policy "ver lotes (miembros)" on lotes
  for select to authenticated using (comercio_id in (select comercios_del_usuario()));
create policy "crear lotes (miembros)" on lotes
  for insert to authenticated with check (comercio_id in (select comercios_del_usuario()));
create policy "modificar lotes (miembros)" on lotes
  for update to authenticated
  using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));
create policy "borrar lotes (dueno)" on lotes
  for delete to authenticated
  using (exists (select 1 from miembros m
    where m.user_id = auth.uid() and m.comercio_id = lotes.comercio_id and m.rol = 'dueno'));

-- ─── C) movimientos: inmutables desde la app ───────────────────────────────
-- Se mantiene una policy de UPDATE para que el upsert de reintento de APKs
-- ya instaladas no falle por RLS, pero el trigger lo convierte en un no-op.
create or replace function _movimiento_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' then
    return old;  -- el audit log no se reescribe
  end if;
  return new;
end $$;
revoke execute on function _movimiento_inmutable() from public, anon, authenticated;

drop trigger if exists movimiento_inmutable on movimientos;
create trigger movimiento_inmutable
  before update on movimientos
  for each row execute function _movimiento_inmutable();

drop policy if exists "acceso total movimientos propios" on movimientos;
drop policy if exists "ver movimientos (miembros)" on movimientos;
drop policy if exists "crear movimientos (miembros)" on movimientos;
drop policy if exists "reintento movimientos (miembros)" on movimientos;
create policy "ver movimientos (miembros)" on movimientos
  for select to authenticated using (comercio_id in (select comercios_del_usuario()));
create policy "crear movimientos (miembros)" on movimientos
  for insert to authenticated with check (comercio_id in (select comercios_del_usuario()));
create policy "reintento movimientos (miembros)" on movimientos
  for update to authenticated
  using (comercio_id in (select comercios_del_usuario()))
  with check (comercio_id in (select comercios_del_usuario()));
-- Sin policy de DELETE: nadie borra movimientos desde la app.
