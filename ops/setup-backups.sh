#!/usr/bin/env bash
# Nightly, automatic, off-site backups of the KRIVA database to Google Cloud Storage.
#
# How it works:
#   - Every night at 11:30 pm IST, Cloud Scheduler starts a small Cloud Run job.
#   - The job runs pg_dump (the official PostgreSQL tool) against Supabase, checks the
#     file can be read back (pg_restore --list), and saves it in a private bucket in Mumbai.
#   - daily/   : one file per night, kept 35 days
#   - monthly/ : the file from the 1st of each month, kept ~7 years
#   - The job only READS the database. It never changes or deletes data in Supabase.
#   - Expected cost: ₹1–10 a month.
#
# Usage (from the project folder on your Mac):
#   bash ops/setup-backups.sh
# It asks you to paste the Supabase Session pooler string (same as DIRECT_URL) once.
set -euo pipefail

PROJECT="${PROJECT:-kriva-billing-511512}"
REGION="${REGION:-asia-south1}"                 # Mumbai: away from the Sydney database
BUCKET="${BUCKET:-kriva-billing-backups-511512}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"      # must be >= your Supabase Postgres version
SA_NAME=kriva-backup
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"

gcloud config set project "$PROJECT" >/dev/null
echo "→ Enabling APIs"
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com

echo "→ Private backup bucket gs://$BUCKET ($REGION)"
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
RULES=$(mktemp)
cat > "$RULES" <<'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":35,"matchesPrefix":["daily/"]}},
         {"action":{"type":"Delete"},"condition":{"age":2600,"matchesPrefix":["monthly/"]}}]}
EOF
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$RULES"
rm -f "$RULES"

echo "→ Database address stored in Secret Manager (not in any file)"
if ! gcloud secrets describe kriva-db-url >/dev/null 2>&1; then
  read -r -s -p "Paste the Supabase Session pooler string (with password), then Enter: " DBURL; echo
  printf '%s' "$DBURL" | gcloud secrets create kriva-db-url --data-file=-
  unset DBURL
else
  echo "   Secret kriva-db-url already exists (to change it: gcloud secrets versions add kriva-db-url --data-file=-)"
fi

echo "→ Service account for the backup job"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create "$SA_NAME" --display-name="KRIVA nightly backup"
gcloud secrets add-iam-policy-binding kriva-db-url --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectUser >/dev/null

SCRIPT='set -e; D=$(date -u +%F); mkdir -p /backups/daily /backups/monthly; pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges -Fc -f /tmp/k.dump; pg_restore --list /tmp/k.dump >/dev/null; cp /tmp/k.dump /backups/daily/kriva-$D.dump; if [ "$(date -u +%d)" = "01" ]; then cp /tmp/k.dump /backups/monthly/kriva-$D.dump; fi; ls -l /backups/daily/kriva-$D.dump'

echo "→ Backup job"
VERB=create
gcloud run jobs describe kriva-backup --region="$REGION" >/dev/null 2>&1 && VERB=update
gcloud run jobs "$VERB" kriva-backup --region="$REGION" --image="$PG_IMAGE" \
  --service-account="$SA" --set-secrets=DATABASE_URL=kriva-db-url:latest \
  --add-volume=name=backups,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount=volume=backups,mount-path=/backups \
  --cpu=1 --memory=512Mi --max-retries=1 --task-timeout=10m \
  --command=sh --args="-c,$SCRIPT" --quiet
gcloud run jobs add-iam-policy-binding kriva-backup --region="$REGION" \
  --member="serviceAccount:$SA" --role=roles/run.invoker --quiet >/dev/null

echo "→ Nightly schedule (11:30 pm IST)"
if ! gcloud scheduler jobs describe kriva-backup-nightly --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs create http kriva-backup-nightly --location="$REGION" \
    --schedule="30 23 * * *" --time-zone="Asia/Kolkata" --http-method=POST \
    --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/kriva-backup:run" \
    --oauth-service-account-email="$SA"
fi

echo "→ First backup now (about a minute)"
gcloud run jobs execute kriva-backup --region="$REGION" --wait
echo
gcloud storage ls -l "gs://$BUCKET/daily/"
echo
echo "Backups are set up. Check them any time with:  gcloud storage ls -l gs://$BUCKET/daily/"
