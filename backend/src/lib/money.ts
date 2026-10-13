/**
 * Money helpers. Every amount is an integer number of PAISE (1 rupee = 100 paise).
 * Integers never have rounding errors, unlike 0.1 + 0.2 in floating point.
 */
import { badRequest } from "./errors";

export type DiscountType = "NONE" | "FIXED" | "PERCENT";

/** Largest amount we accept for one invoice: Rs. 1 crore (keeps sums far below Int limits). */
export const MAX_INVOICE_PAISE = 1_00_00_000 * 100;
/** 100% expressed in basis points (1% = 100 bp). */
export const FULL_PERCENT_BP = 10_000;

/**
 * Convert a rupee string like "49.5" or "1,200.00" into paise (4950, 120000).
 * Uses string parsing, never floating-point multiplication.
 */
export function rupeesToPaise(input: string | number): number {
  const text = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw badRequest(`"${input}" is not a valid rupee amount (use up to 2 decimals)`);
  }
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Convert a percentage string like "12.5" into basis points (1250). */
export function percentToBasisPoints(input: string | number): number {
  const text = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw badRequest(`"${input}" is not a valid percentage (use up to 2 decimals)`);
  }
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Format paise as "1,234.50" using Indian digit grouping. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${rupees.toLocaleString("en-IN")}.${fraction}`;
}

/** Currency label used in PDFs and WhatsApp text (PDF base fonts have no ₹ glyph). */
export function currencyLabel(currency: string): string {
  return currency.toUpperCase() === "INR" ? "Rs." : currency.toUpperCase();
}

export function formatMoney(paise: number, currency = "INR"): string {
  return `${currencyLabel(currency)} ${formatPaise(paise)}`;
}

export interface LineInput {
  unitPricePaise: number;
  quantity: number;
  /** false = the bill discount does not apply to this line. Default true. */
  discountAllowed?: boolean;
}

export interface Totals {
  lineTotals: number[];
  subtotalPaise: number;
  /** Part of the subtotal the discount applies to (lines that allow a discount). */
  discountableSubtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
}

/**
 * Calculates line totals, subtotal, discount and final payable amount.
 *
 * discountValue meaning depends on discountType:
 *  - NONE:    ignored (use 0)
 *  - FIXED:   discount in paise, e.g. 5000 = Rs. 50
 *  - PERCENT: basis points, e.g. 1250 = 12.5%
 *
 * The discount only applies to lines that allow a discount (Product.discountAllowed).
 * A percentage is taken of those lines; a fixed amount can't exceed their total.
 *
 * Throws a 400 error for invalid discounts (negative, over 100%, more than the eligible amount).
 */
export function calculateTotals(lines: LineInput[], discountType: DiscountType, discountValue: number): Totals {
  if (lines.length === 0) throw badRequest("Add at least one item to the bill");

  const lineTotals = lines.map((line) => {
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      throw badRequest("Unit price must be a non-negative whole number of paise");
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw badRequest("Quantity must be a whole number greater than zero");
    }
    return line.unitPricePaise * line.quantity;
  });

  const subtotalPaise = lineTotals.reduce((sum, value) => sum + value, 0);
  if (subtotalPaise > MAX_INVOICE_PAISE) throw badRequest("Invoice total is too large");
  const discountableSubtotalPaise = lineTotals.reduce((sum, value, i) => sum + (lines[i].discountAllowed === false ? 0 : value), 0);

  if (!Number.isInteger(discountValue) || discountValue < 0) {
    throw badRequest("Discount must be zero or a positive number");
  }

  let discountPaise = 0;
  if ((discountType === "FIXED" || discountType === "PERCENT") && discountValue > 0 && discountableSubtotalPaise === 0) {
    throw badRequest("None of the items on this bill allow a discount");
  }
  if (discountType === "FIXED") {
    if (discountValue > discountableSubtotalPaise) {
      throw badRequest(
        discountableSubtotalPaise === subtotalPaise
          ? "Discount cannot be more than the subtotal"
          : "Discount cannot be more than the total of items that allow a discount",
      );
    }
    discountPaise = discountValue;
  } else if (discountType === "PERCENT") {
    if (discountValue > FULL_PERCENT_BP) throw badRequest("Discount percentage cannot be more than 100%");
    // Round to the nearest paisa (half rounds up). Safe: max value is 1e10 * 1e4 < 2^53.
    discountPaise = Math.round((discountableSubtotalPaise * discountValue) / FULL_PERCENT_BP);
  } else if (discountType === "NONE") {
    if (discountValue !== 0) throw badRequest("Discount value must be 0 when there is no discount");
  } else {
    throw badRequest("Unknown discount type");
  }

  return { lineTotals, subtotalPaise, discountableSubtotalPaise, discountPaise, totalPaise: subtotalPaise - discountPaise };
}

export const SPLIT_METHODS = ["CASH", "UPI", "CARD", "OTHER"] as const;
export type SingleMethod = (typeof SPLIT_METHODS)[number];

/**
 * Checks the parts of a payment (e.g. Cash 300 + UPI 200) against the amount due.
 * Same-method parts are merged. Returns the cleaned list in a fixed order.
 */
export function validatePaymentParts(parts: { method: string; amountPaise: number }[], duePaise: number) {
  if (parts.length === 0) throw badRequest("Add at least one payment");
  const merged = new Map<SingleMethod, number>();
  for (const part of parts) {
    if (!SPLIT_METHODS.includes(part.method as SingleMethod)) throw badRequest(`"${part.method}" is not a valid payment method`);
    if (!Number.isInteger(part.amountPaise) || part.amountPaise <= 0) throw badRequest("Each payment amount must be more than zero");
    merged.set(part.method as SingleMethod, (merged.get(part.method as SingleMethod) ?? 0) + part.amountPaise);
  }
  const sum = [...merged.values()].reduce((a, b) => a + b, 0);
  if (sum !== duePaise) {
    throw badRequest(`Payments add up to ${formatMoney(sum)} but the bill is ${formatMoney(duePaise)}`, { paidPaise: sum, duePaise });
  }
  return SPLIT_METHODS.filter((m) => merged.has(m)).map((method) => ({ method, amountPaise: merged.get(method)! }));
}
