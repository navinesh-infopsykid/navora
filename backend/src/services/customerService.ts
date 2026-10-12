import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";

/**
 * Saved customers for the billing screen's suggestions.
 * Customers are saved automatically when a bill is made with a phone number
 * (see createInvoice). Only customers with a phone number are suggested:
 * bills without a phone create a one-off "walk-in" customer each time.
 *
 * Search matches the name, or the phone digits (so "98765" or "+91 98765" both work).
 * With no search text, the most recently billed customers come first.
 */
export async function searchCustomers(options: { search?: string; limit?: number }) {
  const search = options.search?.trim() ?? "";
  const where: Prisma.CustomerWhereInput = { phone: { not: null } };

  if (search) {
    const or: Prisma.CustomerWhereInput[] = [{ name: { contains: search, mode: "insensitive" } }];
    const digits = search.replace(/\D/g, "");
    if (digits.length >= 2) or.push({ phone: { contains: digits } });
    where.OR = or;
  }

  const customers = await prisma.customer.findMany({
    where,
    // updatedAt changes every time the customer is billed, so this is "most recent first".
    orderBy: { updatedAt: "desc" },
    take: Math.min(options.limit ?? 8, 25),
    select: { id: true, name: true, phone: true, updatedAt: true, _count: { select: { invoices: true } } },
  });

  return customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone!, lastBilledAt: c.updatedAt, invoiceCount: c._count.invoices }));
}