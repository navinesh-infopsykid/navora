import { prisma } from "../src/lib/db";

/** True when TEST_DATABASE_URL is configured. Database tests use describe.skipIf(!hasTestDb). */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDb) {
  console.warn("\n⚠ TEST_DATABASE_URL is not set — database tests are SKIPPED. See README 'Running tests'.\n");
}

/** Empties every table so each test starts clean. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "WhatsAppMessage", "Payment", "StockMovement", "InvoiceItem", "Invoice", "Customer", "Product", "BusinessSettings" RESTART IDENTITY CASCADE`,
  );
}

export async function makeProduct(overrides: Partial<{ name: string; sku: string | null; pricePaise: number; stock: number; isActive: boolean }> = {}) {
  return prisma.product.create({
    data: {
      name: overrides.name ?? "Test Product",
      sku: overrides.sku ?? null,
      pricePaise: overrides.pricePaise ?? 10_000,
      stock: overrides.stock ?? 10,
      lowStockThreshold: 2,
      isActive: overrides.isActive ?? true,
    },
  });
}

export { prisma };
