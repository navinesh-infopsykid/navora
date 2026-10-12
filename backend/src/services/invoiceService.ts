import { Prisma } from "@prisma/client";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { config } from "../config";
import { getDateRange, type RangePreset } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, conflict, notFound } from "../lib/errors";
import { calculateTotals, type DiscountType } from "../lib/money";
import { normalizePhone } from "../lib/phone";
import { SETTINGS_ID } from "./settingsService";

export interface CreateInvoiceInput {
  customerName?: string | null;
  customerPhone?: string | null;
  items: { productId: number; quantity: number }[];
  discountType: DiscountType;
  /** FIXED: paise. PERCENT: basis points (1% = 100). NONE: 0. */
  discountValue: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  notes?: string | null;
}

export const invoiceDetailInclude = {
  items: { orderBy: { id: "asc" } },
  payments: { orderBy: { paidAt: "asc" } },
  whatsAppMessages: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.InvoiceInclude;

/** Merge duplicate product lines (same product added twice) into one line. */
function mergeItems(items: CreateInvoiceInput["items"]) {
  const merged = new Map<number, number>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw badRequest("Quantity must be a whole number greater than zero");
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  // Sorting by id makes every transaction lock product rows in the same order (avoids deadlocks).
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Finalise a bill. Everything below happens in ONE database transaction:
 * customer, invoice, invoice items (with price snapshots), stock deduction,
 * stock movements and payment. If anything fails, nothing is saved.
 *
 * Stock is deducted here exactly once — for paid AND unpaid invoices.
 * Marking an invoice paid later (markInvoicePaid) never touches stock.
 */
export async function createInvoice(input: CreateInvoiceInput) {
  const items = mergeItems(input.items);
  if (items.length === 0) throw badRequest("Add at least one item to the bill");

  const customerPhone = normalizePhone(input.customerPhone, config.defaultCountryCode);
  const customerName = input.customerName?.trim() || "Walk-in Customer";

  const invoiceId = await prisma.$transaction(
    async (tx) => {
      // 1. Load current product details (prices come from the database, never from the browser).
      const products = await tx.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const item of items) {
        const product = byId.get(item.productId);
        if (!product) throw badRequest(`Product #${item.productId} does not exist`);
        if (!product.isActive) throw badRequest(`"${product.name}" is deactivated and cannot be billed`);
      }

      // 2. Calculate money on the server (validates discount).
      const lines = items.map((item) => ({ ...item, product: byId.get(item.productId)! }));
      const totals = calculateTotals(
        lines.map((l) => ({ unitPricePaise: l.product.pricePaise, quantity: l.quantity })),
        input.discountType,
        input.discountValue,
      );

      // 3. Deduct stock. The conditional update fails safely if stock is too low,
      //    even when two bills are being saved at the same moment.
      const movements: Prisma.StockMovementCreateManyInput[] = [];
      for (const line of lines) {
        const result = await tx.product.updateMany({
          where: { id: line.productId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (result.count === 0) {
          const current = await tx.product.findUnique({ where: { id: line.productId }, select: { stock: true } });
          throw badRequest(`Not enough stock for "${line.product.name}". Available: ${current?.stock ?? 0}, requested: ${line.quantity}.`, {
            productId: line.productId,
            available: current?.stock ?? 0,
            requested: line.quantity,
          });
        }
        const after = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { stock: true } });
        movements.push({
          productId: line.productId,
          type: "SALE",
          previousStock: after.stock + line.quantity,
          change: -line.quantity,
          newStock: after.stock,
          reason: "Sale", // invoice number is filled in below
        });
      }

      // 4. Customer: reuse the same customer when the phone number matches.
      const customer = customerPhone
        ? await tx.customer.upsert({ where: { phone: customerPhone }, update: { name: customerName }, create: { name: customerName, phone: customerPhone } })
        : await tx.customer.create({ data: { name: customerName } });

      // 5. Next invoice number. Incrementing this row locks it, so numbers are never duplicated.
      const settings = await tx.businessSettings.upsert({
        where: { id: SETTINGS_ID },
        update: { nextInvoiceNumber: { increment: 1 } },
        create: { id: SETTINGS_ID, nextInvoiceNumber: 2 },
      });
      const serial = settings.nextInvoiceNumber - 1;
      const invoiceNumber = `${settings.invoicePrefix}-${String(serial).padStart(5, "0")}`;

      // 6. Invoice + items (names and prices are copied so old invoices never change).
      const now = new Date();
      const isPaid = input.paymentStatus === "PAID";
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: customer.id,
          customerName,
          customerPhone,
          invoiceDate: now,
          subtotalPaise: totals.subtotalPaise,
          discountType: input.discountType,
          discountValue: input.discountType === "NONE" ? 0 : input.discountValue,
          discountPaise: totals.discountPaise,
          totalPaise: totals.totalPaise,
          paymentStatus: input.paymentStatus,
          paymentMethod: input.paymentMethod,
          paidAt: isPaid ? now : null,
          notes: input.notes?.trim() || null,
          items: {
            create: lines.map((line, index) => ({
              productId: line.productId,
              productName: line.product.name,
              sku: line.product.sku,
              unitPricePaise: line.product.pricePaise,
              quantity: line.quantity,
              lineTotalPaise: totals.lineTotals[index],
            })),
          },
        },
      });

      // 7. Stock history rows. The unique (invoiceId, productId) index guarantees one deduction per product per invoice.
      await tx.stockMovement.createMany({
        data: movements.map((m) => ({ ...m, invoiceId: invoice.id, reason: `Sale ${invoiceNumber}` })),
      });

      // 8. Payment record for bills paid at the counter.
      if (isPaid) {
        await tx.payment.create({ data: { invoiceId: invoice.id, amountPaise: totals.totalPaise, method: input.paymentMethod, paidAt: now } });
      }

      return invoice.id;
    },
    // Generous limits for a remote (Supabase) database.
    { maxWait: 10_000, timeout: 20_000 },
  );
  // Load the full invoice after the transaction has committed.
  return getInvoice(invoiceId);
}

