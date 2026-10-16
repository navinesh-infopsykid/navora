import { Prisma } from "@prisma/client";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { config } from "../config";
import { getDateRange, type RangePreset } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, conflict, notFound } from "../lib/errors";
import { calculatePackaging, calculateTotals, rulesFromSettings, validatePaymentParts, type DiscountType, type OrderType } from "../lib/money";
import { normalizePhone } from "../lib/phone";
import { SETTINGS_ID } from "./settingsService";

export interface CreateInvoiceInput {
  customerName?: string | null;
  customerPhone?: string | null;
  items: { productId: number; quantity: number }[];
  discountType: DiscountType;
  /** FIXED: paise. PERCENT: basis points (1% = 100). NONE: 0. */
  discountValue: number;
  /** Used when the bill is paid with one method. Ignored when `payments` is given. */
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** Split payment, e.g. [{CASH, 30000}, {UPI, 20000}]. Must add up to the total. PAID bills only. */
  payments?: { method: PaymentMethod; amountPaise: number }[] | null;
  notes?: string | null;
  /** DINE_IN (default), TAKEAWAY or DELIVERY. Takeaway/delivery may add packaging (shop rule in Settings). */
  orderType?: OrderType;
  /** Carry bags for takeaway/delivery. At least 1 (mandatory); ignored for dine-in. */
  bagCount?: number | null;
}

/**
 * Decide the payment rows for a PAID bill and the method shown on the invoice.
 * One method -> that method. Several -> "SPLIT" (the rows hold the breakdown).
 */
