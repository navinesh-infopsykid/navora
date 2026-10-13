import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../src/services/invoiceService";
import { hasTestDb, makeProduct, prisma, resetDatabase, loggedInAgent } from "./helpers";

describe.skipIf(!hasTestDb)("saved customers (database)", () => {
  beforeEach(resetDatabase);

  async function bill(customerName: string, customerPhone: string | null, productId: number) {
    return createInvoice({
      customerName,
      customerPhone,
      items: [{ productId, quantity: 1 }],
      discountType: "NONE",
      discountValue: 0,
      paymentMethod: "CASH",
      paymentStatus: "PAID",
    });
  }

  it("saves customers from bills and suggests them by name or phone, most recent first", async () => {
    const agent = await loggedInAgent();
    const p = await makeProduct({ stock: 50 });
    await bill("Meena Kumari", "98450 12345", p.id);
    await bill("Arjun", "9000011111", p.id);
    await bill("Walk-in Customer", null, p.id); // no phone -> not suggested
    await bill("Meena K", "+91 98450 12345", p.id); // same phone -> same customer, name updated, now most recent

    const all = await agent.get("/api/customers");
    expect(all.status).toBe(200);
    expect(all.body.map((c: { name: string }) => c.name)).toEqual(["Meena K", "Arjun"]);
    expect(all.body[0]).toMatchObject({ phone: "919845012345", invoiceCount: 2 });

    const byName = await agent.get("/api/customers").query({ search: "arj" });
    expect(byName.body.map((c: { name: string }) => c.name)).toEqual(["Arjun"]);

    const byPhone = await agent.get("/api/customers").query({ search: "98450" });
    expect(byPhone.body.map((c: { name: string }) => c.name)).toEqual(["Meena K"]);

    const formattedPhone = await agent.get("/api/customers").query({ search: "+91 90000" });
    expect(formattedPhone.body.map((c: { name: string }) => c.name)).toEqual(["Arjun"]);

    expect(await prisma.customer.count({ where: { phone: "919845012345" } })).toBe(1);
  });
});
