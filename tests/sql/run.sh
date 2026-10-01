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

# The owner's ready-made queries (supabase/usage_queries.sql): every one must run, and the key ones must give the
# right numbers for the usage rows the access-rule tests just created
# (member1: 3 boxes / 65 items in Box Scanner today, 6 Price Check lookups in the last 7 days).
echo "== usage_queries.sql"
QDIR="$(mktemp -d)"
awk -v d="$QDIR" '/^-- Q[0-9]+\./ { n++; f = sprintf("%s/q%02d.sql", d, n) } n { print > f }' supabase/usage_queries.sql
count=0
for f in "$QDIR"/q*.sql; do
  if ! psql -q -v ON_ERROR_STOP=1 -d "$DB" -At -f "$f" >"$f.out" 2>&1; then echo "FAIL: $(head -1 "$f")"; cat "$f.out"; exit 1; fi
  count=$((count + 1))
done
expect() { grep -Eq "$2" "$QDIR/$1.out" || { echo "FAIL: $1 did not return the expected row ($2)"; cat "$QDIR/$1.out"; exit 1; }; }
expect q01.sql 'box_scanner\|box_closed\|3\|65'
expect q01.sql 'price_check\|lookup_found\|6\|0'
expect q02.sql '^member1@x.com\|member1@x.com\|New Name\|3\|65\|.*\|6$'
expect q03.sql '^New Name\|1\|3\|65'
expect q10.sql '^5\|'
rm -rf "$QDIR"
echo "$count usage queries ran and returned the expected numbers"
