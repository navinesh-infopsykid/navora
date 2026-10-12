import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { badRequest, notFound } from "../lib/errors";

export interface AdjustmentInput {
  productId: number;
  /** Positive to add stock, negative to remove stock. */
  change: number;
  reason: string;
}

/**
 * Adjust a product's stock and record the change, in one transaction.
 *
 * The decrease uses a conditional update ("only if stock >= amount"), so two
 * people adjusting at the same time can never push stock below zero.
 */
export async function adjustStock(input: AdjustmentInput) {
  if (!Number.isInteger(input.change) || input.change === 0) throw badRequest("Adjustment must be a non-zero whole number");
  const reason = input.reason.trim();
  if (!reason) throw badRequest("Please enter a reason for the adjustment");

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound("Product not found");

    const where: Prisma.ProductWhereInput = { id: input.productId };
    if (input.change < 0) where.stock = { gte: -input.change };

    const result = await tx.product.updateMany({ where, data: { stock: { increment: input.change } } });
    if (result.count === 0) {
      const current = await tx.product.findUnique({ where: { id: input.productId }, select: { stock: true } });
      throw badRequest(
        `Cannot remove ${-input.change}. Only ${current?.stock ?? 0} in stock — stock cannot go below zero.`,
      );
    }

    // Our update has locked the row, so this read is consistent.
    const updated = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
    const movement = await tx.stockMovement.create({
      data: {
        productId: input.productId,
        type: "ADJUSTMENT",
        previousStock: updated.stock - input.change,
        change: input.change,
        newStock: updated.stock,
        reason,
      },
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    return { product: updated, movement };
  });
}

export async function listStockMovements(options: { productId?: number; type?: "ADJUSTMENT" | "SALE"; limit?: number }) {
  return prisma.stockMovement.findMany({
    where: { productId: options.productId, type: options.type },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 100, 500),
    include: {
      product: { select: { id: true, name: true, sku: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
    },
  });
}