/**
 * Mark an unpaid invoice as paid. Records a payment. NEVER changes stock.
 * The conditional update (only if still UNPAID) makes double-clicks harmless.
 */
export async function markInvoicePaid(id: number, paymentMethod?: PaymentMethod) {
  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) throw notFound("Invoice not found");

    const now = new Date();
    const method = paymentMethod ?? invoice.paymentMethod;
    const result = await tx.invoice.updateMany({
      where: { id, paymentStatus: "UNPAID" },
      data: { paymentStatus: "PAID", paymentMethod: method, paidAt: now },
    });
    if (result.count === 0) throw conflict(`Invoice ${invoice.invoiceNumber} is already paid`);

    await tx.payment.create({ data: { invoiceId: id, amountPaise: invoice.totalPaise, method, paidAt: now } });
  });
  return getInvoice(id);
}

export async function getInvoice(id: number) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: invoiceDetailInclude });
  if (!invoice) throw notFound("Invoice not found");
  return invoice;
}

export interface InvoiceListQuery {
  range: RangePreset;
  from?: string;
  to?: string;
  q?: string;
  status?: PaymentStatus;
  page: number;
  pageSize: number;
  now?: Date;
}

/** Builds the WHERE clause for the invoice list (exported for tests). */
export function buildInvoiceWhere(query: Omit<InvoiceListQuery, "page" | "pageSize">): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {};
  const range = getDateRange(query.range, { from: query.from, to: query.to, now: query.now, timeZone: config.timezone });
  if (range) where.invoiceDate = { gte: range.start, lt: range.end };
  if (query.status) where.paymentStatus = query.status;

  const q = query.q?.trim();
  if (q) {
    const or: Prisma.InvoiceWhereInput[] = [
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ];
    const digits = q.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ customerPhone: { contains: digits } });
    where.OR = or;
  }
  return where;
}

export async function listInvoices(query: InvoiceListQuery) {
  const where = buildInvoiceWhere(query);
  const [invoices, total, sums] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { items: { select: { productName: true, quantity: true, unitPricePaise: true } } },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({ by: ["paymentStatus"], where, _sum: { totalPaise: true } }),
  ]);

  const sumFor = (status: PaymentStatus) => sums.find((s) => s.paymentStatus === status)?._sum.totalPaise ?? 0;
  return {
    invoices,
    total,
    page: query.page,
    pageSize: query.pageSize,
    summary: { paidPaise: sumFor("PAID"), unpaidPaise: sumFor("UNPAID"), totalPaise: sumFor("PAID") + sumFor("UNPAID") },
  };
}
