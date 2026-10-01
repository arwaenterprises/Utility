#!/usr/bin/env bash
# Database tests on a throwaway Postgres database:
#   1. schema.sql runs cleanly on an empty database, then AGAIN (it must be safe to re-run)
#   2. tests/sql/rls.sql checks who can read / write / delete what (Row-Level Security)
# Needs a reachable Postgres and the usual PGHOST / PGPORT / PGUSER (/ PGPASSWORD) variables.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="utility_test_$$"
LOG="$(mktemp)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; rm -f "$LOG"' EXIT

# run <label> <file>: quiet on success (Postgres NOTICEs are noise), prints everything on failure
run() {
  if ! psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$2" >"$LOG" 2>&1; then
    echo "FAIL: $1"; cat "$LOG"; exit 1
  fi
  echo "PASS: $1"
}

run "stand-ins for Supabase's auth schema" tests/sql/stubs.sql
run "supabase/schema.sql runs on an empty database" supabase/schema.sql
run "supabase/schema.sql runs AGAIN (safe to re-run)" supabase/schema.sql

echo "== access-rule tests"
if ! psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/sql/rls.sql >"$LOG" 2>&1; then
  grep -E "PASS|FAIL|ERROR" "$LOG" | sed 's/^psql:[^ ]* NOTICE:  //'; exit 1
fi
grep -c "NOTICE:  PASS" "$LOG" | xargs -I{} echo "{} access-rule checks passed"
