import { config } from "../config";
import { getDateRange, type RangePreset } from "../lib/dates";
import { prisma } from "../lib/db";

export interface DashboardQuery {
  range: RangePreset;
  from?: string;
  to?: string;
  now?: Date;
}

/**
 * Dashboard figures for one period (today, yesterday, this week, this month, a day or a custom range).
 *
 * - Sales / paid / unpaid / invoice count: bills MADE in the period.
 * - Received by method: money COLLECTED in the period (cash drawer view). A split bill
 *   counts towards each method it was paid with; an old bill paid today counts today.
 */
export async function getDashboard(query: DashboardQuery = { range: "today" }) {
  // "all" has no dates; treat it as everything.
  const range = getDateRange(query.range, { from: query.from, to: query.to, now: query.now, timeZone: config.timezone });
  const invoiceDate = range ? { gte: range.start, lt: range.end } : undefined;
  const paidAt = range ? { gte: range.start, lt: range.end } : undefined;

  const [groups, received, outstanding, activeProducts, recentInvoices, byOrderType] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["paymentStatus"],
      where: { invoiceDate },
      _sum: { totalPaise: true, discountPaise: true, packagingPaise: true, bagPaise: true, boxCount: true, bagCount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({ by: ["method"], where: { paidAt }, _sum: { amountPaise: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { paymentStatus: "UNPAID" }, _sum: { totalPaise: true }, _count: { _all: true } }),
    prisma.product.findMany({ where: { isActive: true }, orderBy: { stock: "asc" } }),
    prisma.invoice.findMany({
      where: { invoiceDate },
      orderBy: { invoiceDate: "desc" },
      take: 8,
      select: { id: true, invoiceNumber: true, customerName: true, invoiceDate: true, totalPaise: true, paymentStatus: true, paymentMethod: true, orderType: true },
    }),
    prisma.invoice.groupBy({ by: ["orderType"], where: { invoiceDate }, _sum: { totalPaise: true }, _count: { _all: true } }),
  ]);

  const paid = groups.find((g) => g.paymentStatus === "PAID");
  const unpaid = groups.find((g) => g.paymentStatus === "UNPAID");
  const paidPaise = paid?._sum.totalPaise ?? 0;
  const unpaidPaise = unpaid?._sum.totalPaise ?? 0;
  const invoiceCount = (paid?._count._all ?? 0) + (unpaid?._count._all ?? 0);

  const methods = ["CASH", "UPI", "CARD", "OTHER"] as const;
  const sum = (key: "packagingPaise" | "bagPaise" | "boxCount" | "bagCount") => (paid?._sum[key] ?? 0) + (unpaid?._sum[key] ?? 0);
  const orderTypes = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;
  return {
    range: range ? { start: range.start, end: range.end } : null,
    sales: {
      salesPaise: paidPaise + unpaidPaise,
      paidPaise,
      unpaidPaise,
      invoiceCount,
      discountPaise: (paid?._sum.discountPaise ?? 0) + (unpaid?._sum.discountPaise ?? 0),
      averageBillPaise: invoiceCount ? Math.round((paidPaise + unpaidPaise) / invoiceCount) : 0,
    },
    receivedByMethod: methods.map((method) => {
      const row = received.find((r) => r.method === method);
      return { method, amountPaise: row?._sum.amountPaise ?? 0, count: row?._count._all ?? 0 };
    }),
    // Box + carry bag charges collected on bills made in the period.
    packaging: {
      boxPaise: sum("packagingPaise"),
      bagPaise: sum("bagPaise"),
      totalPaise: sum("packagingPaise") + sum("bagPaise"),
      boxCount: sum("boxCount"),
      bagCount: sum("bagCount"),
    },
    salesByOrderType: orderTypes.map((orderType) => {
      const row = byOrderType.find((r) => r.orderType === orderType);
      return { orderType, salesPaise: row?._sum.totalPaise ?? 0, count: row?._count._all ?? 0 };
    }),
    outstandingUnpaid: { totalPaise: outstanding._sum.totalPaise ?? 0, count: outstanding._count._all },
    // Comparing two columns is simplest in JavaScript for a small shop's product list.
    lowStockProducts: activeProducts.filter((p) => p.stock <= p.lowStockThreshold).slice(0, 20),
    recentInvoices,
  };
}
