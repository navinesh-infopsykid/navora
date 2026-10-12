import crypto from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { createInvoice } from "../src/services/invoiceService";
import { resetWhatsAppStatusCache, sendInvoiceViaCloudApi } from "../src/services/whatsappService";
import { hasTestDb, makeProduct, prisma, resetDatabase } from "./helpers";

/** Fake Meta Graph API: answers by URL. Never touches the network. */
function fakeGraph(options: { failSend?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("fields=display_phone_number")) return json(200, { display_phone_number: "+91 90000 00000" });
    if (url.endsWith("/media")) return json(200, { id: "media-123" });
    if (url.endsWith("/messages")) {
      return options.failSend ? json(400, { error: { message: "Recipient not in allowed list" } }) : json(200, { messages: [{ id: "wamid.ABC" }] });
    }
    return json(404, {});
  });
}

describe.skipIf(!hasTestDb)("WhatsApp Cloud API (mocked, database)", () => {
  beforeEach(async () => {
    await resetDatabase();
    config.whatsapp.accessToken = "test-token";
    config.whatsapp.phoneNumberId = "1234567890";
    config.whatsapp.appSecret = "app-secret";
    resetWhatsAppStatusCache();
  });

  afterEach(() => {
    config.whatsapp.accessToken = "";
    config.whatsapp.phoneNumberId = "";
    config.whatsapp.appSecret = "";
    resetWhatsAppStatusCache();
    vi.unstubAllGlobals();
  });

  async function paidInvoice() {
    const p = await makeProduct({ stock: 5 });
    return createInvoice({
      customerName: "Lata",
      customerPhone: "9123456780",
      items: [{ productId: p.id, quantity: 1 }],
      discountType: "NONE",
      discountValue: 0,
      paymentMethod: "CASH",
      paymentStatus: "PAID",
    });
  }

  it("records ACCEPTED (not delivered) when WhatsApp accepts the message, then webhook confirms delivery", async () => {
    vi.stubGlobal("fetch", fakeGraph());
    const invoice = await paidInvoice();

    const record = await sendInvoiceViaCloudApi(invoice.id);
    expect(record).toMatchObject({ status: "ACCEPTED", providerMessageId: "wamid.ABC", mode: "CLOUD_API", phone: "919123456780" });

    const payload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.ABC", status: "delivered" }] } }] }] });
    const signature = "sha256=" + crypto.createHmac("sha256", "app-secret").update(payload).digest("hex");
    const app = createApp();
    const res = await request(app).post("/api/whatsapp/webhook").set("content-type", "application/json").set("x-hub-signature-256", signature).send(payload);
    expect(res.status).toBe(200);
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: record.id } })).status).toBe("DELIVERED");

    const unsigned = await request(app).post("/api/whatsapp/webhook").set("content-type", "application/json").send(payload);
    expect(unsigned.status).toBe(401);
  });

  it("a WhatsApp failure is recorded but the invoice stays saved and unchanged", async () => {
    vi.stubGlobal("fetch", fakeGraph({ failSend: true }));
    const invoice = await paidInvoice();
    const app = createApp();

    const res = await request(app).post(`/api/invoices/${invoice.id}/whatsapp/send`);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: "FAILED", error: "Recipient not in allowed list" });

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { items: true } });
    expect(after.paymentStatus).toBe("PAID");
    expect(after.totalPaise).toBe(invoice.totalPaise);
    expect(after.items).toHaveLength(1);
  });

  it("status endpoint never exposes the access token", async () => {
    vi.stubGlobal("fetch", fakeGraph());
    const res = await request(createApp()).get("/api/whatsapp/status");
    expect(res.body.enabled).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("test-token");
  });
});
