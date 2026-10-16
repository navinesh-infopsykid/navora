-- Order type + packaging charges (boxes and carry bag) for takeaway and delivery.
-- Only adds columns with defaults: existing bills become DINE_IN with no packaging, and totals are unchanged.

CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'DELIVERY');

ALTER TABLE "Product" ADD COLUMN "noPackaging" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "packagingPaise" INTEGER;

ALTER TABLE "Invoice" ADD COLUMN "orderType" "OrderType" NOT NULL DEFAULT 'DINE_IN',
ADD COLUMN "boxCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "packagingPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bagCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bagPaise" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "InvoiceItem" ADD COLUMN "packagingPaise" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "BusinessSettings" ADD COLUMN "packagingMinPricePaise" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN "packagingBoxPaise" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "packagingBagPaise" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "packagingOnTakeaway" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "packagingOnDelivery" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "HeldCart" ADD COLUMN "orderType" "OrderType" NOT NULL DEFAULT 'DINE_IN',
ADD COLUMN "bagCount" INTEGER NOT NULL DEFAULT 0;
