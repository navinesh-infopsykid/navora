#!/usr/bin/env bash
# Cost guards for the KRIVA billing app on Google Cloud.
# Safe to run more than once. It does NOT touch the database.
#
#   1. Budget alert: emails at 50%, 90%, 100% of ₹500/month (+ a forecast alert)
#   2. Auto-delete old app images (keeps the newest 3)
#   3. Daily 9 am "keep-alive" visit so Supabase Free doesn't pause on closed days
#   4. Faster start after the app has been idle (startup CPU boost)
#   5. Makes sure the app can never run more than 1 server and never stays on when idle
#
# Usage (from the project folder on your Mac):
#   bash ops/cost-guards.sh
set -euo pipefail

PROJECT="${PROJECT:-kriva-billing-511512}"
REGION="${REGION:-australia-southeast1}"        # where the kriva-billing service runs
SERVICE="${SERVICE:-kriva-billing}"
BUDGET="${BUDGET:-500}"                          # in your billing account's currency (INR)

gcloud config set project "$PROJECT" >/dev/null
echo "Project: $PROJECT   Region: $REGION   Service: $SERVICE"

echo "→ Enabling the APIs used below (free)"
gcloud services enable billingbudgets.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com

echo "→ 5. Scaling limits: 0 servers when idle, at most 1, CPU only while handling requests"
gcloud run services update "$SERVICE" --region "$REGION" \
  --min-instances 0 --max-instances 1 --cpu-throttling --cpu-boost --quiet

echo "→ 1. Budget alert"
ACCOUNT=$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)' | sed 's#billingAccounts/##')
CURRENCY=$(gcloud billing accounts describe "$ACCOUNT" --format='value(currencyCode)' 2>/dev/null || echo INR)
if gcloud billing budgets list --billing-account="$ACCOUNT" --format='value(displayName)' | grep -qx "KRIVA monthly"; then
  echo "   Budget 'KRIVA monthly' already exists — leaving it."
else
  gcloud billing budgets create --billing-account="$ACCOUNT" \
    --display-name="KRIVA monthly" --budget-amount="${BUDGET}${CURRENCY}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 --threshold-rule=percent=1.0,basis=forecasted-spend
  echo "   Created: ${BUDGET} ${CURRENCY}/month. Alerts go to the billing account's admins by email."
fi

echo "→ 2. Image cleanup (keep newest 3, delete older than 30 days)"
POLICY=$(mktemp)
cat > "$POLICY" <<'EOF'
[{"name":"keep-newest-3","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":3}},
 {"name":"delete-older","action":{"type":"Delete"},"condition":{"olderThan":"30d"}}]
EOF
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --location="$REGION" --policy="$POLICY" --no-dry-run --quiet
rm -f "$POLICY"

echo "→ 3. Daily keep-alive at 9 am IST"
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
if gcloud scheduler jobs describe kriva-keepalive --location="$REGION" >/dev/null 2>&1; then
  echo "   Keep-alive already exists — leaving it."
else
  gcloud scheduler jobs create http kriva-keepalive --location="$REGION" \
    --schedule="0 9 * * *" --time-zone="Asia/Kolkata" --http-method=GET \
    --uri="$URL/api/health" --attempt-deadline=60s
fi

echo
echo "Done. Monthly cost of these guards: ₹0."
