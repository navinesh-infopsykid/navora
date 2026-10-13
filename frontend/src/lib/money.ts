/**
 * Money helpers for the browser. Amounts are integer PAISE, like the backend.
 * The backend recalculates and validates everything; these are for the live preview.
 */
import type { DiscountType } from "./api";

let currentCurrency = "INR";
export function setCurrency(code: string) {
  currentCurrency = code || "INR";
}

/** 162855 -> "₹1,628.55" */
export function formatMoney(paise: number, currency = currentCurrency): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(paise / 100);
  } catch {
    return `${currency} ${(paise / 100).toFixed(2)}`;
  }
}

/** "49.50" -> 4950. Returns null when the text is not a valid amount. String math avoids float errors. */
export function parseRupees(text: string): number | null {
  const clean = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** "12.5" -> 1250 basis points. */
export const parsePercent = parseRupees;

/** 4950 -> "49.50" (for filling input boxes). */
export const paiseToInput = (paise: number) => (paise / 100).toFixed(2);

export interface DiscountResult {
  subtotalPaise: number;
  /** Total of the lines the discount applies to. */
  discountablePaise: number;
  discountPaise: number;
  totalPaise: number;
  error: string | null;
}

/** Same rules as the server: the discount only applies to items that allow it. */
export function previewTotals(
  lines: { unitPricePaise: number; quantity: number; discountAllowed?: boolean }[],
  type: DiscountType,
  valueText: string,
): DiscountResult & { discountValue: number } {
  const subtotalPaise = lines.reduce((sum, l) => sum + l.unitPricePaise * l.quantity, 0);
  const discountablePaise = lines.reduce((sum, l) => sum + (l.discountAllowed === false ? 0 : l.unitPricePaise * l.quantity), 0);
  const result = (discountPaise: number, discountValue: number, error: string | null = null) => ({
    subtotalPaise,
    discountablePaise,
    discountPaise,
    totalPaise: subtotalPaise - discountPaise,
    discountValue,
    error,
  });

  if (type === "NONE" || valueText.trim() === "") return result(0, 0);
  const value = parseRupees(valueText);
  if (value === null) return result(0, 0, "Enter a number with up to 2 decimals");
  if (value === 0) return result(0, 0);
  if (lines.length > 0 && discountablePaise === 0) return result(0, value, "None of these items allow a discount");
  if (type === "FIXED") {
    if (value > discountablePaise) {
      return result(0, value, discountablePaise === subtotalPaise ? "Discount is more than the subtotal" : "Discount is more than the items that allow a discount");
    }
    return result(value, value);
  }
  if (value > 10_000) return result(0, value, "Discount cannot be more than 100%");
  return result(Math.round((discountablePaise * value) / 10_000), value);
}

/** Paise -> text for an input box: 5000 -> "50", 4950 -> "49.50". */
export function paiseToText(paise: number) {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}
