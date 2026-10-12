import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice, listInvoices } from "../src/services/invoiceService";
import { updateProduct } from "../src/services/productService";
import { hasTestDb, makeProduct, prisma, resetDatabase } from "./helpers";

describe.skipIf(!hasTestDb)("invoice creation and stock deduction (database)", () => {
  beforeEach(resetDatabase);

  it("creates customer, invoice, items, payment and stock movements in one go", async () => {
    const rice = await makeProduct({ name: "Rice", sku: "R1", pricePaise: 54_900, stock: 10 });
    const dal = await makeProduct({ name: "Dal", pricePaise: 16_250, stock: 5 });

    const invoice = await createInvoice({
      customerName: "Ravi",
      customerPhone: "98765 43210",
      items: [
        { productId: rice.id, quantity: 3 },
        { productId: dal.id, quantity: 1 },
      ],
      discountType: "PERCENT",
      discountValue: 1_000,
      paymentMethod: "UPI",
      paymentStatus: "PAID",
    });

    expect(invoice.invoiceNumber).toBe("INV-00001");
    expect(invoice.customerPhone).toBe("919876543210");
    expect(invoice.subtotalPaise).toBe(180_950);
    expect(invoice.discountPaise).toBe(18_095);
    expect(invoice.totalPaise).toBe(162_855);
    expect(invoice.items.map((i) => [i.productName, i.quantity, i.unitPricePaise])).toEqual([
      ["Rice", 3, 54_900],
      ["Dal", 1, 16_250],
    ]);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].amountPaise).toBe(162_855);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: rice.id } })).stock).toBe(7);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: dal.id } })).stock).toBe(4);

    const movements = await prisma.stockMovement.findMany({ where: { invoiceId: invoice.id }, orderBy: { productId: "asc" } });
    expect(movements.map((m) => [m.previousStock, m.change, m.newStock, m.type])).toEqual([
      [10, -3, 7, "SALE"],
      [5, -1, 4, "SALE"],
    ]);
    expect(movements[0].reason).toBe("Sale INV-00001");
  });

  it("numbers invoices sequentially and reuses customers by phone", async () => {
    const p = await makeProduct({ stock: 10 });
    const base = { items: [{ productId: p.id, quantity: 1 }], discountType: "NONE" as const, discountValue: 0, paymentMethod: "CASH" as const, paymentStatus: "PAID" as const };
    const a = await createInvoice({ ...base, customerName: "Asha", customerPhone: "9000000001" });
    const b = await createInvoice({ ...base, customerName: "Asha K", customerPhone: "+91 90000 00001" });
    const c = await createInvoice({ ...base });
    expect([a.invoiceNumber, b.invoiceNumber, c.invoiceNumber]).toEqual(["INV-00001", "INV-00002", "INV-00003"]);
    expect(a.customerId).toBe(b.customerId);
    expect(c.customerName).toBe("Walk-in Customer");
    expect(await prisma.customer.count()).toBe(2);
  });

  it("deducts stock for UNPAID invoices too, without a payment record", async () => {
    const p = await makeProduct({ stock: 5 });
    const invoice = await createInvoice({
      items: [{ productId: p.id, quantity: 2 }],
      discountType: "NONE",
      discountValue: 0,
      paymentMethod: "CASH",
      paymentStatus: "UNPAID",
    });
    expect(invoice.paymentStatus).toBe("UNPAID");
    expect(invoice.paidAt).toBeNull();
    expect(invoice.payments).toHaveLength(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
  });

  it("merges the same product added twice into one line and deducts once", async () => {
    const p = await makeProduct({ stock: 10 });
    const invoice = await createInvoice({
      items: [
        { productId: p.id, quantity: 2 },
        { productId: p.id, quantity: 3 },
      ],
      discountType: "NONE",
      discountValue: 0,
      paymentMethod: "CASH",
      paymentStatus: "PAID",
    });
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].quantity).toBe(5);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
    expect(await prisma.stockMovement.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("rejects the whole bill when any item lacks stock — nothing is saved", async () => {
    const ok = await makeProduct({ name: "Plenty", stock: 10 });
    const low = await makeProduct({ name: "Scarce", stock: 1 });

    await expect(
      createInvoice({
        customerName: "Test",
        customerPhone: "9111111111",
        items: [
          { productId: ok.id, quantity: 2 },
          { productId: low.id, quantity: 2 },
        ],
        discountType: "NONE",
        discountValue: 0,
        paymentMethod: "CASH",
        paymentStatus: "PAID",
      }),
    ).rejects.toThrow(/Not enough stock for "Scarce"/);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: ok.id } })).stock).toBe(10); // rolled back
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("rejects invalid discounts on the server", async () => {
    const p = await makeProduct({ pricePaise: 10_000, stock: 5 });
    const base = { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "CASH" as const, paymentStatus: "PAID" as const };
    await expect(createInvoice({ ...base, discountType: "FIXED", discountValue: 10_001 })).rejects.toThrow(/more than the subtotal/);
    await expect(createInvoice({ ...base, discountType: "PERCENT", discountValue: 10_001 })).rejects.toThrow(/100%/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it("rejects deactivated products", async () => {
    const p = await makeProduct({ stock: 5, isActive: false });
    await expect(
      createInvoice({ items: [{ productId: p.id, quantity: 1 }], discountType: "NONE", discountValue: 0, paymentMethod: "CASH", paymentStatus: "PAID" }),
    ).rejects.toThrow(/deactivated/);
  });

  it("never oversells when two bills are saved at the same time", async () => {
    const p = await makeProduct({ stock: 3 });
    const bill = () =>
      createInvoice({ items: [{ productId: p.id, quantity: 2 }], discountType: "NONE", discountValue: 0, paymentMethod: "CASH", paymentStatus: "PAID" });
    const results = await Promise.allSettled([bill(), bill()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1);
  });

  it("keeps the original item name and price after the product is edited", async () => {
    const p = await makeProduct({ name: "Old Name", pricePaise: 5_000, stock: 5 });
    const invoice = await createInvoice({ items: [{ productId: p.id, quantity: 1 }], discountType: "NONE", discountValue: 0, paymentMethod: "CASH", paymentStatus: "PAID" });

    await updateProduct(p.id, { name: "New Name", pricePaise: 9_900, lowStockThreshold: 1, sku: null, description: null });

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { items: true } });
    expect(reloaded.items[0].productName).toBe("Old Name");
    expect(reloaded.items[0].unitPricePaise).toBe(5_000);
    expect(reloaded.totalPaise).toBe(5_000);
  });

  it("database index blocks a second stock deduction for the same invoice and product", async () => {
    const p = await makeProduct({ stock: 5 });
    const invoice = await createInvoice({ items: [{ productId: p.id, quantity: 1 }], discountType: "NONE", discountValue: 0, paymentMethod: "CASH", paymentStatus: "UNPAID" });
    await expect(
      prisma.stockMovement.create({ data: { productId: p.id, invoiceId: invoice.id, type: "SALE", previousStock: 4, change: -1, newStock: 3, reason: "dup" } }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasTestDb)("invoice list date filtering (database)", () => {
  beforeEach(resetDatabase);

  it("filters by today / yesterday / week / month / custom in IST", async () => {
    const p = await makeProduct({ stock: 100 });
    const make = async (isoDate: string, status: "PAID" | "UNPAID" = "PAID") => {
      const inv = await createInvoice({ items: [{ productId: p.id, quantity: 1 }], discountType: "NONE", discountValue: 0, paymentMethod: "CASH", paymentStatus: status });
      await prisma.invoice.update({ where: { id: inv.id }, data: { invoiceDate: new Date(isoDate) } });
      return inv.invoiceNumber;
    };

    // "now" = Wed 14 Oct 2026, 10:00 IST
    const now = new Date("2026-10-14T04:30:00Z");
    const todayLateNight = await make("2026-10-14T18:00:00Z"); // 14 Oct 23:30 IST -> today
    const todayEarly = await make("2026-10-13T18:45:00Z", "UNPAID"); // 14 Oct 00:15 IST -> today (UTC date is the 13th!)
    const yesterday = await make("2026-10-13T10:00:00Z"); // 13 Oct 15:30 IST
    const monday = await make("2026-10-12T05:00:00Z"); // Mon 12 Oct -> this week
    const lastWeek = await make("2026-10-10T05:00:00Z"); // Sat 10 Oct -> this month, not this week
    const lastMonth = await make("2026-09-30T17:00:00Z"); // 30 Sep 22:30 IST -> previous month

    const numbers = async (range: "today" | "yesterday" | "week" | "month" | "all" | "custom", extra: object = {}) =>
      (await listInvoices({ range, page: 1, pageSize: 100, now, ...extra })).invoices.map((i) => i.invoiceNumber).sort();

    expect(await numbers("today")).toEqual([todayLateNight, todayEarly].sort());
    expect(await numbers("yesterday")).toEqual([yesterday]);
    expect(await numbers("week")).toEqual([todayLateNight, todayEarly, yesterday, monday].sort());
    expect(await numbers("month")).toEqual([todayLateNight, todayEarly, yesterday, monday, lastWeek].sort());
    expect(await numbers("custom", { from: "2026-09-30", to: "2026-10-10" })).toEqual([lastWeek, lastMonth].sort());
    expect(await numbers("all")).toHaveLength(6);

    const todayUnpaid = await listInvoices({ range: "today", status: "UNPAID", page: 1, pageSize: 100, now });
    expect(todayUnpaid.invoices.map((i) => i.invoiceNumber)).toEqual([todayEarly]);
    expect(todayUnpaid.summary.unpaidPaise).toBe(10_000);
  });

  it("searches by invoice number, customer name and phone", async () => {
    const p = await makeProduct({ stock: 100 });
    const base = { items: [{ productId: p.id, quantity: 1 }], discountType: "NONE" as const, discountValue: 0, paymentMethod: "CASH" as const, paymentStatus: "PAID" as const };
    await createInvoice({ ...base, customerName: "Meena Kumari", customerPhone: "9845012345" });
    await createInvoice({ ...base, customerName: "Arjun", customerPhone: "9000011111" });

    const search = async (q: string) => (await listInvoices({ range: "all", q, page: 1, pageSize: 50 })).invoices.map((i) => i.customerName);
    expect(await search("meena")).toEqual(["Meena Kumari"]);
    expect(await search("98450")).toEqual(["Meena Kumari"]);
    expect(await search("INV-00002")).toEqual(["Arjun"]);
  });
});
