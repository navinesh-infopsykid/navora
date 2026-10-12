import { config } from "../config";
import { getDateRange } from "../lib/dates";
import { prisma } from "../lib/db";

async function salesBetween(start: Date, end: Date) {
  const groups = await prisma.invoice.groupBy({
    by: ["paymentStatus"],
    where: { invoiceDate: { gte: start, lt: end } },
    _sum: { totalPaise: true },
    _count: { _all: true },
  });
  const paid = groups.find((g) => g.paymentStatus === "PAID");
  const unpaid = groups.find((g) => g.paymentStatus === "UNPAID");
  const paidPaise = paid?._sum.totalPaise ?? 0;
  const unpaidPaise = unpaid?._sum.totalPaise ?? 0;
  return {
    salesPaise: paidPaise + unpaidPaise,
    paidPaise,
    unpaidPaise,
    invoiceCount: (paid?._count._all ?? 0) + (unpaid?._count._all ?? 0),
  };
}

export async function getDashboard(now = new Date()) {
  const today = getDateRange("today", { now, timeZone: config.timezone })!;
  const month = getDateRange("month", { now, timeZone: config.timezone })!;

  const [todayStats, monthStats, outstanding, activeProducts, recentInvoices] = await Promise.all([
    salesBetween(today.start, today.end),
    salesBetween(month.start, month.end),
    prisma.invoice.aggregate({ where: { paymentStatus: "UNPAID" }, _sum: { totalPaise: true }, _count: { _all: true } }),
    prisma.product.findMany({ where: { isActive: true }, orderBy: { stock: "asc" } }),
    prisma.invoice.findMany({
      orderBy: { invoiceDate: "desc" },
      take: 8,
      select: { id: true, invoiceNumber: true, customerName: true, invoiceDate: true, totalPaise: true, paymentStatus: true },
    }),
  ]);

  return {
    today: todayStats,
    month: monthStats,
    outstandingUnpaid: { totalPaise: outstanding._sum.totalPaise ?? 0, count: outstanding._count._all },
    // Comparing two columns is simplest in JavaScript for a small shop's product list.
    lowStockProducts: activeProducts.filter((p) => p.stock <= p.lowStockThreshold).slice(0, 20),
    recentInvoices,
  };
}
