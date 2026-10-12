# Database guide (Supabase + Prisma)

The app stores everything in a PostgreSQL database hosted on Supabase's free tier.
Prisma creates the tables (migrations) and the backend reads and writes them.

| File | What it is |
| --- | --- |
| `../backend/prisma/schema.prisma` | The data model. **Edit this** to change tables. |
| `../backend/prisma/migrations/` | SQL that Prisma applies to the database, in order. |
| `../backend/prisma/seed.ts` | Sample business settings and 12 sample products. |
| `schema.sql` | Read-only copy of the full schema, for reference. |
| `useful-queries.sql` | Ready-made queries to paste into the Supabase SQL Editor. |

## Tables

| Table | Holds |
| --- | --- |
| `Product` | Items you sell: name, SKU, price (paise), stock, low-stock level, active flag. |
| `Customer` | Customers, matched by phone number. |
| `Invoice` | One row per bill: number, customer snapshot, subtotal, discount, total, payment status/method. |
| `InvoiceItem` | Lines of each bill, with the product **name and price copied** at billing time. |
| `Payment` | Money received (created when a bill is saved as Paid, or marked Paid later). |
| `StockMovement` | Every stock change: before, change, after, reason, and the invoice for sales. |
| `BusinessSettings` | One row (id 1): business name, address, phone, currency, footer, invoice counter. |
| `WhatsAppMessage` | Each WhatsApp share attempt and its status. |

**Money is stored in paise** (whole numbers). ₹49.50 is stored as `4950`.

## 1. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard> and click **New project**.
2. Choose a name, set a **database password** (save it in your password manager), and pick the region closest to you (for India: *South Asia (Mumbai)*).
3. Wait about two minutes for the project to start.

## 2. Copy the connection string

1. In the project, click **Connect** at the top of the dashboard.
2. Choose the **Session pooler** connection string (works on every home network, including IPv4-only ones). It looks like:
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with your database password.
   If the password contains `@ # / ? % & :` or spaces, URL-encode those characters
   (for example `@` → `%40`, `#` → `%23`), or reset the password to letters and numbers only
   under **Project Settings → Database → Reset database password**.
4. Paste the same string into both `DATABASE_URL` and `DIRECT_URL` in `backend/.env`.

## 3. Create the tables and sample data

From the project folder:

```bash
npm run db:migrate   # creates all tables (prisma migrate deploy)
npm run db:seed      # adds sample settings and products (safe to run twice)
```

## 4. View or edit records in Supabase

**Table Editor** (spreadsheet view): left sidebar → **Table Editor** → pick a table, for example `Product`.
You can sort, filter, and double-click a cell to edit it.

**SQL Editor**: left sidebar → **SQL Editor** → **New query**, paste a query from
[`useful-queries.sql`](useful-queries.sql) and click **Run**.

Things to know before editing by hand:

- Amounts are in **paise**. To set a price of ₹120.00 type `12000`.
- **Do not edit `stock` directly.** Use the app's Stock adjustment page so the change is recorded in
  `StockMovement`. (Query 6 in `useful-queries.sql` finds products whose stock no longer matches its history.)
- **Do not edit or delete invoices, invoice items or payments.** They are your sales records.
  If a bill was wrong, note it and correct stock with an adjustment.
- Deactivate products in the app instead of deleting them; deleting a product that appears on an invoice is blocked by the database.
- Do not touch the `_prisma_migrations` table — Prisma uses it to track which migrations ran.
- `BusinessSettings.nextInvoiceNumber` is the next invoice serial. Change it only to start numbering
  from a higher number (never lower, or invoice numbers will clash).

You can also browse data locally with Prisma Studio: `npm run db:studio` (opens <http://localhost:5555>).

## Backups

The Supabase free tier does not include downloadable automatic backups. To keep your own copy,
install the PostgreSQL client (`brew install libpq && brew link --force libpq`) and run:

```bash
pg_dump "YOUR_DIRECT_URL" --no-owner --no-privileges -f billing-backup-$(date +%F).sql
```

Free projects are paused after a period of inactivity; restore them from the dashboard (see the main README's troubleshooting section).

## Changing the schema later

1. Edit `backend/prisma/schema.prisma`.
2. Run `npm run db:migrate:dev -- --name describe_your_change` against a **development** database
   (not your live shop data). Prisma writes a new folder in `backend/prisma/migrations/`.
3. Apply it to Supabase with `npm run db:migrate`.

`npm run db:check-drift -w backend` compares the live database with `schema.prisma` and prints any SQL
needed to make them match (an empty result means they are in sync).
