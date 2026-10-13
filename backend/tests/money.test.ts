import { describe, expect, it } from "vitest";
import { HttpError } from "../src/lib/errors";
import { calculateTotals, formatPaise, percentToBasisPoints, rupeesToPaise, validatePaymentParts } from "../src/lib/money";

const lines = [
  { unitPricePaise: 54_900, quantity: 3 }, // Rs. 1,647.00
  { unitPricePaise: 16_250, quantity: 1 }, // Rs.   162.50
]; // subtotal Rs. 1,809.50

describe("rupee / paise conversion", () => {
  it("converts rupee strings to paise without floating point errors", () => {
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("0.29")).toBe(29); // 0.29 * 100 = 28.999999999999996 in floating point
    expect(rupeesToPaise("1,234.5")).toBe(123_450);
    expect(rupeesToPaise("49")).toBe(4_900);
  });

  it("rejects invalid amounts", () => {
    expect(() => rupeesToPaise("12.345")).toThrow(HttpError);
    expect(() => rupeesToPaise("-5")).toThrow(HttpError);
    expect(() => rupeesToPaise("abc")).toThrow(HttpError);
  });

  it("converts percentages to basis points", () => {
    expect(percentToBasisPoints("12.5")).toBe(1_250);
    expect(percentToBasisPoints("100")).toBe(10_000);
  });

  it("formats paise with Indian grouping", () => {
    expect(formatPaise(12_345_678)).toBe("1,23,456.78");
    expect(formatPaise(5)).toBe("0.05");
  });
});

describe("calculateTotals — discounts", () => {
  it("calculates subtotal and total with no discount", () => {
    const t = calculateTotals(lines, "NONE", 0);
    expect(t.lineTotals).toEqual([164_700, 16_250]);
    expect(t.subtotalPaise).toBe(180_950);
    expect(t.discountPaise).toBe(0);
    expect(t.totalPaise).toBe(180_950);
  });

  it("applies a fixed rupee discount", () => {
    const t = calculateTotals(lines, "FIXED", 9_950); // Rs. 99.50
    expect(t.discountPaise).toBe(9_950);
    expect(t.totalPaise).toBe(171_000);
  });

  it("applies a percentage discount and rounds to the nearest paisa", () => {
    const t = calculateTotals(lines, "PERCENT", 1_000); // 10%
    expect(t.discountPaise).toBe(18_095);
    expect(t.totalPaise).toBe(162_855);

    // 12.5% of Rs. 0.99 = 12.375 paise -> 12 paise
    expect(calculateTotals([{ unitPricePaise: 99, quantity: 1 }], "PERCENT", 1_250).discountPaise).toBe(12);
    // 50% of 1 paisa = 0.5 -> rounds up to 1
    expect(calculateTotals([{ unitPricePaise: 1, quantity: 1 }], "PERCENT", 5_000).discountPaise).toBe(1);
  });

  it("allows a 100% discount (free bill) and a discount equal to the subtotal", () => {
    expect(calculateTotals(lines, "PERCENT", 10_000).totalPaise).toBe(0);
    expect(calculateTotals(lines, "FIXED", 180_950).totalPaise).toBe(0);
  });

  it("rejects a fixed discount larger than the subtotal", () => {
    expect(() => calculateTotals(lines, "FIXED", 180_951)).toThrow(/more than the subtotal/);
  });

  it("rejects a percentage above 100% and negative discounts", () => {
    expect(() => calculateTotals(lines, "PERCENT", 10_001)).toThrow(/100%/);
    expect(() => calculateTotals(lines, "FIXED", -1)).toThrow(HttpError);
    expect(() => calculateTotals(lines, "FIXED", 10.5)).toThrow(HttpError);
  });

  it("rejects empty bills and bad quantities", () => {
    expect(() => calculateTotals([], "NONE", 0)).toThrow(/at least one item/);
    expect(() => calculateTotals([{ unitPricePaise: 100, quantity: 0 }], "NONE", 0)).toThrow(/Quantity/);
    expect(() => calculateTotals([{ unitPricePaise: 100, quantity: 1.5 }], "NONE", 0)).toThrow(/Quantity/);
  });
});

describe("calculateTotals — discount only on items that allow it", () => {
  // Cake Rs. 500 allows discount, Bun Rs. 100 does not.
  const mixed = [
    { unitPricePaise: 50_000, quantity: 1, discountAllowed: true },
    { unitPricePaise: 10_000, quantity: 1, discountAllowed: false },
  ];

  it("applies a percentage only to eligible items", () => {
    const t = calculateTotals(mixed, "PERCENT", 1_000); // 10%
    expect(t.subtotalPaise).toBe(60_000);
    expect(t.discountableSubtotalPaise).toBe(50_000);
    expect(t.discountPaise).toBe(5_000); // 10% of Rs. 500, not Rs. 600
    expect(t.totalPaise).toBe(55_000);
  });

  it("caps a fixed discount at the eligible amount", () => {
    expect(calculateTotals(mixed, "FIXED", 50_000).totalPaise).toBe(10_000);
    expect(() => calculateTotals(mixed, "FIXED", 50_001)).toThrow(/items that allow a discount/);
  });

  it("refuses a discount when no item allows one, but allows a bill with no discount", () => {
    const none = [{ unitPricePaise: 10_000, quantity: 2, discountAllowed: false }];
    expect(() => calculateTotals(none, "PERCENT", 500)).toThrow(/None of the items/);
    expect(() => calculateTotals(none, "FIXED", 100)).toThrow(/None of the items/);
    expect(calculateTotals(none, "NONE", 0).totalPaise).toBe(20_000);
    expect(calculateTotals(none, "PERCENT", 0).totalPaise).toBe(20_000);
  });
});

describe("validatePaymentParts — split payments", () => {
  it("accepts parts that add up exactly and merges the same method", () => {
    expect(
      validatePaymentParts(
        [
          { method: "UPI", amountPaise: 20_000 },
          { method: "CASH", amountPaise: 10_000 },
          { method: "CASH", amountPaise: 20_000 },
        ],
        50_000,
      ),
    ).toEqual([
      { method: "CASH", amountPaise: 30_000 },
      { method: "UPI", amountPaise: 20_000 },
    ]);
  });

  it("rejects totals that don't match, zero amounts and invalid methods", () => {
    expect(() => validatePaymentParts([{ method: "CASH", amountPaise: 49_999 }], 50_000)).toThrow(/add up to/);
    expect(() => validatePaymentParts([{ method: "CASH", amountPaise: 50_001 }], 50_000)).toThrow(/add up to/);
    expect(() => validatePaymentParts([{ method: "CASH", amountPaise: 0 }, { method: "UPI", amountPaise: 50_000 }], 50_000)).toThrow(/more than zero/);
    expect(() => validatePaymentParts([{ method: "SPLIT", amountPaise: 50_000 }], 50_000)).toThrow(/not a valid/);
    expect(() => validatePaymentParts([], 50_000)).toThrow(/at least one/);
  });
});
