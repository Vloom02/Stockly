-- Vuelve atrás la migración 20: saca productos de Realtime (lotes queda, ya estaba antes). Idempotente.
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'productos') then
    alter publication supabase_realtime drop table public.productos;
  end if;
end $$;
