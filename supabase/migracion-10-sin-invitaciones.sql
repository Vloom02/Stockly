-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 10 — Sin invitaciones (2026-10-26)
-- Los empleados ya no tienen cuenta propia: el dueño abre su cuenta en su celular
-- y en la tablet del local, y cada empleado entra a su turno con su nombre y PIN
-- (ventas_empleados). La app ya no crea ni valida códigos.
--   · Se borran las RPC crear_invitacion / validar_invitacion (esta última era
--     pública para anon: el advisor la marcaba).
--   · Las invitaciones sin usar vencen ya, así el alta de usuarios
--     (crear_comercio_para_nuevo_usuario) no puede usarlas.
-- Quedan la tabla, quitar_miembro y el rol 'empleado': no molestan y una cuenta
-- de empleado vieja seguiría andando con sus límites de siempre.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists crear_invitacion(jsonb);
drop function if exists validar_invitacion(jsonb);

update invitaciones set expira_en = now() where usada_por is null and expira_en > now();
