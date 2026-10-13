# Speed and deployment guide

This guide covers two things:

1. **Making the app fast**: move the database close to the shop.
2. **Putting the app online** so you can open it from any device, for free or nearly free.

---

## 1. Why the app was slow, and what fixes it

Every time the app reads or saves something, the request travels to the database and back.
Your Supabase project is in **Sydney** (`ap-southeast-2`), so each trip from India takes about
**0.15 seconds**. The old code made many trips one after another (23 to save one bill).

**Already fixed in the code.** The app now makes far fewer trips:

- it keeps database connections open,
- it remembers who is logged in for 60 seconds,
- it deducts stock for every bill line in one query,
- it no longer reloads a bill after saving it.

Measured on this app with a database 150 ms away:

| Action | Before | After (same Sydney database) | After + database in Mumbai |
| --- | ---: | ---: | ---: |
| Open the app (login check) | 0.62 s | 0.16 s | 0.04 s |
| Load items for billing | 0.47 s | 0.16 s | 0.04 s |
| **Save a 3-item bill** | **3.08 s** | **1.54 s** | **0.33 s** |
| Invoice PDF | 1.09 s | 0.33 s | 0.09 s |
| Settings page | 1.07 s | 0.16 s | 0.04 s |
| First request after 15 s idle | 0.93 s | 0.16 s | 0.04 s |

The **Mumbai** column is the biggest remaining win. Supabase can't move an existing project to
another region, so you create a new free project in Mumbai and copy your data across
(about 15 minutes, steps below). If the app is also deployed in Mumbai (section 3), the app-to-database
trip becomes about 1 ms and every screen is close to instant.

---

## 2. Move the database to Mumbai

You'll need the PostgreSQL command-line tools on your Mac (once):

```bash
brew install libpq
brew link --force libpq
pg_dump --version      # should print 17 or newer
```

### Step 1: Create the new Supabase project

1. Supabase dashboard → **New project**.
2. Region: **South Asia (Mumbai)**. Use a database password with **only letters and numbers**.
3. When it's ready: **Connect** → **Session pooler** → copy the string (port **5432**).

The free plan allows 2 active projects, so the old Sydney project can stay until you've checked the new one.

### Step 2: Stop the app and save both addresses in Terminal

Stop `npm run dev` (Control + C) so no bills are made during the move. Then:

```bash
cd ~/development/projects/navora
OLD='paste the OLD Sydney session-pooler string here, with password'
NEW='paste the NEW Mumbai session-pooler string here, with password'
```

### Step 3: Create the tables in the new database

```bash
DATABASE_URL="$NEW" DIRECT_URL="$NEW" npm run db:migrate
```

### Step 4: Copy all data (items, bills, customers, logins)

```bash
pg_dump "$OLD" --data-only --no-owner --no-privileges --schema=public \
  --exclude-table=_prisma_migrations -f ~/Desktop/kriva-backup.sql
psql "$NEW" -v ON_ERROR_STOP=1 -f ~/Desktop/kriva-backup.sql
```

### Step 5: Check that the counts match

```bash
for t in Product Customer Invoice InvoiceItem Payment StockMovement User; do
  echo "$t: old $(psql "$OLD" -tAc "select count(*) from \"$t\"")  new $(psql "$NEW" -tAc "select count(*) from \"$t\"")"
done
```

### Step 6: Point the app at Mumbai

Put the new string in **both** `DATABASE_URL` and `DIRECT_URL` in `backend/.env`. Run `npm run dev`,
log in with your usual password, and make a test bill. Invoice numbers continue from where they were.

### Step 7: Tidy up

- Delete `~/Desktop/kriva-backup.sql`. It contains customer data and password hashes.
- After a few days of normal use, pause or delete the old Sydney project in Supabase.

We tested this exact procedure on a copy of the app's database: all 10 tables copied with identical
counts, existing logins worked, and new bills and items continued numbering correctly.

---

## 3. Put the app online

The app is now one web service: in production the backend also serves the web pages.
The included `Dockerfile` builds it for any host. Database migrations are not run by the host;
you keep running `npm run db:migrate` from your Mac.

### Options

