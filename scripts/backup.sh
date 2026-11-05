#!/usr/bin/env bash
# Logical backup of the application data (public schema + auth users).
# Usage: SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" ./scripts/backup.sh [output-dir]
# Get the connection string from Supabase → Project Settings → Database → Connection string (Session pooler).
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}"
OUT_DIR="${1:-backups}"
STAMP="$(TZ=Asia/Colombo date +%Y-%m-%d_%H%M)"
mkdir -p "$OUT_DIR"

# Business data (schema + data) — restorable into a fresh project after running the migrations
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner --no-privileges \
  --exclude-table-data='public.notification_delivery_attempts' \
  -f "$OUT_DIR/ble_data_$STAMP.sql"

# Full schema for reference / disaster recovery
pg_dump "$SUPABASE_DB_URL" --schema-only --schema=public --schema=private --no-owner \
  -f "$OUT_DIR/ble_schema_$STAMP.sql"

# Login accounts (auth.users) so linked accounts can be recreated
pg_dump "$SUPABASE_DB_URL" --data-only --table=auth.users --table=auth.identities --no-owner \
  -f "$OUT_DIR/ble_auth_$STAMP.sql"

gzip -f "$OUT_DIR"/ble_*_"$STAMP".sql
echo "Backup written to $OUT_DIR (stamp $STAMP)"
