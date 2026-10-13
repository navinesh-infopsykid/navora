import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { notFound } from "../lib/errors";

export interface ProductInput {
  name: string;
  sku?: string | null;
  pricePaise: number;
  lowStockThreshold: number;
  description?: string | null;
  /** false = bill discounts never apply to this item. Defaults to true. */
  discountAllowed?: boolean;
}

export interface CreateProductInput extends ProductInput {
  /** Opening stock. Recorded in stock history as an adjustment. */
  stock: number;
}

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export async function listProducts(options: { search?: string; includeInactive?: boolean; lowStockOnly?: boolean }) {
  const where: Prisma.ProductWhereInput = {};
  if (!options.includeInactive) where.isActive = true;
  const search = options.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ];
  }
  const products = await prisma.product.findMany({ where, orderBy: [{ isActive: "desc" }, { name: "asc" }], take: 500 });
  return options.lowStockOnly ? products.filter((p) => p.stock <= p.lowStockThreshold) : products;
}

export async function getProduct(id: number) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw notFound("Product not found");
  return product;
}

export async function createProduct(input: CreateProductInput) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name.trim(),
        sku: clean(input.sku),
        pricePaise: input.pricePaise,
        stock: input.stock,
        lowStockThreshold: input.lowStockThreshold,
        description: clean(input.description),
        discountAllowed: input.discountAllowed ?? true,
      },
    });
    if (input.stock > 0) {
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: "ADJUSTMENT",
          previousStock: 0,
          change: input.stock,
          newStock: input.stock,
          reason: "Opening stock",
        },
      });
    }
    return product;
  });
}

/** Updates details only. Stock is changed through stock adjustments so history stays complete. */
export async function updateProduct(id: number, input: ProductInput) {
  await getProduct(id);
  return prisma.product.update({
    where: { id },
    data: {
      name: input.name.trim(),
      sku: clean(input.sku),
      pricePaise: input.pricePaise,
      lowStockThreshold: input.lowStockThreshold,
      description: clean(input.description),
      ...(input.discountAllowed === undefined ? {} : { discountAllowed: input.discountAllowed }),
    },
  });
}

/** Deactivate (hide from billing) or reactivate a product. Products are never deleted, so old invoices stay valid. */
export async function setProductActive(id: number, isActive: boolean) {
  await getProduct(id);
  return prisma.product.update({ where: { id }, data: { isActive } });
}
