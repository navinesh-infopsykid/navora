import { beforeEach, describe, expect, it } from "vitest";
import { calculatePackaging, type PackagingRules } from "../src/lib/money";
import { getDashboard } from "../src/services/dashboardService";
import { createInvoice } from "../src/services/invoiceService";
import { buildInvoicePdf } from "../src/services/pdfService";
import { hasTestDb, loggedInAgent, makeProduct, makeUser, prisma, resetDatabase } from "./helpers";

// The shop's rule: Rs 5 box for every piece priced Rs 50 or more, Rs 5 carry bag per bill, takeaway + delivery.
const rules: PackagingRules = { minPricePaise: 5_000, boxPaise: 500, bagPaise: 500, onTakeaway: true, onDelivery: true };

describe("calculatePackaging (pure)", () => {
  it("charges a box for each piece at or above the limit, plus one mandatory bag", () => {
    const r = calculatePackaging(
      [
        { unitPricePaise: 12_000, quantity: 2 }, // Rs 120 x 2 -> 2 boxes
        { unitPricePaise: 6_000, quantity: 1 }, // Rs 60 -> 1 box
        { unitPricePaise: 3_000, quantity: 4 }, // Rs 30 -> under the limit, no box
      ],
      "TAKEAWAY",
      rules,
    );
    expect(r).toMatchObject({ applies: true, linePackaging: [1_000, 500, 0], boxCount: 3, packagingPaise: 1_500, bagCount: 1, bagPaise: 500, totalPaise: 2_000 });
  });

  it("treats exactly the limit as charged (Rs 50 or more)", () => {
    expect(calculatePackaging([{ unitPricePaise: 5_000, quantity: 1 }], "DELIVERY", rules).boxCount).toBe(1);
    expect(calculatePackaging([{ unitPricePaise: 4_999, quantity: 1 }], "DELIVERY", rules).boxCount).toBe(0);
  });

  it("charges nothing for dine-in, or for an order type switched off in Settings", () => {
    const lines = [{ unitPricePaise: 20_000, quantity: 3 }];
    expect(calculatePackaging(lines, "DINE_IN", rules)).toMatchObject({ applies: false, totalPaise: 0, bagCount: 0 });
    expect(calculatePackaging(lines, "TAKEAWAY", { ...rules, onTakeaway: false })).toMatchObject({ applies: false, totalPaise: 0 });
  });

  it("skips 'no packaging' items and uses an item's own box charge when set", () => {
    const r = calculatePackaging(
      [
        { unitPricePaise: 15_000, quantity: 2, noPackaging: true }, // drink: never packaged
        { unitPricePaise: 85_000, quantity: 1, packagingPaise: 3_000 }, // 1 kg cake: Rs 30 box
        { unitPricePaise: 2_000, quantity: 1, packagingPaise: 1_000 }, // custom charge applies even under the limit
      ],
      "DELIVERY",
      rules,
    );
    expect(r.linePackaging).toEqual([0, 3_000, 1_000]);
    expect(r.boxCount).toBe(2);
  });

  it("allows extra bags but never fewer than one", () => {
    expect(calculatePackaging([{ unitPricePaise: 100, quantity: 1 }], "TAKEAWAY", rules, 3)).toMatchObject({ bagCount: 3, bagPaise: 1_500 });
    expect(() => calculatePackaging([{ unitPricePaise: 100, quantity: 1 }], "TAKEAWAY", rules, 0)).toThrow(/at least one carry bag/);
    expect(() => calculatePackaging([{ unitPricePaise: 100, quantity: 1 }], "TAKEAWAY", rules, 21)).toThrow(/At most 20/);
  });
});

const base = { discountType: "NONE" as const, discountValue: 0, paymentMethod: "CASH" as const, paymentStatus: "PAID" as const };

