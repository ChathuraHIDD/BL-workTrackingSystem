#!/usr/bin/env bash
# Restore a data backup into a project whose schema was created from supabase/migrations.
# Usage: SUPABASE_DB_URL=... ./scripts/restore.sh backups/ble_auth_<stamp>.sql.gz backups/ble_data_<stamp>.sql.gz
# Restore into a NEW/EMPTY project (or a staging copy) first and verify with supabase/setup/03_health_checks.sql.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}"
AUTH_FILE="${1:?auth backup file}"
DATA_FILE="${2:?data backup file}"
EXISTING=$(psql "$SUPABASE_DB_URL" -At -c "select count(*) from public.tasks")
if [ "$EXISTING" != "0" ]; then
  echo "Refusing to restore: target already contains $EXISTING tasks. Restore into an empty project." >&2
  exit 1
fi
echo "Restoring into: ${SUPABASE_DB_URL%%@*}@…  (Ctrl+C within 5s to abort)"; sleep 5
# Triggers are disabled during the load so audit rows and notifications are not duplicated.
{
  echo "set session_replication_role = replica;"
  echo "delete from public.app_settings; delete from public.departments;"  # replaced by backed-up rows
  gunzip -c "$AUTH_FILE"
  gunzip -c "$DATA_FILE"
  echo "set session_replication_role = origin;"
  echo "select setval('public.task_reference_seq', coalesce((select max(substring(reference_no from '\\d+\$')::bigint) from public.tasks), 0) + 1, false);"
} | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction
echo "Restore complete."
