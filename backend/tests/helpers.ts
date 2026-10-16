import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

/** True when TEST_DATABASE_URL is configured. Database tests use describe.skipIf(!hasTestDb). */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

if (!hasTestDb) {
  console.warn("\n⚠ TEST_DATABASE_URL is not set — database tests are SKIPPED. See README 'Running tests'.\n");
}

/** Empties every table so each test starts clean. */
export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "HeldCart", "Session", "User", "WhatsAppMessage", "Payment", "StockMovement", "InvoiceItem", "Invoice", "Customer", "Product", "BusinessSettings" RESTART IDENTITY CASCADE`,
  );
}

export async function makeProduct(
  overrides: Partial<{
    name: string;
    sku: string | null;
    pricePaise: number;
    stock: number;
    isActive: boolean;
    discountAllowed: boolean;
    noPackaging: boolean;
    packagingPaise: number | null;
  }> = {},
) {
  return prisma.product.create({
    data: {
      name: overrides.name ?? "Test Product",
      sku: overrides.sku ?? null,
      pricePaise: overrides.pricePaise ?? 10_000,
      stock: overrides.stock ?? 10,
      lowStockThreshold: 2,
      isActive: overrides.isActive ?? true,
      discountAllowed: overrides.discountAllowed ?? true,
      noPackaging: overrides.noPackaging ?? false,
      packagingPaise: overrides.packagingPaise ?? null,
    },
  });
}

export { prisma };

export const TEST_PASSWORD = "test-password-123";

/** Creates a user directly in the database. */
export async function makeUser(overrides: Partial<{ name: string; email: string | null; phone: string | null; isOwner: boolean; isActive: boolean }> = {}) {
  return prisma.user.create({
    data: {
      name: overrides.name ?? "Owner",
      email: overrides.email === undefined ? "owner@shop.test" : overrides.email,
      phone: overrides.phone ?? null,
      isOwner: overrides.isOwner ?? true,
      isActive: overrides.isActive ?? true,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
}

/** A supertest agent that is logged in (keeps the session cookie between requests). */
export async function loggedInAgent(login = "owner@shop.test") {
  if (!(await prisma.user.count())) await makeUser();
  const agent = request.agent(createApp());
  const res = await agent.post("/api/auth/login").send({ login, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`Test login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
