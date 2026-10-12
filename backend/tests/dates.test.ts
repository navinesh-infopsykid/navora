import { describe, expect, it } from "vitest";
import { getDateRange } from "../src/lib/dates";
import { buildInvoiceWhere } from "../src/services/invoiceService";

const tz = "Asia/Kolkata";
// Wednesday 14 Oct 2026, 01:30 IST  (= Tuesday 13 Oct 2026, 20:00 UTC)
const now = new Date("2026-10-13T20:00:00Z");
const iso = (d: Date) => d.toISOString();

describe("getDateRange (shop timezone = IST)", () => {
  it("today uses the IST calendar day, not the UTC day", () => {
    const r = getDateRange("today", { now, timeZone: tz })!;
    expect(iso(r.start)).toBe("2026-10-13T18:30:00.000Z"); // 14 Oct 00:00 IST
    expect(iso(r.end)).toBe("2026-10-14T18:30:00.000Z"); // 15 Oct 00:00 IST
  });

  it("yesterday", () => {
    const r = getDateRange("yesterday", { now, timeZone: tz })!;
    expect(iso(r.start)).toBe("2026-10-12T18:30:00.000Z");
    expect(iso(r.end)).toBe("2026-10-13T18:30:00.000Z");
  });

  it("this week starts on Monday", () => {
    const r = getDateRange("week", { now, timeZone: tz })!;
    expect(iso(r.start)).toBe("2026-10-11T18:30:00.000Z"); // Mon 12 Oct 00:00 IST
    expect(iso(r.end)).toBe("2026-10-18T18:30:00.000Z"); // Mon 19 Oct 00:00 IST
  });

  it("this week when today is Sunday still starts on the previous Monday", () => {
    const sunday = new Date("2026-10-18T06:00:00Z"); // Sun 18 Oct 11:30 IST
    const r = getDateRange("week", { now: sunday, timeZone: tz })!;
    expect(iso(r.start)).toBe("2026-10-11T18:30:00.000Z");
  });

  it("this month", () => {
    const r = getDateRange("month", { now, timeZone: tz })!;
    expect(iso(r.start)).toBe("2026-09-30T18:30:00.000Z"); // 1 Oct 00:00 IST
    expect(iso(r.end)).toBe("2026-10-31T18:30:00.000Z"); // 1 Nov 00:00 IST
  });

  it("this month in December rolls over to January", () => {
    const r = getDateRange("month", { now: new Date("2026-12-15T10:00:00Z"), timeZone: tz })!;
    expect(iso(r.end)).toBe("2026-12-31T18:30:00.000Z"); // 1 Jan 2027 00:00 IST
  });

  it("custom range includes the whole 'to' day", () => {
    const r = getDateRange("custom", { from: "2026-10-01", to: "2026-10-05", timeZone: tz })!;
    expect(iso(r.start)).toBe("2026-09-30T18:30:00.000Z");
    expect(iso(r.end)).toBe("2026-10-05T18:30:00.000Z"); // 6 Oct 00:00 IST
  });

  it("custom range validates input", () => {
    expect(() => getDateRange("custom", { from: "2026-10-05", to: "2026-10-01", timeZone: tz })).toThrow(/on or before/);
    expect(() => getDateRange("custom", { from: "2026-02-30", to: "2026-03-01", timeZone: tz })).toThrow(/Invalid date/);
    expect(() => getDateRange("custom", { from: "10/01/2026", to: "2026-10-05", timeZone: tz })).toThrow(/YYYY-MM-DD/);
    expect(() => getDateRange("custom", { timeZone: tz })).toThrow(/both/);
  });

  it("'all' means no date filter", () => {
    expect(getDateRange("all", { now, timeZone: tz })).toBeNull();
  });

  it("works for a daylight-saving timezone too", () => {
    // New York switched to EDT (UTC-4) on 8 Mar 2026.
    const r = getDateRange("today", { now: new Date("2026-03-08T15:00:00Z"), timeZone: "America/New_York" })!;
    expect(iso(r.start)).toBe("2026-03-08T05:00:00.000Z"); // midnight EST (UTC-5)
    expect(iso(r.end)).toBe("2026-03-09T04:00:00.000Z"); // midnight EDT (UTC-4)
  });
});

describe("buildInvoiceWhere", () => {
  it("combines date range, status and search", () => {
    const where = buildInvoiceWhere({ range: "today", now, status: "UNPAID", q: "98765" });
    expect(where.invoiceDate).toEqual({ gte: new Date("2026-10-13T18:30:00Z"), lt: new Date("2026-10-14T18:30:00Z") });
    expect(where.paymentStatus).toBe("UNPAID");
    expect(where.OR).toHaveLength(3); // invoice number, customer name, phone digits
  });

  it("does not search phone numbers for short or non-numeric text", () => {
    const where = buildInvoiceWhere({ range: "all", q: "ravi" });
    expect(where.invoiceDate).toBeUndefined();
    expect(where.OR).toHaveLength(2);
  });
});
