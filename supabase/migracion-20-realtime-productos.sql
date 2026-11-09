-- Migración 20 · Realtime de productos (2026-11). Sin DROP, idempotente. Va después de la 19.
-- La app escucha lotes y productos en Realtime, pero solo lotes estaba publicada: el canal que pedía las dos tablas
-- quedaba suscripto sin recibir nada (ni el aviso de lotes). Con productos publicada, un precio o un producto nuevo de
-- otro equipo llega al momento en vez de esperar el ciclo de 30 s. Realtime respeta la RLS: cada equipo ve solo lo suyo.
-- Volver atrás: supabase/volver-atras-migracion-20.sql.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lotes') then
    alter publication supabase_realtime add table public.lotes;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'productos') then
    alter publication supabase_realtime add table public.productos;
  end if;
end $$;