function planPayments(totalPaise: number, method: PaymentMethod, parts?: { method: PaymentMethod; amountPaise: number }[] | null) {
  if (parts && parts.length > 0) {
    if (totalPaise === 0) throw badRequest("This bill is free (₹0), so there is nothing to split");
    const clean = validatePaymentParts(parts, totalPaise);
    return { invoiceMethod: (clean.length === 1 ? clean[0].method : "SPLIT") as PaymentMethod, rows: clean };
  }
  if (method === "SPLIT") throw badRequest("Enter the amount for each payment method");
  return { invoiceMethod: method, rows: [{ method, amountPaise: totalPaise }] };
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

/** Product columns needed for billing, read with a row lock (see createInvoice step 1). */
interface LockedProduct {
  id: number;
  name: string;
  sku: string | null;
  pricePaise: number;
  stock: number;
  isActive: boolean;
  discountAllowed: boolean;
  noPackaging: boolean;
  packagingPaise: number | null;
}

/**
 * Finalise a bill. Everything below happens in ONE database transaction:
 * customer, invoice, invoice items (with price snapshots), stock deduction,
 * stock movements and payment. If anything fails, nothing is saved.
 *
 * Stock is deducted here exactly once — for paid AND unpaid invoices.
 * Marking an invoice paid later (markInvoicePaid) never touches stock.
 *
 * Speed: every database call is a network round trip (Supabase is far away),
 * so this function uses a fixed number of queries however many items the bill has.
 */
export async function createInvoice(input: CreateInvoiceInput) {
  const items = mergeItems(input.items);
  if (items.length === 0) throw badRequest("Add at least one item to the bill");

  const customerPhone = normalizePhone(input.customerPhone, config.defaultCountryCode);
  const customerName = input.customerName?.trim() || "Walk-in Customer";
  const ids = items.map((i) => i.productId);

  return prisma.$transaction(
    async (tx) => {
      // 1. Load the products AND lock their rows until this bill is saved ("FOR UPDATE").
      //    Two counters billing the same item at the same moment simply wait for each other,
      //    so the stock numbers we read here are exact. Rows are locked in id order to avoid deadlocks.
      const products = await tx.$queryRaw<LockedProduct[]>`
        SELECT "id", "name", "sku", "pricePaise", "stock", "isActive", "discountAllowed", "noPackaging", "packagingPaise"
        FROM "Product"
        WHERE "id" IN (${Prisma.join(ids)})
        ORDER BY "id"
        FOR UPDATE`;
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const item of items) {
        const product = byId.get(item.productId);
        if (!product) throw badRequest(`Product #${item.productId} does not exist`);
        if (!product.isActive) throw badRequest(`"${product.name}" is deactivated and cannot be billed`);
        if (product.stock < item.quantity) {
          throw badRequest(`Not enough stock for "${product.name}". Available: ${product.stock}, requested: ${item.quantity}.`, {
            productId: product.id,
            available: product.stock,
            requested: item.quantity,
          });
        }
      }

      // 2. Next invoice number + the shop's packaging rule (one row). Incrementing the counter
      //    locks this row, so invoice numbers are never duplicated; a rollback gives the number back.
      const settings = await tx.businessSettings.upsert({
        where: { id: SETTINGS_ID },
        update: { nextInvoiceNumber: { increment: 1 } },
        create: { id: SETTINGS_ID, nextInvoiceNumber: 2 },
      });
      const serial = settings.nextInvoiceNumber - 1;
      const invoiceNumber = `${settings.invoicePrefix}-${String(serial).padStart(5, "0")}`;

      // 3. Calculate money on the server (prices come from the database, never from the browser).
      //    Packaging is added AFTER the discount, so it is never discounted.
      const lines = items.map((item) => ({ ...item, product: byId.get(item.productId)! }));
      const totals = calculateTotals(
        lines.map((l) => ({ unitPricePaise: l.product.pricePaise, quantity: l.quantity, discountAllowed: l.product.discountAllowed })),
        input.discountType,
        input.discountValue,
      );
      const orderType: OrderType = input.orderType ?? "DINE_IN";
      const packaging = calculatePackaging(
        lines.map((l) => ({
          unitPricePaise: l.product.pricePaise,
          quantity: l.quantity,
          noPackaging: l.product.noPackaging,
          packagingPaise: l.product.packagingPaise,
        })),
        orderType,
        rulesFromSettings(settings),
        input.bagCount,
      );
      const totalPaise = totals.totalPaise + packaging.totalPaise;
      const isPaid = input.paymentStatus === "PAID";
      if (!isPaid && input.payments?.length) throw badRequest("An unpaid bill can't have payments. Choose Paid, or remove the payments.");
      const plan = isPaid ? planPayments(totalPaise, input.paymentMethod, input.payments) : null;
      if (!isPaid && input.paymentMethod === "SPLIT") throw badRequest("Choose one payment method for an unpaid bill");

      // 4. Deduct stock for every line in ONE statement. "stock >= qty" is a final safety net.
      const values = Prisma.join(lines.map((l) => Prisma.sql`(${l.productId}::int, ${l.quantity}::int)`));
      const deducted = await tx.$executeRaw`
        UPDATE "Product" AS p
        SET "stock" = p."stock" - v.qty, "updatedAt" = NOW()
        FROM (VALUES ${values}) AS v(id, qty)
        WHERE p."id" = v.id AND p."stock" >= v.qty`;
      if (deducted !== lines.length) throw conflict("Stock changed while saving. Please try again.");

      // 5. Customer: reuse the same customer when the phone number matches.
      const customer = customerPhone
        ? await tx.customer.upsert({ where: { phone: customerPhone }, update: { name: customerName }, create: { name: customerName, phone: customerPhone } })
        : await tx.customer.create({ data: { name: customerName } });

      // 6. Invoice, then its items (names and prices are copied so old invoices never change).
      const now = new Date();
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
          orderType,
          boxCount: packaging.boxCount,
          packagingPaise: packaging.packagingPaise,
          bagCount: packaging.bagCount,
          bagPaise: packaging.bagPaise,
          totalPaise,
          paymentStatus: input.paymentStatus,
          paymentMethod: plan?.invoiceMethod ?? input.paymentMethod,
          paidAt: isPaid ? now : null,
          notes: input.notes?.trim() || null,
        },
      });
      const invoiceItems = await tx.invoiceItem.createManyAndReturn({
        data: lines.map((line, index) => ({
          invoiceId: invoice.id,
          productId: line.productId,
          productName: line.product.name,
          sku: line.product.sku,
          unitPricePaise: line.product.pricePaise,
          quantity: line.quantity,
          lineTotalPaise: totals.lineTotals[index],
          discountAllowed: line.product.discountAllowed,
          packagingPaise: packaging.linePackaging[index],
        })),
      });

      // 7. Stock history rows. The unique (invoiceId, productId) index guarantees one deduction per product per invoice.
      await tx.stockMovement.createMany({
        data: lines.map((line) => ({
          productId: line.productId,
          invoiceId: invoice.id,
          type: "SALE" as const,
          previousStock: line.product.stock,
          change: -line.quantity,
          newStock: line.product.stock - line.quantity,
          reason: `Sale ${invoiceNumber}`,
        })),
      });

      // 8. Payment records for bills paid at the counter (one row per method for split payments).
      const payments = plan
        ? await tx.payment.createManyAndReturn({
            data: plan.rows.map((row) => ({ invoiceId: invoice.id, amountPaise: row.amountPaise, method: row.method, paidAt: now })),
          })
        : [];

      // Same shape as getInvoice(), built from what we just saved (no extra database reads).
      return {
        ...invoice,
        items: invoiceItems.sort((a, b) => a.id - b.id),
        payments,
        whatsAppMessages: [],
      };
    },
    // Generous limits for a remote (Supabase) database.
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/**
 * Mark an unpaid invoice as paid. Records the payment(s). NEVER changes stock.
 * Pass one `paymentMethod`, or `payments` to split it (must add up to the total).
 * The update only matches an UNPAID invoice, so double-clicks are harmless.
 */
export async function markInvoicePaid(id: number, paymentMethod?: PaymentMethod, parts?: { method: PaymentMethod; amountPaise: number }[] | null) {
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      // Lock the row and check it is still unpaid.
      const invoice = await tx.invoice.update({
        where: { id, paymentStatus: "UNPAID" },
        data: { paymentStatus: "PAID", paidAt: now },
      });
      const plan = planPayments(invoice.totalPaise, paymentMethod ?? (parts?.length ? "SPLIT" : invoice.paymentMethod), parts);
      if (plan.invoiceMethod !== invoice.paymentMethod) {
        await tx.invoice.update({ where: { id }, data: { paymentMethod: plan.invoiceMethod } });
      }
      await tx.payment.createMany({
        data: plan.rows.map((row) => ({ invoiceId: id, amountPaise: row.amountPaise, method: row.method, paidAt: now })),
      });
    });
  } catch (error) {
    // No UNPAID invoice with this id: either it does not exist or it is already paid.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      const existing = await prisma.invoice.findUnique({ where: { id }, select: { invoiceNumber: true } });
      if (!existing) throw notFound("Invoice not found");
      throw conflict(`Invoice ${existing.invoiceNumber} is already paid`);
    }
    throw error;
  }
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
  orderType?: OrderType;
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
  if (query.orderType) where.orderType = query.orderType;

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
