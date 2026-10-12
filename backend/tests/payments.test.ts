import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createInvoice, markInvoicePaid } from "../src/services/invoiceService";
import { hasTestDb, makeProduct, prisma, resetDatabase } from "./helpers";

describe.skipIf(!hasTestDb)("payment updates (database)", () => {
  beforeEach(resetDatabase);

  async function unpaidInvoice(stock = 10, quantity = 4) {
    const product = await makeProduct({ pricePaise: 2_500, stock });
    const invoice = await createInvoice({
      customerName: "Kumar",
      customerPhone: "9876500000",
      items: [{ productId: product.id, quantity }],
      discountType: "NONE",
      discountValue: 0,
      paymentMethod: "CASH",
      paymentStatus: "UNPAID",
    });
    return { product, invoice };
  }

  it("marks an unpaid invoice paid, records a payment and does NOT deduct stock again", async () => {
    const { product, invoice } = await unpaidInvoice();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(6);

    const paid = await markInvoicePaid(invoice.id, "UPI");
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.paymentMethod).toBe("UPI");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ amountPaise: 10_000, method: "UPI" });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(6); // unchanged
    expect(await prisma.stockMovement.count({ where: { type: "SALE" } })).toBe(1);
  });

  it("refuses to mark an invoice paid twice (even when requests race)", async () => {
    const { product, invoice } = await unpaidInvoice();
    const results = await Promise.allSettled([markInvoicePaid(invoice.id), markInvoicePaid(invoice.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(markInvoicePaid(invoice.id)).rejects.toThrow(/already paid/);
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(6);
  });

  it("works through the REST API", async () => {
    const app = createApp();
    const { invoice } = await unpaidInvoice();

    const first = await request(app).post(`/api/invoices/${invoice.id}/mark-paid`).send({ paymentMethod: "CARD" });
    expect(first.status).toBe(200);
    expect(first.body.paymentStatus).toBe("PAID");

    const second = await request(app).post(`/api/invoices/${invoice.id}/mark-paid`).send({});
    expect(second.status).toBe(409);

    const missing = await request(app).post(`/api/invoices/99999/mark-paid`).send({});
    expect(missing.status).toBe(404);

    const badMethod = await request(app).post(`/api/invoices/${invoice.id}/mark-paid`).send({ paymentMethod: "BITCOIN" });
    expect(badMethod.status).toBe(400);
  });

  it("WhatsApp sharing is only offered for paid invoices and never changes the invoice", async () => {
    const app = createApp();
    const { invoice } = await unpaidInvoice();

    const blocked = await request(app).post(`/api/invoices/${invoice.id}/whatsapp/link`);
    expect(blocked.status).toBe(409);

    await markInvoicePaid(invoice.id);
    const link = await request(app).post(`/api/invoices/${invoice.id}/whatsapp/link`);
    expect(link.status).toBe(201);
    expect(link.body.url).toMatch(/^https:\/\/wa\.me\/919876500000\?text=/);
    expect(decodeURIComponent(link.body.url.split("?text=")[1])).toContain(invoice.invoiceNumber);
    expect(link.body.record.status).toBe("LINK_GENERATED");

    // Cloud API is not configured in tests -> clear 503, invoice untouched.
    const send = await request(app).post(`/api/invoices/${invoice.id}/whatsapp/send`);
    expect(send.status).toBe(503);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(after.paymentStatus).toBe("PAID");
  });
});
