-- Handy read-only queries. Paste them into Supabase -> SQL Editor -> New query -> Run.
-- Table and column names are case-sensitive, so keep the "double quotes".
-- Amounts are stored in PAISE: divide by 100 to get rupees.

-- 1. Today's invoices (India time)
SELECT "invoiceNumber", "customerName", round("totalPaise" / 100.0, 2) AS total_rupees, "paymentStatus", "invoiceDate"
FROM "Invoice"
WHERE ("invoiceDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
ORDER BY "invoiceDate" DESC;

-- 2. Products at or below their low-stock level
SELECT name, sku, stock, "lowStockThreshold"
FROM "Product"
WHERE "isActive" AND stock <= "lowStockThreshold"
ORDER BY stock;

-- 3. Full stock history for one product (change the name)
SELECT m."createdAt", m.type, m."previousStock", m.change, m."newStock", m.reason
FROM "StockMovement" m
JOIN "Product" p ON p.id = m."productId"
WHERE p.name ILIKE '%rice%'
ORDER BY m."createdAt" DESC;

-- 4. Unpaid invoices (money still to collect)
SELECT "invoiceNumber", "customerName", "customerPhone", round("totalPaise" / 100.0, 2) AS total_rupees, "invoiceDate"
FROM "Invoice"
WHERE "paymentStatus" = 'UNPAID'
ORDER BY "invoiceDate";

-- 5. Sales per day for the last 30 days
SELECT ("invoiceDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day,
       count(*) AS invoices,
       round(sum("totalPaise") / 100.0, 2) AS sales_rupees
FROM "Invoice"
WHERE "invoiceDate" > now() - interval '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- 6. Consistency check: product stock should equal the sum of its stock movements.
--    Any rows returned mean stock was edited outside the app.
SELECT p.id, p.name, p.stock, COALESCE(sum(m.change), 0) AS movements_total
FROM "Product" p
LEFT JOIN "StockMovement" m ON m."productId" = p.id
GROUP BY p.id
HAVING p.stock <> COALESCE(sum(m.change), 0);
