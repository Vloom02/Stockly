#!/usr/bin/env bash
# Levanta un Supabase local VACÍO, aplica las migraciones en orden (supabase/orden-migraciones.txt)
# y corre las pruebas del backend (tests/backend). Lo usa GitHub Actions; local: bash scripts/pruebas-backend.sh
# Necesita Docker y la CLI de Supabase. Con --cerrar apaga el Supabase al terminar.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=.supabase-pruebas
rm -rf "$DIR" && mkdir -p "$DIR/supabase/migrations"
echo 'project_id = "stockly-pruebas"' > "$DIR/supabase/config.toml"
n=0
grep -v '^#' supabase/orden-migraciones.txt | while read -r f; do
  [ -n "$f" ] || continue
  n=$((n + 1))
  cp "$f" "$DIR/supabase/migrations/$(printf '2026010100%04d' "$n")_$(basename "$f")"
done
# Solo lo que usan las pruebas: base, auth, API REST y gateway.
(cd "$DIR" && supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor)
rm -f tests/backend/usuarios-prueba.json
"${PYTHON:-python3}" -I tests/backend/pruebas_backend.py
[ "${1:-}" = "--cerrar" ] && (cd "$DIR" && supabase stop --no-backup) || true
