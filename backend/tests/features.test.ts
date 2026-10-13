import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice, markInvoicePaid } from "../src/services/invoiceService";
import { getDashboard } from "../src/services/dashboardService";
import { hasTestDb, loggedInAgent, makeProduct, prisma, resetDatabase } from "./helpers";

const base = { discountType: "NONE" as const, discountValue: 0, paymentMethod: "CASH" as const, paymentStatus: "PAID" as const };

describe.skipIf(!hasTestDb)("per-item discount eligibility (database)", () => {
  beforeEach(resetDatabase);

  it("applies the bill discount only to items that allow it and remembers which lines were eligible", async () => {
    const cake = await makeProduct({ name: "Cake", pricePaise: 50_000, stock: 5, discountAllowed: true });
    const bun = await makeProduct({ name: "Bun", pricePaise: 10_000, stock: 5, discountAllowed: false });

    const invoice = await createInvoice({
      ...base,
      items: [
        { productId: cake.id, quantity: 1 },
        { productId: bun.id, quantity: 1 },
      ],
      discountType: "PERCENT",
      discountValue: 1_000, // 10%
    });

    expect(invoice.subtotalPaise).toBe(60_000);
    expect(invoice.discountPaise).toBe(5_000);
    expect(invoice.totalPaise).toBe(55_000);
    const flags = Object.fromEntries(invoice.items.map((i) => [i.productName, i.discountAllowed]));
    expect(flags).toEqual({ Cake: true, Bun: false });

    // Changing the item later doesn't change the old invoice.
    await prisma.product.update({ where: { id: bun.id }, data: { discountAllowed: true } });
    const reloaded = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: invoice.id, productId: bun.id } });
    expect(reloaded.discountAllowed).toBe(false);
  });

  it("products API saves the discount switch", async () => {
    const agent = await loggedInAgent();
    const created = await agent.post("/api/products").send({ name: "Bun", pricePaise: 4_900, stock: 3, lowStockThreshold: 1, discountAllowed: false });
    expect(created.status).toBe(201);
    expect(created.body.discountAllowed).toBe(false);
    const edited = await agent.put(`/api/products/${created.body.id}`).send({ name: "Bun", pricePaise: 4_900, lowStockThreshold: 1, discountAllowed: true });
    expect(edited.body.discountAllowed).toBe(true);
    const defaulted = await agent.post("/api/products").send({ name: "Cake", pricePaise: 9_900, stock: 1, lowStockThreshold: 1 });
    expect(defaulted.body.discountAllowed).toBe(true);
  });
});

