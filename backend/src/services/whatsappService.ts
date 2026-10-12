/**
 * WhatsApp invoice sharing.
 *
 * Two separate ways to share:
 *
 * 1. MANUAL (always available): we build a https://wa.me/ link with a
 *    prefilled message. The shop owner's WhatsApp opens; they attach the
 *    downloaded PDF and press send themselves. We CANNOT know if it was sent,
 *    so it is recorded as LINK_GENERATED — never as "delivered".
 *
 * 2. CLOUD API (optional): the backend uploads the PDF to the official
 *    WhatsApp Business Cloud API and sends it. Only enabled when credentials
 *    in backend/.env are present AND verified. The API answering "accepted"
 *    is not delivery either: DELIVERED/READ only arrive later via the webhook.
 *
 * The access token is only ever used here, on the server.
 * A WhatsApp failure never changes or deletes the invoice.
 */
import crypto from "node:crypto";
import type { WhatsAppStatus } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../lib/db";
import { conflict, HttpError, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { buildInvoicePdf } from "./pdfService";
import { getSettings } from "./settingsService";

const GRAPH = "https://graph.facebook.com";

// ---------------------------------------------------------------------------
// Manual wa.me link
// ---------------------------------------------------------------------------

export function buildShareMessage(params: { customerName: string; businessName: string; invoiceNumber: string; total: string }) {
  return [
    `Hello ${params.customerName},`,
    `Thank you for shopping at ${params.businessName}.`,
    `Invoice: ${params.invoiceNumber}`,
    `Total: ${params.total}`,
    `Your invoice PDF is attached.`,
  ].join("\n");
}

/** Builds a properly encoded wa.me URL. `phone` must be digits with country code. */
export function buildWaMeUrl(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/**
 * Opens the chat directly in WhatsApp Web. Unlike wa.me, this skips the
 * "Continue to chat" landing page, which would otherwise open a second tab.
 */
export function buildWhatsAppWebUrl(phone: string, message: string) {
  return `https://web.whatsapp.com/send?phone=${phone.replace(/\D/g, "")}&text=${encodeURIComponent(message)}`;
}

/** Opens the chat in the installed WhatsApp desktop app (no browser tab at all). */
export function buildWhatsAppAppUrl(phone: string, message: string) {
  return `whatsapp://send?phone=${phone.replace(/\D/g, "")}&text=${encodeURIComponent(message)}`;
}

async function loadShareableInvoice(invoiceId: number) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw notFound("Invoice not found");
  if (invoice.paymentStatus !== "PAID") throw conflict("WhatsApp sharing is available after the invoice is marked Paid");
  if (!invoice.customerPhone) throw conflict("This invoice has no customer phone number");
  return invoice;
}

export async function createManualShareLink(invoiceId: number) {
  const invoice = await loadShareableInvoice(invoiceId);
  const settings = await getSettings();
  const message = buildShareMessage({
    customerName: invoice.customerName,
    businessName: settings.businessName,
    invoiceNumber: invoice.invoiceNumber,
    total: formatMoney(invoice.totalPaise, settings.currency),
  });
  const url = buildWaMeUrl(invoice.customerPhone!, message);

  const record = await prisma.whatsAppMessage.create({
    data: { invoiceId, phone: invoice.customerPhone!, mode: "MANUAL_LINK", status: "LINK_GENERATED" },
  });
  return {
    url,
    webUrl: buildWhatsAppWebUrl(invoice.customerPhone!, message),
    appUrl: buildWhatsAppAppUrl(invoice.customerPhone!, message),
    message,
    record,
    note: "WhatsApp will open with the message ready. Attach the downloaded PDF and press Send. This app cannot confirm that the message was sent.",
  };
}

// ---------------------------------------------------------------------------
// Cloud API
// ---------------------------------------------------------------------------

interface CloudStatus {
  enabled: boolean;
  reason: string;
  displayPhoneNumber?: string;
  usesTemplate: boolean;
}

let cachedStatus: { value: CloudStatus; expiresAt: number } | null = null;

/** Exposed for tests. */
export function resetWhatsAppStatusCache() {
  cachedStatus = null;
}

function authHeaders() {
  return { Authorization: `Bearer ${config.whatsapp.accessToken}` };
}

/**
 * Is automatic sending available? Credentials must be present AND accepted by Meta.
 * Result is cached (10 min when valid, 1 min when not) to avoid calling Meta on every page load.
 */
export async function getCloudStatus(): Promise<CloudStatus> {
  const usesTemplate = Boolean(config.whatsapp.templateName);
  if (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId) {
    return { enabled: false, usesTemplate, reason: "WhatsApp Cloud API is not configured. Use the manual WhatsApp share instead." };
  }
  if (cachedStatus && cachedStatus.expiresAt > Date.now()) return cachedStatus.value;

  let value: CloudStatus;
  try {
    const url = `${GRAPH}/${config.whatsapp.apiVersion}/${encodeURIComponent(config.whatsapp.phoneNumberId)}?fields=display_phone_number,verified_name`;
    const response = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
    const body = (await response.json().catch(() => ({}))) as { display_phone_number?: string; error?: { message?: string } };
    value = response.ok
      ? { enabled: true, usesTemplate, reason: "Connected", displayPhoneNumber: body.display_phone_number }
      : { enabled: false, usesTemplate, reason: `WhatsApp credentials were rejected: ${body.error?.message ?? response.statusText}` };
  } catch (error) {
    value = { enabled: false, usesTemplate, reason: `Could not reach WhatsApp: ${(error as Error).message}` };
  }
  cachedStatus = { value, expiresAt: Date.now() + (value.enabled ? 10 * 60_000 : 60_000) };
  return value;
}

async function graphPost(path: string, body: FormData | string,headers: Record<string, string> = {}) {
  const response = await fetch(`${GRAPH}/${config.whatsapp.apiVersion}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(), ...headers },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) throw new Error(json?.error?.message ?? `WhatsApp API error ${response.status}`);
  return json;
}

/**
 * Upload the invoice PDF and send it through the Cloud API.
 * Always returns a WhatsAppMessage record (ACCEPTED or FAILED); it never throws
 * for WhatsApp problems, and it never modifies the invoice.
 */
export async function sendInvoiceViaCloudApi(invoiceId: number) {
  const invoice = await loadShareableInvoice(invoiceId);
  const status = await getCloudStatus();
  if (!status.enabled) throw new HttpError(503, status.reason);

  const phone = invoice.customerPhone!;
  try {
    const settings = await getSettings();
    const { buffer, filename } = await buildInvoicePdf(invoiceId);
    const total = formatMoney(invoice.totalPaise, settings.currency);

    // 1. Upload the PDF.
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
    const media = await graphPost(`${encodeURIComponent(config.whatsapp.phoneNumberId)}/media`, form);

    // 2. Send it. Business-initiated messages need an approved template;
    //    a plain document message only works within 24h of the customer messaging you.
    const document = { id: media.id as string, filename };
    const payload = config.whatsapp.templateName
      ? {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: config.whatsapp.templateName,
            language: { code: config.whatsapp.templateLanguage },
            components: [
              { type: "header", parameters: [{ type: "document", document }] },
              { type: "body", parameters: [{ type: "text", text: invoice.invoiceNumber }, { type: "text", text: total }] },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: phone,
          type: "document",
          document: { ...document, caption: `Invoice ${invoice.invoiceNumber} — ${total}. Thank you for shopping at ${settings.businessName}.` },
        };

    const sent = await graphPost(`${encodeURIComponent(config.whatsapp.phoneNumberId)}/messages`, JSON.stringify(payload), {
      "Content-Type": "application/json",
    });
    const providerMessageId = sent?.messages?.[0]?.id as string | undefined;

    return prisma.whatsAppMessage.create({
      data: { invoiceId, phone, mode: "CLOUD_API", status: "ACCEPTED", providerMessageId: providerMessageId ?? null },
    });
  } catch (error) {
    return prisma.whatsAppMessage.create({
      data: { invoiceId, phone, mode: "CLOUD_API", status: "FAILED", error: (error as Error).message.slice(0, 500) },
    });
  }
}

export async function listWhatsAppMessages(invoiceId: number) {
  return prisma.whatsAppMessage.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" } });
}

// ---------------------------------------------------------------------------
// Webhook (delivery receipts from Meta)
// ---------------------------------------------------------------------------

export function verifyWebhookSubscription(mode?: string, token?: string): boolean {
  return mode === "subscribe" && Boolean(config.whatsapp.webhookVerifyToken) && token === config.whatsapp.webhookVerifyToken;
}

/** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
export function isValidWebhookSignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!config.whatsapp.appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", config.whatsapp.appSecret).update(rawBody).digest("hex");
  const given = signatureHeader.slice("sha256=".length);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const STATUS_RANK: Record<WhatsAppStatus, number> = { LINK_GENERATED: 0, ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };
const WEBHOOK_STATUS: Record<string, WhatsAppStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Applies status updates from a webhook payload. Never moves a status backwards (e.g. READ -> DELIVERED). */
export async function handleWebhookPayload(payload: any) {
  let updated = 0;
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        const next = WEBHOOK_STATUS[s?.status];
        if (!next || typeof s?.id !== "string") continue;
        const existing = await prisma.whatsAppMessage.findUnique({ where: { providerMessageId: s.id } });
        if (!existing || STATUS_RANK[next] <= STATUS_RANK[existing.status]) continue;
        await prisma.whatsAppMessage.update({
          where: { id: existing.id },
          data: { status: next, error: next === "FAILED" ? String(s?.errors?.[0]?.title ?? "Delivery failed").slice(0, 500) : null },
        });
        updated++;
      }
    }
  }
  return updated;
}