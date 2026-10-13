-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'SPLIT';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "discountAllowed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN "discountAllowed" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "HeldCart" (
    "id" SERIAL NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeldCart_pkey" PRIMARY KEY ("id")
);
