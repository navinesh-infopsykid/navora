# simple-billing-software

A lightweight billing and inventory app for a small shop: add items, bill customers, track stock,
download invoice PDFs and share them on WhatsApp.

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router, Axios, Lucide icons
- **Backend:** Node.js, Express, TypeScript, REST API, Zod validation, Helmet, CORS, rate limiting
- **Database:** PostgreSQL on Supabase (free tier), Prisma ORM
- **PDF:** PDFKit

> **Security:** everyone must log in with an email or mobile number and a password (see
> [Logins and users](#logins-and-users)). The backend still listens only on `127.0.0.1` (your own
> computer) by default. Before putting it on the internet, serve it over HTTPS and set
> `COOKIE_SECURE="true"`.

> **Going online / making it faster:** see [`DEPLOY.md`](DEPLOY.md). It covers moving the database
> to Mumbai and deploying for free on Google Cloud Run.

---

## Contents

1. [Features](#features)
2. [Project structure](#project-structure)
3. [Run it on macOS (step by step)](#run-it-on-macos-step-by-step)
4. [Everyday commands](#everyday-commands)
5. [Running the tests](#running-the-tests)
6. [Logins and users](#logins-and-users)
7. [How billing, stock and money work](#how-billing-stock-and-money-work)
8. [WhatsApp sharing](#whatsapp-sharing)
9. [REST API reference](#rest-api-reference)
10. [Viewing and editing data in Supabase](#viewing-and-editing-data-in-supabase)
11. [Troubleshooting](#troubleshooting)
12. [Not included yet](#not-included-yet)

---

## Features

| Page | What you can do |
| --- | --- |
| **New bill** | Order type (Dine-in, Takeaway, Delivery). For takeaway/delivery, packaging is added automatically: a box charge for each item priced at or above a limit (default ₹5 per item of ₹50+) plus a mandatory carry bag (default ₹5, staff can add more bags). Packaging is never discounted. Customer name and WhatsApp number, search items (press `/`, type, Enter), several items per bill, edit quantities, remove lines, ₹ or % discount (applies only to items that allow a discount), live subtotal and payable amount, payment method (Cash, UPI, Card, Other) or **Split** across several methods (must add up to the total), Paid or Unpaid. **Hold bill** parks the current cart on the server and **Held bills** recalls it later — up to 5 at a time. |
| **Dashboard** | Choose Today, Yesterday, This week, This month, This financial year (1 Apr – 31 Mar), Last financial year, Pick a day or a Custom range. Shows sales, bill count and average bill, paid and unpaid totals, discounts given, money received by payment method (split payments counted under each method), bills in the period and low-stock items. |
| **Invoices** | Filter by all, today, yesterday, this week, this month, this or last financial year, a single chosen day or a custom date range; search by invoice number, customer name or phone; filter by Paid/Unpaid; view details; download PDF; mark unpaid invoices as paid; share on WhatsApp. |
| **Items** | Add, edit, search, deactivate and reactivate products (name, optional SKU, price in ₹, stock, low-stock alert, optional description, **Discount allowed** on/off, **No packaging** on/off, optional own box charge such as ₹30 for a cake box). |
| **Stock adjustment** | Choose an item, add or remove stock with a reason, confirm, and see the full history (before, change, after, reason, time). |
| **Settings** | Business name, address, phone, currency (default INR) and invoice footer — printed on every PDF. **Packaging charges** (owner only): box limit, box charge, bag charge, and whether they apply to takeaway and/or delivery. |

---

## Project structure

```
simple-billing-software/
├── package.json            Root scripts (runs frontend + backend together)
├── .gitignore
├── README.md               This guide
├── backend/
│   ├── .env.example        Copy to .env and fill in
│   ├── prisma.config.ts    Prisma CLI settings (loads .env)
│   ├── prisma/
│   │   ├── schema.prisma   Data model
│   │   ├── migrations/     SQL migrations
│   │   └── seed.ts         Sample settings + products
│   ├── src/
│   │   ├── server.ts       Starts the API
│   │   ├── app.ts          Express app: security middleware + routes
│   │   ├── config.ts       Reads environment variables
│   │   ├── routes/         HTTP endpoints + input validation
│   │   ├── services/       Business logic (invoices, stock, PDF, WhatsApp…)
│   │   ├── lib/            Money, dates, phone, database client, errors
│   │   └── middleware/     Error handling
│   ├── scripts/            Test-database setup, schema drift check
│   └── tests/              Automated tests (Vitest)
├── frontend/
│   ├── .env.example        Optional settings
│   ├── vite.config.ts      Dev server + /api proxy to the backend
│   └── src/
│       ├── pages/          Dashboard, Billing, Invoices, InvoiceDetail, Items, StockAdjustment, Settings
│       ├── components/     Layout, shared UI pieces, WhatsApp share panel
│       └── lib/            API client + types, money and date formatting
└── database/
    ├── README.md           Supabase setup, viewing/editing records, backups
    ├── schema.sql          Read-only copy of the schema
    └── useful-queries.sql  Queries for the Supabase SQL Editor
```

---

## Run it on macOS (step by step)

### 1. Install Node.js (once)

You need **Node.js 20.19 or newer** (Node 22 LTS recommended). Check with:

```bash
node -v
```

If it is missing or older, install it from <https://nodejs.org> (choose the LTS installer), or with Homebrew:

```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node -v
```

### 2. Unzip the project

```bash
cd ~/Downloads
unzip simple-billing-software.zip -d ~/Projects
cd ~/Projects/simple-billing-software
```

### 3. Create the Supabase database (once)

1. Go to <https://supabase.com/dashboard>, sign in, click **New project**.
2. Set a database password (letters and numbers are simplest) and choose the *South Asia (Mumbai)* region.
3. When the project is ready, click **Connect** at the top and copy the **Session pooler** connection string.
   It looks like `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`.

More detail, including passwords with special characters, is in [`database/README.md`](database/README.md).

### 4. Configure the backend

```bash
cp backend/.env.example backend/.env
open -e backend/.env
```

In TextEdit, paste your Session pooler string (with your real password instead of `[YOUR-PASSWORD]`)
into **both** `DATABASE_URL` and `DIRECT_URL`, then save. Leave everything else as it is for now.

### 5. Install dependencies

```bash
npm install
```

This installs the frontend and backend together and generates the Prisma client.

### 6. Create the tables and add sample data

```bash
npm run db:migrate
npm run db:seed
```

You should see `Seed complete: 12 new products`. Optional check that the database matches the schema:

```bash
npm run db:check-drift -w backend
```

An empty migration (no `CREATE`/`ALTER` statements) means everything matches.

### 7. Start the app

```bash
npm run dev
```

This starts both servers:

- Backend API: <http://127.0.0.1:4000/api> (health check: <http://127.0.0.1:4000/api/health>)
- **App: <http://localhost:5173>** ← open this in your browser

Stop both with `Control + C`.

Next time you only need `cd ~/Projects/simple-billing-software` and `npm run dev`.

### 8. First things to do in the app

1. **Create the owner account:** the first time you open the app it asks for your name, email and/or
   mobile number, and a password. This becomes the owner login.
2. **Settings:** enter your real business name, address, phone and invoice footer.
3. **Items:** check your items and prices.
4. **New bill:** make a test bill and download its PDF.
5. **Settings → Users:** add logins for staff, if needed.

---

## Everyday commands

Run these from the project folder.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start backend and frontend for local use |
| `npm run db:migrate` | Apply database migrations (safe to run any time) |
| `npm run db:seed` | Add sample settings/products (skips ones that exist) |
| `npm run db:studio` | Browse and edit data in Prisma Studio (<http://localhost:5555>) |
| `npm run typecheck` | TypeScript checks for backend and frontend |
| `npm test` | Run the automated tests |
| `npm run build` | Production build of backend (`backend/dist`) and frontend (`frontend/dist`) |
| `npm run db:check-drift -w backend` | Compare the live database with `schema.prisma` |
| `npm run user:reset-password` | Set a new password for any login (if the owner forgets theirs) |

To try the production build locally: `npm run build`, then `npm start`, and open
<http://localhost:4000>. In production the backend serves the web pages and the API from one address.

---

## Running the tests

The tests cover discounts and money maths, invoice creation, stock deduction (including two bills
at the same moment), payment updates, stock adjustments, date-range filtering, invoice search,
WhatsApp link encoding and the WhatsApp Cloud API flow (with a fake WhatsApp server — no real
messages are sent).

Database tests **delete all data** in the database they use, so they need a **separate, empty
database** — never your Supabase shop database. The easiest option on a Mac:

```bash
brew install postgresql@16
brew services start postgresql@16
/opt/homebrew/opt/postgresql@16/bin/createdb billing_test
```

Add this line to `backend/.env` (replace `yourmacusername` with the output of `whoami`):

```
TEST_DATABASE_URL="postgresql://yourmacusername@localhost:5432/billing_test"
```

Then:

```bash
npm run test:db:setup -w backend   # create tables in the test database (once, and after new migrations)
npm test
```

Without `TEST_DATABASE_URL`, `npm test` still runs the unit tests and clearly reports the database
tests as **skipped**.

(Alternative: create a second, empty Supabase project for tests and use its Session pooler string.)

---

## Logins and users

- **First run:** the app shows *Create the owner account*. That first account is the **owner**.
  After it exists, there is no public sign-up.
- **Logging in:** use your email **or** mobile number (10 digits is fine) and your password.
  A login lasts 30 days on that browser (`SESSION_DAYS` in `backend/.env`).
- **Staff logins:** the owner adds them under **Settings → Users** with a name, email and/or mobile
  number, and a starting password. Staff can bill, manage items and stock, and view invoices; only the
  owner can manage users.
- **Deactivate** a staff login to stop it working immediately (they are logged out everywhere).
  Their past bills are unaffected.
- **Change your password:** **Settings → Your account**. This logs out your other devices.
- **Staff forgot their password:** owner opens **Settings → Users → Set password**.
- **Owner forgot their password:** on the shop computer, in the project folder, run
  ```bash
  npm run user:reset-password
  ```
  Enter the email or mobile number, then the new password twice (it is hidden while you type).

How it is protected: passwords are stored only as scrypt hashes; the login is an httpOnly cookie
(page scripts can't read it) with SameSite protection; only a SHA-256 hash of each session token is
stored; repeated wrong passwords are slowed down (10 failed tries per 15 minutes); and every API
route except login, health check and the WhatsApp webhook requires a login.

## How billing, stock and money work

**Money is stored as whole paise.** ₹49.50 is `4950`. This avoids floating-point mistakes like
`0.1 + 0.2 = 0.30000000000000004`. Percentage discounts are stored in basis points
(12.5% = `1250`) and rounded to the nearest paisa.

**The server decides the price.** The browser only sends product IDs and quantities. The backend
loads current prices, recalculates every total, and rejects invalid discounts (more than the
subtotal, more than 100%, negative).

**Saving a bill is all-or-nothing.** One database transaction creates the customer, invoice,
invoice items, stock movements and payment. If any item does not have enough stock, nothing is
saved and stock is untouched.

**Stock is deducted exactly once — when the bill is saved**, for both Paid and Unpaid bills.
Each deduction uses a conditional update (`stock >= quantity`), so two bills saved at the same
moment cannot oversell. A unique database index on (invoice, product) makes a second deduction for
the same invoice impossible.

**Marking an invoice paid never changes stock.** It only updates the status and records a
payment. Clicking twice is harmless: the second click is refused with "already paid".

**Old invoices never change.** Invoice items store the product name, SKU and unit price at the
time of billing, so editing or deactivating a product later does not alter past bills.

**Dates use the shop's timezone** (`APP_TIMEZONE`, default `Asia/Kolkata`). "Today" means today in
India even if the server clock is in UTC. Weeks start on Monday. A custom range includes the whole
"to" day.

**Invoice numbers** are `INV-00001`, `INV-00002`, … generated inside the same transaction, so they
are unique and have no gaps from failed bills.

---

## WhatsApp sharing

After a bill is saved as **Paid** (or marked paid later), the app offers WhatsApp sharing for
customers with a mobile number.

### Manual sharing (works out of the box)

1. Click **Download PDF**.
2. Click **Open WhatsApp**. WhatsApp (app or web) opens with the customer's number and a message
   containing the invoice number and total, using a properly encoded `https://wa.me/` link.
3. **Attach the downloaded PDF yourself** and press Send. WhatsApp links cannot attach files.

The app records this as *"WhatsApp opened — sending not confirmed"*. It cannot know whether you
actually pressed Send.

### Automatic sending with the WhatsApp Business Cloud API (optional)

When configured, a **Send PDF automatically** button appears. The backend uploads the PDF and
sends it through Meta's official API. Your access token stays in `backend/.env` and is never sent to
the browser.

Statuses are kept honest:

| Shown in app | Meaning |
| --- | --- |
| Accepted by WhatsApp — delivery not yet confirmed | Meta's API accepted the message. |
| Sent / Delivered / Read | Confirmed later by Meta's webhook (only if you set one up). |
| Failed | The API call or delivery failed. The invoice is **not** affected. |

Setup outline:

1. At <https://developers.facebook.com> create an app (type **Business**) and add the **WhatsApp** product.
2. From **WhatsApp → API Setup** copy the **Phone number ID** and an **access token**
   (the temporary token expires in 24 hours; create a permanent System User token in Meta Business
   Settings for real use). While testing, add your own number as an allowed recipient.
3. Create a message template (category *Utility*) with a **Document** header and a body with two
   variables, for example: `Your invoice {{1}} for {{2}} is attached. Thank you!` Wait for approval.
   Without an approved template, WhatsApp only lets you message customers who wrote to you in the
   last 24 hours.
4. Fill in `backend/.env`:
   ```
   WHATSAPP_ACCESS_TOKEN="EAAG..."
   WHATSAPP_PHONE_NUMBER_ID="123456789012345"
   WHATSAPP_TEMPLATE_NAME="invoice_document"
   WHATSAPP_TEMPLATE_LANGUAGE="en"
   ```
5. Restart `npm run dev`. The backend checks the credentials with Meta; the button only appears when
   they are valid (status: `GET /api/whatsapp/status`).

**Delivery receipts (webhook) — advanced.** Meta must reach `POST /api/whatsapp/webhook` over public
HTTPS, with `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` set (signatures are verified).
Even with logins, keep the server private: put a reverse proxy in front that
forwards **only** `/api/whatsapp/webhook`. Without a webhook, automatic sends stay at "Accepted".

---

## REST API reference

Base URL: `http://127.0.0.1:4000/api`. All amounts are integers in **paise**. Errors return
`{ "error": "message" }` with a 4xx/5xx status.

All endpoints except `/health`, `/auth/status`, `/auth/login`, `/auth/setup`, `/auth/logout` and the
WhatsApp webhook need a logged-in session cookie (otherwise `401`).

| Method & path | Purpose |
| --- | --- |
| `GET /health` | Server and database check |
| `GET /auth/status` | Is first-run setup needed, who is logged in |
| `POST /auth/setup` | Create the owner account (only when there are no users) |
| `POST /auth/login` | `{ login: "email or mobile", password }` |
| `POST /auth/logout` | End this session |
| `POST /auth/change-password` | `{ currentPassword, newPassword }` |
| `GET, POST /auth/users` | List / add users (owner only) |
| `PATCH /auth/users/:id/status` | `{ isActive }` (owner only) |
| `POST /auth/users/:id/password` | Set a user's password (owner only) |
| `GET /customers?search=` | Saved customers for the billing dropdown |
| `GET /products?search=&includeInactive=true&lowStock=true` | List products |
| `GET /products/:id` | One product |
| `POST /products` | Create `{ name, sku?, pricePaise, stock, lowStockThreshold, description?, discountAllowed?, noPackaging?, packagingPaise? }` (discountAllowed defaults to true; packagingPaise null = shop rule) |
| `PUT /products/:id` | Update details (not stock) |
| `PATCH /products/:id/status` | `{ isActive: false }` to deactivate, `true` to reactivate |
| `GET /stock-adjustments?productId=&type=ADJUSTMENT\|SALE&limit=` | Stock history |
| `POST /stock-adjustments` | `{ productId, change: -2, reason }` |
| `GET /invoices?range=all\|today\|yesterday\|week\|month\|fy\|lastfy\|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&q=&status=PAID\|UNPAID&orderType=DINE_IN\|TAKEAWAY\|DELIVERY&page=&pageSize=` | List, filter and search |
| `GET /invoices/:id` | Invoice with items, payments and WhatsApp history |
| `POST /invoices` | Finalise a bill (see below) |
| `POST /invoices/:id/mark-paid` | `{ paymentMethod?: "UPI" }` or a split `{ payments: [{ method: "CASH", amountPaise: 30000 }, { method: "UPI", amountPaise: 20000 }] }` |
| `GET /held-carts` | Held bills (max 5) with item names and an estimated total |
| `POST /held-carts` | Hold a cart `{ customerName?, customerPhone?, discountType, discountValue, items: [{ productId, quantity }] }` (409 when 5 are already held) |
| `POST /held-carts/:id/recall` | Returns the held cart and removes it from the list |
| `DELETE /held-carts/:id` | Discard a held cart |
| `GET /invoices/:id/pdf` | Download PDF (`?inline=1` to view in browser) |
| `POST /invoices/:id/whatsapp/link` | Manual share: returns `{ url, message }` |
| `POST /invoices/:id/whatsapp/send` | Automatic send via Cloud API (202 accepted / 502 failed / 503 not configured) |
| `GET /invoices/:id/whatsapp` | WhatsApp history for an invoice |
| `GET /whatsapp/status` | Is automatic sending available? |
| `GET, POST /whatsapp/webhook` | Meta webhook (verification + delivery statuses) |
| `GET /dashboard?range=today\|yesterday\|week\|month\|fy\|lastfy\|all\|custom&from=&to=` | Dashboard figures for a period (default today) |
| `GET /settings`, `PUT /settings` | Business settings |
| `PUT /settings/packaging` | Owner only. `{ packagingMinPricePaise, packagingBoxPaise, packagingBagPaise, packagingOnTakeaway, packagingOnDelivery }` |

Example bill:

```json
POST /api/invoices
{
  "customerName": "Ravi",
  "customerPhone": "98765 43210",
  "items": [{ "productId": 1, "quantity": 2 }, { "productId": 3, "quantity": 1 }],
  "discountType": "PERCENT",
  "discountValue": 1000,
  "paymentMethod": "UPI",
  "paymentStatus": "PAID"
}
```

`discountType` is `NONE`, `FIXED` (value in paise, `5000` = ₹50) or `PERCENT` (value in basis points,
`1000` = 10%). The discount is worked out only on items whose product has `discountAllowed: true`;
a fixed discount can't be more than those items' total. For a split payment send `"paymentMethod": "SPLIT"`
with `"payments": [{ "method": "CASH", "amountPaise": 30000 }, { "method": "UPI", "amountPaise": 29010 }]`;
the amounts must add up exactly to the bill total. Send `"orderType": "TAKEAWAY"` or `"DELIVERY"` (default `"DINE_IN"`)
and optionally `"bagCount": 2`; the server adds box and bag charges from the rule in Settings, after the discount.
Phone numbers are stored with the country code (`919876543210`); 10-digit numbers get
`DEFAULT_COUNTRY_CODE` (91) added.

---

## Viewing and editing data in Supabase

See [`database/README.md`](database/README.md) for the Table Editor, SQL Editor, ready-made queries,
what is safe to edit by hand (and what is not), and backups.

---

## Troubleshooting

**`npm run dev` shows "DATABASE_URL is not set"**
You have not created `backend/.env`. Run `cp backend/.env.example backend/.env` and fill it in.

**The app says "Cannot reach the billing server"**
The backend is not running or crashed. Look at the terminal lines starting with `[api]`. Check
<http://127.0.0.1:4000/api/health>.

**`P1001: Can't reach database server` or connection timeouts**
- Use the **Session pooler** string (host ends in `pooler.supabase.com`, port `5432`). The "Direct
  connection" host (`db.xxxx.supabase.co`) needs IPv6, which many home networks lack.
- Your free project may be **paused** after inactivity: open the Supabase dashboard and click
  **Restore project**, wait a minute, retry.
- Check that the password in the URL is correct.

**`password authentication failed` / `Tenant or user not found`**
Wrong password, or the user part is wrong. For the pooler the user is `postgres.<project-ref>`, not
just `postgres`. Copy the string again from **Connect**.

**Password with special characters breaks the URL**
URL-encode them (`@`→`%40`, `#`→`%23`, `/`→`%2F`, `?`→`%3F`, `%`→`%25`), or reset the database password
to letters and numbers.

**`self-signed certificate in certificate chain`**
Remove any `sslmode=...` from your URLs (the app manages SSL itself). Keep `DATABASE_SSL` unset or
`require`.

**`npm run db:migrate` says a migration failed / tables already exist**
You may have created tables by hand. On a fresh project, delete them (Table Editor) or create a new
Supabase project and run `npm run db:migrate` again. Never run `database/schema.sql` by hand.

**`Prisma Client did not initialize yet` / `@prisma/client did not initialize`**
Run `npm run db:generate`, then restart `npm run dev`.

**Port already in use (`EADDRINUSE :4000` or `5173`)**
Another copy is running. Close other terminals, or find it with `lsof -i :4000` and stop it with
`kill <PID>`. Or set `PORT=4001` in `backend/.env` and `VITE_API_PROXY_TARGET=http://127.0.0.1:4001`
in `frontend/.env`.

**`Not enough stock for "…"` when saving a bill**
Someone else sold it first, or stock is lower than you think. Add stock on the Stock adjustment page,
or reduce the quantity.

**"Another product already uses this SKU"**
SKUs must be unique. Leave the SKU empty or choose a different one.

**Dates look one day off**
Set `APP_TIMEZONE` in `backend/.env` to your timezone (for India `Asia/Kolkata`) and restart.

**WhatsApp does not open**
Your browser may have blocked the pop-up: allow pop-ups for `localhost:5173`. The customer number must
include a valid mobile number. On a Mac without the WhatsApp app, WhatsApp Web opens instead.

**"Send PDF automatically" is not shown**
The Cloud API is not configured or the credentials were rejected. Open
<http://127.0.0.1:4000/api/whatsapp/status> to see the reason. Temporary tokens expire after 24 hours.

**Automatic send fails with "Recipient not in allowed list" or a template error**
In test mode Meta only sends to numbers you added in **API Setup**. Templates must be approved and
match the expected shape (Document header + two body variables).

**Tests say "database tests are SKIPPED"**
Set `TEST_DATABASE_URL` in `backend/.env` and run `npm run test:db:setup -w backend` (see
[Running the tests](#running-the-tests)).

**`npm install` warnings about vulnerabilities**
`npm audit` may report an advisory in `deepmerge-ts`, used only by the Prisma command-line tool while
running migrations (not by the running app). It cannot be fixed without changing Prisma's major
version and does not affect the app's data or network exposure.

**Everything feels slow (each action takes a second or more)**
Check where your Supabase project is: the host in `DATABASE_URL` shows the region, for example
`ap-southeast-2` = Sydney or `ap-south-1` = Mumbai. A far-away database adds a delay to every database
trip. Move it to Mumbai with the steps in [`DEPLOY.md`](DEPLOY.md).

**The app keeps going back to the login screen**
Your login expired or was ended (password changed, account deactivated). Log in again. If it happens
on every page, check that you open the app at <http://localhost:5173> (the login cookie belongs to that
address) and that your browser isn't blocking cookies for `localhost`.

**"Too many login attempts"**
Ten wrong passwords in 15 minutes pauses logins from that computer. Wait 15 minutes, or reset the
password with `npm run user:reset-password`.

**Fonts look different**
The interface loads the Instrument Sans font from Google Fonts and falls back to the system font when
offline. Everything still works.

---

## Not included yet

GST and tax calculations, barcode scanning, advanced reports, detailed staff permissions, password
reset by email/SMS, and deployment are not included yet.
