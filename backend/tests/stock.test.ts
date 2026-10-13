import { beforeEach, describe, expect, it } from "vitest";
import { createProduct } from "../src/services/productService";
import { adjustStock } from "../src/services/stockService";
import { hasTestDb, makeProduct, prisma, resetDatabase, loggedInAgent } from "./helpers";

describe.skipIf(!hasTestDb)("stock adjustments (database)", () => {
  beforeEach(resetDatabase);

  it("records opening stock when a product is created", async () => {
    const p = await createProduct({ name: "Soap", pricePaise: 4_250, stock: 12, lowStockThreshold: 3 });
    const history = await prisma.stockMovement.findMany({ where: { productId: p.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ previousStock: 0, change: 12, newStock: 12, reason: "Opening stock" });
  });

  it("increases and decreases stock with full history", async () => {
    const p = await makeProduct({ stock: 5 });
    const up = await adjustStock({ productId: p.id, change: 10, reason: "New delivery" });
    expect(up.product.stock).toBe(15);
    expect(up.movement).toMatchObject({ previousStock: 5, change: 10, newStock: 15, reason: "New delivery", type: "ADJUSTMENT" });

    const down = await adjustStock({ productId: p.id, change: -4, reason: "Damaged" });
    expect(down.product.stock).toBe(11);
    expect(down.movement).toMatchObject({ previousStock: 15, change: -4, newStock: 11 });
  });

  it("prevents negative stock and saves nothing", async () => {
    const p = await makeProduct({ stock: 3 });
    await expect(adjustStock({ productId: p.id, change: -4, reason: "Lost" })).rejects.toThrow(/cannot go below zero/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("validates input through the REST API", async () => {
    const agent = await loggedInAgent();
    const p = await makeProduct({ stock: 3 });
    expect((await agent.post("/api/stock-adjustments").send({ productId: p.id, change: 0, reason: "x" })).status).toBe(400);
    expect((await agent.post("/api/stock-adjustments").send({ productId: p.id, change: 2, reason: "  " })).status).toBe(400);
    expect((await agent.post("/api/stock-adjustments").send({ productId: p.id, change: 1.5, reason: "x" })).status).toBe(400);
    expect((await agent.post("/api/stock-adjustments").send({ productId: 999, change: 1, reason: "x" })).status).toBe(404);
    const ok = await agent.post("/api/stock-adjustments").send({ productId: p.id, change: -3, reason: "Expired" });
    expect(ok.status).toBe(201);
    expect(ok.body.product.stock).toBe(0);
  });
});

describe.skipIf(!hasTestDb)("product API (database)", () => {
  beforeEach(resetDatabase);

  it("returns a friendly 409 for a duplicate SKU", async () => {
    const agent = await loggedInAgent();
    const body = { name: "Ghee", sku: "GHEE-1", pricePaise: 32_950, stock: 1, lowStockThreshold: 1 };
    expect((await agent.post("/api/products").send(body)).status).toBe(201);
    const dup = await agent.post("/api/products").send({ ...body, name: "Other" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("Another product already uses this SKU");
  });
});