describe.skipIf(!hasTestDb)("split payments (database)", () => {
  beforeEach(resetDatabase);

  it("records one payment per method and marks the invoice SPLIT", async () => {
    const p = await makeProduct({ pricePaise: 50_000, stock: 5 });
    const invoice = await createInvoice({
      ...base,
      items: [{ productId: p.id, quantity: 1 }],
      payments: [
        { method: "CASH", amountPaise: 30_000 },
        { method: "UPI", amountPaise: 20_000 },
      ],
    });
    expect(invoice.paymentMethod).toBe("SPLIT");
    expect(invoice.payments.map((x) => [x.method, x.amountPaise])).toEqual([
      ["CASH", 30_000],
      ["UPI", 20_000],
    ]);
  });

  it("a one-part 'split' is just that method", async () => {
    const p = await makeProduct({ pricePaise: 50_000, stock: 5 });
    const invoice = await createInvoice({ ...base, items: [{ productId: p.id, quantity: 1 }], payments: [{ method: "CARD", amountPaise: 50_000 }] });
    expect(invoice.paymentMethod).toBe("CARD");
    expect(invoice.payments).toHaveLength(1);
  });

  it("rejects parts that don't add up, and saves nothing", async () => {
    const p = await makeProduct({ pricePaise: 50_000, stock: 5 });
    await expect(
      createInvoice({
        ...base,
        items: [{ productId: p.id, quantity: 1 }],
        payments: [
          { method: "CASH", amountPaise: 30_000 },
          { method: "UPI", amountPaise: 10_000 },
        ],
      }),
    ).rejects.toThrow(/add up to/);
    expect(await prisma.invoice.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it("rejects payments on an unpaid bill and SPLIT without amounts", async () => {
    const p = await makeProduct({ pricePaise: 50_000, stock: 5 });
    await expect(
      createInvoice({ ...base, paymentStatus: "UNPAID", items: [{ productId: p.id, quantity: 1 }], payments: [{ method: "CASH", amountPaise: 50_000 }] }),
    ).rejects.toThrow(/unpaid bill can't have payments/);
    await expect(createInvoice({ ...base, paymentMethod: "SPLIT", items: [{ productId: p.id, quantity: 1 }] })).rejects.toThrow(/amount for each/);
  });

  it("marks an unpaid bill paid with a split, without touching stock", async () => {
    const p = await makeProduct({ pricePaise: 25_000, stock: 5 });
    const unpaid = await createInvoice({ ...base, paymentStatus: "UNPAID", items: [{ productId: p.id, quantity: 2 }] });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);

    await expect(markInvoicePaid(unpaid.id, undefined, [{ method: "CASH", amountPaise: 1_000 }])).rejects.toThrow(/add up to/);
    const stillUnpaid = await prisma.invoice.findUniqueOrThrow({ where: { id: unpaid.id } });
    expect(stillUnpaid.paymentStatus).toBe("UNPAID"); // failed attempt rolled back

    const paid = await markInvoicePaid(unpaid.id, undefined, [
      { method: "CARD", amountPaise: 40_000 },
      { method: "CASH", amountPaise: 10_000 },
    ]);
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.paymentMethod).toBe("SPLIT");
    expect(paid.payments).toHaveLength(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
  });

  it("works through the REST API", async () => {
    const agent = await loggedInAgent();
    const p = await makeProduct({ pricePaise: 50_000, stock: 5 });
    const res = await agent.post("/api/invoices").send({
      items: [{ productId: p.id, quantity: 1 }],
      paymentMethod: "SPLIT",
      paymentStatus: "PAID",
      payments: [
        { method: "UPI", amountPaise: 45_000 },
        { method: "CASH", amountPaise: 5_000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.paymentMethod).toBe("SPLIT");
    const pdf = await agent.get(`/api/invoices/${res.body.id}/pdf`);
    expect(pdf.status).toBe(200);
  });
});

describe.skipIf(!hasTestDb)("held carts (database)", () => {
  beforeEach(resetDatabase);

  it("holds up to 5 bills, lists them with names and estimates, recalls once, deletes", async () => {
    const agent = await loggedInAgent();
    const p = await makeProduct({ name: "Opera", pricePaise: 19_900, stock: 1 });

    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const res = await agent
        .post("/api/held-carts")
        .send({ customerName: `Customer ${i}`, customerPhone: "98765 4321" + (i % 10), items: [{ productId: p.id, quantity: i }], discountType: "PERCENT", discountValue: 500 });
      expect(res.status).toBe(201);
      ids.push(res.body.id);
    }
    const sixth = await agent.post("/api/held-carts").send({ items: [{ productId: p.id, quantity: 1 }] });
    expect(sixth.status).toBe(409);
    expect(sixth.body.error).toMatch(/5 held bills/);

    const list = await agent.get("/api/held-carts");
    expect(list.body).toHaveLength(5);
    expect(list.body[2]).toMatchObject({ customerName: "Customer 3", itemCount: 3, estimatePaise: 59_700, discountType: "PERCENT", discountValue: 500 });
    expect(list.body[2].items[0].product.name).toBe("Opera");

    // Holding doesn't reserve stock (stock is 1, cart 5 has 5 of it).
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1);

    const recalled = await agent.post(`/api/held-carts/${ids[0]}/recall`);
    expect(recalled.status).toBe(200);
    expect(recalled.body.customerPhone).toBe("919876543211");
    expect((await agent.post(`/api/held-carts/${ids[0]}/recall`)).status).toBe(404); // only once

    expect((await agent.delete(`/api/held-carts/${ids[1]}`)).status).toBe(204);
    expect((await agent.get("/api/held-carts")).body).toHaveLength(3);
  });

  it("rejects empty carts and requires login", async () => {
    const agent = await loggedInAgent();
    expect((await agent.post("/api/held-carts").send({ items: [] })).status).toBe(400);
    const { default: request } = await import("supertest");
    const { createApp } = await import("../src/app");
    expect((await request(createApp()).get("/api/held-carts")).status).toBe(401);
  });
});

describe.skipIf(!hasTestDb)("dashboard period filter (database)", () => {
  beforeEach(resetDatabase);

  it("totals bills made in the period and money received by method", async () => {
    const p = await makeProduct({ pricePaise: 10_000, stock: 100 });
    const bill = async (iso: string, extra: object = {}) => {
      const inv = await createInvoice({ ...base, items: [{ productId: p.id, quantity: 1 }], ...extra });
      await prisma.invoice.update({ where: { id: inv.id }, data: { invoiceDate: new Date(iso) } });
      await prisma.payment.updateMany({ where: { invoiceId: inv.id }, data: { paidAt: new Date(iso) } });
      return inv;
    };
    const now = new Date("2026-10-14T06:30:00Z"); // Wed 14 Oct 2026, 12:00 IST
    await bill("2026-10-14T04:00:00Z"); // today, cash 100
    await bill("2026-10-14T05:00:00Z", {
      payments: [
        { method: "CASH", amountPaise: 4_000 },
        { method: "UPI", amountPaise: 6_000 },
      ],
    }); // today, split
    await bill("2026-10-14T05:30:00Z", { paymentStatus: "UNPAID" }); // today, unpaid
    await bill("2026-10-13T05:00:00Z", { paymentMethod: "CARD" }); // yesterday

    const today = await getDashboard({ range: "today", now });
    expect(today.sales).toMatchObject({ invoiceCount: 3, salesPaise: 30_000, paidPaise: 20_000, unpaidPaise: 10_000, averageBillPaise: 10_000 });
    expect(Object.fromEntries(today.receivedByMethod.map((r) => [r.method, r.amountPaise]))).toEqual({ CASH: 14_000, UPI: 6_000, CARD: 0, OTHER: 0 });
    expect(today.recentInvoices).toHaveLength(3);

    const yesterday = await getDashboard({ range: "custom", from: "2026-10-13", to: "2026-10-13", now });
    expect(yesterday.sales.invoiceCount).toBe(1);
    expect(yesterday.receivedByMethod.find((r) => r.method === "CARD")?.amountPaise).toBe(10_000);

    const week = await getDashboard({ range: "week", now });
    expect(week.sales.invoiceCount).toBe(4);
    expect(week.outstandingUnpaid).toEqual({ totalPaise: 10_000, count: 1 });

    const agent = await loggedInAgent();
    const res = await agent.get("/api/dashboard").query({ range: "custom", from: "2026-10-13", to: "2026-10-14" });
    expect(res.status).toBe(200);
    expect(res.body.sales.invoiceCount).toBe(4);
    expect((await agent.get("/api/dashboard").query({ range: "custom", from: "2026-10-14" })).status).toBe(400);
  });
});
