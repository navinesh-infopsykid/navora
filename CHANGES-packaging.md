# Update: order type + packaging charges

Rule (editable in Settings → Packaging charges, owner only):
- Takeaway and Delivery: ₹5 carry bag on every bill (mandatory; staff can add more bags)
- plus ₹5 box for each item priced ₹50 or more (per piece)
- Dine-in: no packaging. Packaging is never discounted. Old bills are unchanged.
- Per item (Items page): "No packaging" tick, or an own box charge (e.g. ₹30 for a cake box).

Database: one new migration `backend/prisma/migrations/20261016000000_packaging` (adds columns only).
Run `npm run db:migrate` on production BEFORE deploying.

Files changed:
- backend/prisma/schema.prisma, backend/prisma/migrations/20261016000000_packaging/migration.sql (new)
- backend/src/lib/money.ts (calculatePackaging), backend/src/lib/validation.ts
- backend/src/services/invoiceService.ts, productService.ts, settingsService.ts, heldCartService.ts, dashboardService.ts, pdfService.ts, whatsappService.ts
- backend/src/routes/invoices.ts, products.ts, heldCarts.ts, misc.ts
- backend/tests/packaging.test.ts (new), backend/tests/helpers.ts
- frontend/src/lib/api.ts, money.ts, format.ts
- frontend/src/pages/Billing.tsx, Items.tsx, Settings.tsx, InvoiceDetail.tsx, Invoices.tsx, Dashboard.tsx
- README.md