| Option | Cost | Always ready? | Close to India? | Effort |
| --- | --- | --- | --- | --- |
| **A. Google Cloud Run, Mumbai** (recommended) | Free tier: 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds a month. A shop's usage fits inside it. Needs a card on file. | Wakes in a few seconds after a quiet spell | Yes (`asia-south1`) | Medium |
| B. Render, Singapore | Free plan sleeps after 15 min idle and takes about 1 min to wake (bad at a counter). Always-on instance: $7/month. | Paid: yes | Singapore | Easy, needs GitHub |
| C. Your shop Mac only | ₹0 | While the Mac is on | Same as now | Already done |

Prices were checked on the providers' sites in October 2026 and can change.

**Why Cloud Run:** it runs in Mumbai next to your new database, normal shop use falls inside its
free tier, and it deploys straight from your project folder (no GitHub needed). The trade-off is that
after a quiet period, the first request takes a few seconds while it starts. Keeping one copy always
running (`--min-instances 1`) removes that wait, but by our estimate from Google's idle prices it
costs roughly $10 a month. Most shops don't need it.

### A. Deploy to Google Cloud Run (step by step)

**1. One-time setup on your Mac**

```bash
brew install --cask google-cloud-sdk
gcloud init                     # log in with your Google account, create a project, e.g. kriva-billing
gcloud config set run/region asia-south1
```

In <https://console.cloud.google.com/billing>, link a billing account (a card) to the project.
Then go to **Billing → Budgets & alerts** and create a budget of ₹100 with email alerts, so you'd hear
about any unexpected charge.

**2. Write the settings file** (stays on your Mac; `.gcloudignore` stops it being uploaded)

```bash
cp cloudrun.env.example.yaml cloudrun.env.yaml
nano cloudrun.env.yaml          # paste your Mumbai Supabase string into both URL lines
```

**3. Deploy** (from the project folder; run this again whenever you update the code)

```bash
gcloud run deploy kriva-billing \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --memory 512Mi \
  --env-vars-file cloudrun.env.yaml
```

The first time, answer **Y** when it asks to enable APIs and create an Artifact Registry repository.
The build takes a few minutes. At the end it prints a web address like
`https://kriva-billing-xxxxx.asia-south1.run.app`. Open it, log in, and that's your shop's billing app,
reachable from any phone or computer.

What the flags do:

- `--allow-unauthenticated` lets the public reach the page. The app's own login still protects everything.
- `--max-instances 1` keeps costs capped and keeps login sessions and the login rate limit on one server.

**4. After deploying**

- Use a strong owner password now that the app is on the internet.
- Optional custom domain (for example `billing.krivapatisserie.in`): Cloud Run → your service →
  **Manage custom domains**.
- Each deploy stores a container image (about 250 MB) in Artifact Registry. The free storage is
  small, so occasionally delete old images there, or add a cleanup policy that keeps only the latest 2.

### B. Render instead (if you prefer GitHub-based deploys)

1. Put the project on GitHub as a private repository. `.gitignore` already keeps `.env` out.
2. Render → **New → Web Service** → pick the repo. Runtime **Docker**, region **Singapore**,
   instance **Starter** ($7/month; Free sleeps).
3. Environment: `DATABASE_URL`, `DIRECT_URL`, `APP_TIMEZONE=Asia/Kolkata`, `DEFAULT_COUNTRY_CODE=91`.
4. Deploy, then open the `onrender.com` address it gives you.

### C. Only inside the shop (free, no cloud)

Run the production build on the shop Mac and open it from phones on the same Wi-Fi:

```bash
npm run build
HOST=0.0.0.0 npm start          # then open http://<the Mac's IP address>:4000 on a phone
```

To find the Mac's IP address: **System Settings → Wi-Fi → Details**. This is plain HTTP, so use it only
on your own shop Wi-Fi.

---

## Keep in mind

- **Supabase free projects pause after a week of no use.** Daily billing keeps it awake. If it pauses,
  click **Restore** in the dashboard.
- **The free Supabase plan has no backups.** Once a week, run the `pg_dump` command from step 4 against
  your live database, save the file somewhere safe (not in the project folder), and keep a few recent copies.
- **Schema updates** (new versions of this app with new migrations): run
  `DATABASE_URL="$NEW" DIRECT_URL="$NEW" npm run db:migrate` from your Mac first, then deploy.
