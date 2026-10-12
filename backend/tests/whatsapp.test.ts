import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/lib/phone";
import { buildShareMessage, buildWaMeUrl, buildWhatsAppAppUrl, buildWhatsAppWebUrl, getCloudStatus } from "../src/services/whatsappService";

describe("WhatsApp manual share link", () => {
  it("encodes the message safely for wa.me", () => {
    const message = buildShareMessage({ customerName: "Priya & Co", businessName: "Shop #1", invoiceNumber: "INV-00007", total: "Rs. 1,250.00" });
    const url = buildWaMeUrl("919876543210", message);
    expect(url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(url).not.toMatch(/[ #\n]/); // no raw spaces, hashes or newlines
    expect(url).toContain("%26"); // "&" encoded
    expect(url).toContain("%23"); // "#" encoded
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(message);
  });

  it("builds direct WhatsApp Web and desktop-app links with the same encoded message", () => {
    const message = "Invoice INV-00001 & total Rs. 99.00";
    const web = buildWhatsAppWebUrl("919876543210", message);
    const app = buildWhatsAppAppUrl("+91 98765 43210", message);
    expect(web.startsWith("https://web.whatsapp.com/send?phone=919876543210&text=")).toBe(true);
    expect(app.startsWith("whatsapp://send?phone=919876543210&text=")).toBe(true);
    expect(decodeURIComponent(web.split("&text=")[1])).toBe(message);
    expect(decodeURIComponent(app.split("&text=")[1])).toBe(message);
  });
});

describe("phone normalisation", () => {
  it("adds the country code to Indian 10-digit numbers", () => {
    expect(normalizePhone("98765 43210", "91")).toBe("919876543210");
    expect(normalizePhone("098765-43210", "91")).toBe("919876543210");
    expect(normalizePhone("+91 98765 43210", "91")).toBe("919876543210");
    expect(normalizePhone("+1 (415) 555-0100", "91")).toBe("14155550100");
    expect(normalizePhone("", "91")).toBeNull();
  });

  it("rejects things that are not phone numbers", () => {
    expect(() => normalizePhone("12345", "91")).toThrow();
    expect(() => normalizePhone("call me", "91")).toThrow();
  });
});

describe("WhatsApp Cloud API status", () => {
  it("is disabled when credentials are missing", async () => {
    const status = await getCloudStatus();
    expect(status.enabled).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/token/i);
  });
});

describe("webhook signature", () => {
  it("accepts only correctly signed payloads", async () => {
    process.env.WHATSAPP_APP_SECRET = "test-secret";
    const { config } = await import("../src/config");
    config.whatsapp.appSecret = "test-secret";
    const { isValidWebhookSignature } = await import("../src/services/whatsappService");
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const good = "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
    expect(isValidWebhookSignature(body, good)).toBe(true);
    expect(isValidWebhookSignature(body, "sha256=" + "0".repeat(64))).toBe(false);
    expect(isValidWebhookSignature(body, undefined)).toBe(false);
    config.whatsapp.appSecret = "";
  });
});