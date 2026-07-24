-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN ADITIVA #4 (Stockly) — Proveedor a nivel PRODUCTO.
-- El proveedor pasa a ser un atributo del producto (no del lote): un producto
-- suele venir siempre del mismo proveedor. La columna lotes.proveedor se deja
-- (datos históricos), pero la app deja de cargarla en el alta de lote.
-- ═══════════════════════════════════════════════════════════════════════════

alter table productos add column if not exists proveedor text;
