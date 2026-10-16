import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { RANGE_PRESETS } from "../lib/dates";
import { optionalText, orderType, parse, parseId, paymentMethod, paymentParts, paymentStatus } from "../lib/validation";
import * as invoices from "../services/invoiceService";
import { buildInvoicePdf } from "../services/pdfService";
import * as whatsapp from "../services/whatsappService";

const router = Router();

const createSchema = z
  .object({
    customerName: optionalText(120),
    customerPhone: optionalText(25),
    items: z
      .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(100_000) }))
      .min(1, "Add at least one item to the bill")
      .max(200),
    discountType: z.enum(["NONE", "FIXED", "PERCENT"]).default("NONE"),
    discountValue: z.number().int().min(0).default(0),
    paymentMethod,
    paymentStatus,
    payments: paymentParts,
    notes: optionalText(500),
    orderType: orderType.optional(),
    bagCount: z.number().int().min(1).max(20).nullish(),
  })
  .refine((d) => d.discountType !== "PERCENT" || d.discountValue <= 10_000, {
    message: "Discount percentage cannot be more than 100%",
    path: ["discountValue"],
  });

const listSchema = z.object({
  range: z.enum(RANGE_PRESETS as [string, ...string[]]).default("all"),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(100).optional(),
  status: paymentStatus.optional(),
  orderType: orderType.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Stricter limit for actions that call WhatsApp.
const whatsappLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });

// GET /api/invoices?range=today&q=ravi&status=UNPAID&page=1
router.get("/", async (req, res) => {
  const query = parse(listSchema, req.query);
  res.json(await invoices.listInvoices(query as invoices.InvoiceListQuery));
});

router.get("/:id", async (req, res) => {
  res.json(await invoices.getInvoice(parseId(req.params.id)));
});

// POST /api/invoices  -> finalise a bill
router.post("/", async (req, res) => {
  res.status(201).json(await invoices.createInvoice(parse(createSchema, req.body)));
});

// POST /api/invoices/:id/mark-paid  { "paymentMethod": "UPI" }
//   or split: { "payments": [{ "method": "CASH", "amountPaise": 30000 }, { "method": "UPI", "amountPaise": 20000 }] }
router.post("/:id/mark-paid", async (req, res) => {
  const body = parse(z.object({ paymentMethod: paymentMethod.optional(), payments: paymentParts }), req.body ?? {});
  res.json(await invoices.markInvoicePaid(parseId(req.params.id), body.paymentMethod, body.payments));
});

// GET /api/invoices/:id/pdf  (add ?inline=1 to open in the browser instead of downloading)
router.get("/:id/pdf", async (req, res) => {
  const { buffer, filename } = await buildInvoicePdf(parseId(req.params.id));
  const disposition = req.query.inline === "1" ? "inline" : "attachment";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.send(buffer);
});

// WhatsApp: manual wa.me link (always available)
router.post("/:id/whatsapp/link", async (req, res) => {
  res.status(201).json(await whatsapp.createManualShareLink(parseId(req.params.id)));
});

// WhatsApp: automatic send via Cloud API (only when configured)
router.post("/:id/whatsapp/send", whatsappLimiter, async (req, res) => {
  const record = await whatsapp.sendInvoiceViaCloudApi(parseId(req.params.id));
  // 202 Accepted: WhatsApp took the message; delivery is confirmed later by the webhook.
  res.status(record.status === "FAILED" ? 502 : 202).json(record);
});

router.get("/:id/whatsapp", async (req, res) => {
  res.json(await whatsapp.listWhatsAppMessages(parseId(req.params.id)));
});

export default router;
