-- ventas-migracion-11: configurar_pin solo para usuarios con sesión.
-- La función ya exige ser dueño (auth.uid()), así que sin sesión fallaba igual;
-- esto saca el permiso a anon (aviso del advisor). validar_invitacion queda
-- anónima a propósito: se usa ANTES de registrarse (código 32^8, un uso, 7 días).
revoke execute on function configurar_pin(jsonb) from public, anon;
grant  execute on function configurar_pin(jsonb) to authenticated;
