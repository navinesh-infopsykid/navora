#!/usr/bin/env bash
# Monthly backup test: download the newest backup, restore it into a throw-away
# database ON YOUR MAC, and print the bill count and totals. Compare them with the
# app's Dashboard. Nothing in Supabase is touched.
#
# Needs: brew install postgresql@17   (and `brew services start postgresql@17`)
# Usage:  bash ops/check-backup.sh
set -euo pipefail
BUCKET="${BUCKET:-kriva-billing-backups-511512}"
PGBIN="$(brew --prefix postgresql@17)/bin"
LATEST=$(gcloud storage ls "gs://$BUCKET/daily/" | sort | tail -1)
[ -n "$LATEST" ] || { echo "No backups found in gs://$BUCKET/daily/"; exit 1; }
TMP=$(mktemp -d)
echo "Newest backup: $LATEST"
gcloud storage cp "$LATEST" "$TMP/kriva.dump" >/dev/null
"$PGBIN/dropdb" --if-exists kriva_check
"$PGBIN/createdb" kriva_check
"$PGBIN/pg_restore" --no-owner --no-privileges -d kriva_check "$TMP/kriva.dump"
"$PGBIN/psql" -d kriva_check -c "
  select count(*) as bills,
         round(sum(\"totalPaise\")/100.0, 2) as total_rupees,
         min(\"invoiceDate\")::date as first_bill,
         max(\"invoiceDate\")::date as last_bill
  from \"Invoice\";"
"$PGBIN/dropdb" kriva_check
rm -rf "$TMP"
echo "Backup is readable. Compare these numbers with Dashboard → Custom range over the same dates."
