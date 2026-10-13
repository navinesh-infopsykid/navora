/**
 * Held carts: bills parked at the counter ("Hold") and finished later ("Recall").
 *
 * - At most MAX_HELD_CARTS at a time, shared by every device and login.
 * - Stock is NOT reserved. It is checked and deducted only when the bill is saved,
 *   so a held cart can never cause wrong stock numbers.
 * - Recall returns the cart and deletes it in one step, so two counters can't
 *   recall the same cart twice.
 */
import { Prisma, type DiscountType } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../lib/db";
import { conflict, notFound } from "../lib/errors";
import { normalizePhone } from "../lib/phone";

export const MAX_HELD_CARTS = 5;

export interface HeldCartInput {
  customerName?: string | null;
  customerPhone?: string | null;
  discountType: DiscountType;
  discountValue: number;
  items: { productId: number; quantity: number }[];
}

interface HeldItem {
  productId: number;
  quantity: number;
}

/** Held carts with item names and current prices filled in, oldest first. */
export async function listHeldCarts() {
  const carts = await prisma.heldCart.findMany({ orderBy: { createdAt: "asc" } });
  const ids = [...new Set(carts.flatMap((c) => (c.items as unknown as HeldItem[]).map((i) => i.productId)))];
  const products = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, pricePaise: true, isActive: true } })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  return carts.map((cart) => {
    const items = (cart.items as unknown as HeldItem[]).map((i) => ({ ...i, product: byId.get(i.productId) ?? null }));
    return {
      ...cart,
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      // Estimate before discount, at today's prices (the final bill is calculated when saved).
      estimatePaise: items.reduce((sum, i) => sum + (i.product?.pricePaise ?? 0) * i.quantity, 0),
    };
  });
}

export async function holdCart(input: HeldCartInput, createdByName?: string) {
  const items = input.items.filter((i) => i.quantity > 0).map((i) => ({ productId: i.productId, quantity: i.quantity }));
  return prisma.$transaction(async (tx) => {
    // Lock so two counters holding at the same moment can't go past the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(515151)`;
    const count = await tx.heldCart.count();
    if (count >= MAX_HELD_CARTS) {
      throw conflict(`You already have ${MAX_HELD_CARTS} held bills. Recall or delete one first.`);
    }
    return tx.heldCart.create({
      data: {
        customerName: input.customerName?.trim() || null,
        customerPhone: normalizePhone(input.customerPhone, config.defaultCountryCode),
        discountType: input.discountType,
        discountValue: input.discountType === "NONE" ? 0 : input.discountValue,
        items: items as unknown as Prisma.InputJsonValue,
        createdByName: createdByName ?? null,
      },
    });
  });
}

/** Returns the held cart and removes it from the list. */
export async function recallCart(id: number) {
  try {
    // Deleting returns the row, so only one device can ever recall a given cart.
    return await prisma.heldCart.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw notFound("This held bill was already recalled or deleted");
    }
    throw error;
  }
}

export async function deleteHeldCart(id: number) {
  const deleted = await prisma.heldCart.deleteMany({ where: { id } });
  if (deleted.count === 0) throw notFound("Held bill not found");
}
