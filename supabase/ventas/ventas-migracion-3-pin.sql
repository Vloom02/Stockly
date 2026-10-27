-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #3 (Ventas) — Hardening del PIN de dueño.
-- BRECHA detectada en el escaneo: la policy "ver config (miembros)" dejaba que
-- CUALQUIER miembro (un empleado) leyera el pin_hash; un PIN de 4-6 dígitos en
-- SHA-256 se crackea offline en milisegundos.
-- FIX: la verificación pasa al server (verificar_pin), el hash deja de ser
-- legible para los miembros, y `tiene_pin` reemplaza la lectura directa.
-- Idempotente. Correr en el mismo proyecto.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ¿El comercio tiene PIN configurado? (cualquier miembro; no expone el hash)
create or replace function tiene_pin(p jsonb)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
begin
  if v_comercio is null then raise exception 'datos incompletos'; end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  return exists (select 1 from ventas_config
    where comercio_id = v_comercio and pin_hash is not null);
end $$;

revoke execute on function tiene_pin(jsonb) from public, anon;
grant  execute on function tiene_pin(jsonb) to authenticated;

-- Verificar el PIN SIN exponer el hash (mismo formato que el cliente:
-- hex minúscula de SHA-256).
-- search_path incluye `extensions`: pgcrypto (digest) vive ahí en Supabase.
-- (Sin esto, digest() no se resuelve y la verificación falla SIEMPRE.)
create or replace function verificar_pin(p jsonb)
returns boolean
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_comercio uuid := (p->>'comercio_id')::uuid;
  v_pin      text := coalesce(p->>'pin','');
  v_hash     text;
begin
  if v_comercio is null or v_pin = '' then return false; end if;
  if not exists (select 1 from miembros m
      where m.user_id = auth.uid() and m.comercio_id = v_comercio) then
    raise exception 'no autorizado';
  end if;
  select pin_hash into v_hash from ventas_config where comercio_id = v_comercio;
  if v_hash is null then return false; end if;
  return v_hash = encode(digest(v_pin, 'sha256'), 'hex');
end $$;

revoke execute on function verificar_pin(jsonb) from public, anon;
grant  execute on function verificar_pin(jsonb) to authenticated;

-- Cerrar la brecha: los miembros ya no pueden leer el hash.
-- (El dueño conserva acceso total por la policy "editar config (dueno)" FOR ALL.)
drop policy if exists "ver config (miembros)" on ventas_config;