describe.skipIf(!hasTestDb)("packaging on saved bills (database)", () => {
  beforeEach(resetDatabase);

  it("adds boxes and the bag to a takeaway bill, after the discount, and saves a snapshot", async () => {
    const pastry = await makeProduct({ name: "Black Forest", pricePaise: 12_000, stock: 10 });
    const cookie = await makeProduct({ name: "Cookie", pricePaise: 3_000, stock: 10 });

    const invoice = await createInvoice({
      ...base,
      orderType: "TAKEAWAY",
      discountType: "PERCENT",
      discountValue: 1_000, // 10% on items only
      items: [
        { productId: pastry.id, quantity: 2 },
        { productId: cookie.id, quantity: 4 },
      ],
    });

    // Items 240 + 120 = 360, discount 36, boxes 2 x 5 = 10, bag 5 -> 339
    expect(invoice).toMatchObject({
      orderType: "TAKEAWAY",
      subtotalPaise: 36_000,
      discountPaise: 3_600,
      boxCount: 2,
      packagingPaise: 1_000,
      bagCount: 1,
      bagPaise: 500,
      totalPaise: 33_900,
    });
    const lines = Object.fromEntries(invoice.items.map((i) => [i.productName, i.packagingPaise]));
    expect(lines).toEqual({ "Black Forest": 1_000, Cookie: 0 });
    expect(invoice.payments.map((p) => p.amountPaise)).toEqual([33_900]);

    // Changing the rule later never changes an old bill.
    await prisma.businessSettings.update({ where: { id: 1 }, data: { packagingBoxPaise: 2_000 } });
    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.totalPaise).toBe(33_900);
  });

  it("dine-in bills have no packaging, even if a bag count is sent", async () => {
    const pastry = await makeProduct({ pricePaise: 12_000 });
    const invoice = await createInvoice({ ...base, orderType: "DINE_IN", bagCount: 3, items: [{ productId: pastry.id, quantity: 1 }] });
    expect(invoice).toMatchObject({ orderType: "DINE_IN", packagingPaise: 0, bagPaise: 0, bagCount: 0, totalPaise: 12_000 });
  });

  it("a split payment must add up to the total including packaging", async () => {
    const pastry = await makeProduct({ pricePaise: 10_000 });
    const items = [{ productId: pastry.id, quantity: 1 }];
    // 100 + 5 box + 5 bag = 110
    await expect(
      createInvoice({ ...base, orderType: "DELIVERY", items, paymentMethod: "SPLIT", payments: [{ method: "CASH", amountPaise: 5_000 }, { method: "UPI", amountPaise: 5_000 }] }),
    ).rejects.toThrow(/add up to/);
    const ok = await createInvoice({
      ...base,
      orderType: "DELIVERY",
      items,
      paymentMethod: "SPLIT",
      payments: [{ method: "CASH", amountPaise: 6_000 }, { method: "UPI", amountPaise: 5_000 }],
    });
    expect(ok.totalPaise).toBe(11_000);
  });

  it("follows the rule saved in Settings (via the API), and reports packaging on the dashboard", async () => {
    const agent = await loggedInAgent();
    const res = await agent.put("/api/settings/packaging").send({
      packagingMinPricePaise: 10_000,
      packagingBoxPaise: 1_000,
      packagingBagPaise: 300,
      packagingOnTakeaway: false,
      packagingOnDelivery: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ packagingMinPricePaise: 10_000, packagingOnTakeaway: false });

    const pastry = await makeProduct({ pricePaise: 12_000, stock: 10 });
    const items = [{ productId: pastry.id, quantity: 2 }];
    const takeaway = await createInvoice({ ...base, orderType: "TAKEAWAY", items });
    expect(takeaway.totalPaise).toBe(24_000); // switched off for takeaway
    const delivery = await createInvoice({ ...base, orderType: "DELIVERY", items, bagCount: 2 });
    expect(delivery).toMatchObject({ packagingPaise: 2_000, bagPaise: 600, totalPaise: 26_600 });

    const dash = await getDashboard({ range: "today" });
    expect(dash.packaging).toEqual({ boxPaise: 2_000, bagPaise: 600, totalPaise: 2_600, boxCount: 2, bagCount: 2 });
    expect(dash.salesByOrderType).toEqual([
      { orderType: "DINE_IN", salesPaise: 0, count: 0 },
      { orderType: "TAKEAWAY", salesPaise: 24_000, count: 1 },
      { orderType: "DELIVERY", salesPaise: 26_600, count: 1 },
    ]);

    const list = await agent.get("/api/invoices").query({ orderType: "DELIVERY" });
    expect(list.body.invoices.map((i: { id: number }) => i.id)).toEqual([delivery.id]);
  });

  it("validates the order type and bag count over the API, and products save their packaging options", async () => {
    const agent = await loggedInAgent();
    const created = await agent
      .post("/api/products")
      .send({ name: "Cake 1 kg", pricePaise: 85_000, stock: 5, lowStockThreshold: 1, packagingPaise: 3_000, noPackaging: false });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ packagingPaise: 3_000, noPackaging: false });

    const bad = await agent.post("/api/invoices").send({ ...base, orderType: "PARCEL", items: [{ productId: created.body.id, quantity: 1 }] });
    expect(bad.status).toBe(400);
    const zeroBags = await agent.post("/api/invoices").send({ ...base, orderType: "DELIVERY", bagCount: 0, items: [{ productId: created.body.id, quantity: 1 }] });
    expect(zeroBags.status).toBe(400);

    const ok = await agent.post("/api/invoices").send({ ...base, orderType: "DELIVERY", items: [{ productId: created.body.id, quantity: 1 }] });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ packagingPaise: 3_000, bagPaise: 500, totalPaise: 88_500 });

    const pdf = await buildInvoicePdf(ok.body.id);
    expect(pdf.buffer.length).toBeGreaterThan(1_000);
  });

  it("only the owner can change the packaging rule", async () => {
    await makeUser({ name: "Staff", email: "staff@shop.test", isOwner: false });
    const staff = await loggedInAgent("staff@shop.test");
    const res = await staff.put("/api/settings/packaging").send({
      packagingMinPricePaise: 0,
      packagingBoxPaise: 0,
      packagingBagPaise: 0,
      packagingOnTakeaway: false,
      packagingOnDelivery: false,
    });
    expect(res.status).toBe(403);
  });

  it("held bills keep the order type and bags", async () => {
    const agent = await loggedInAgent();
    const p = await makeProduct();
    const held = await agent.post("/api/held-carts").send({ orderType: "DELIVERY", bagCount: 2, items: [{ productId: p.id, quantity: 1 }] });
    expect(held.status).toBe(201);
    const recalled = await agent.post(`/api/held-carts/${held.body.id}/recall`);
    expect(recalled.body).toMatchObject({ orderType: "DELIVERY", bagCount: 2 });
  });
});
