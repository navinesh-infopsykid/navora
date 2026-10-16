import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { HttpError } from "../lib/errors";
import { parse } from "../lib/validation";
import { RANGE_PRESETS } from "../lib/dates";
import { getDashboard, type DashboardQuery } from "../services/dashboardService";
import { getSettings, publicSettings, updatePackagingSettings, updateSettings } from "../services/settingsService";
import * as whatsapp from "../services/whatsappService";

const router = Router();

// GET /api/health -> checks that the database is reachable
router.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, database: "connected" });
});

// GET /api/dashboard?range=today|yesterday|week|month|custom|all&from=YYYY-MM-DD&to=YYYY-MM-DD
// (a single day = custom with from and to the same date)
router.get("/dashboard", async (req, res) => {
  const query = parse(
    z.object({
      range: z.enum(RANGE_PRESETS as [string, ...string[]]).default("today"),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    req.query,
  );
  res.json(await getDashboard(query as DashboardQuery));
});

router.get("/settings", async (_req, res) => {
  res.json(publicSettings(await getSettings()));
});

router.put("/settings", async (req, res) => {
  const body = parse(
    z.object({
      businessName: z.string().trim().min(1, "Business name is required").max(120),
      businessAddress: z.string().max(300).default(""),
      businessPhone: z.string().max(30).default(""),
      currency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter code such as INR")
        .default("INR"),
      invoiceFooter: z.string().max(300).default(""),
    }),
    req.body,
  );
  res.json(publicSettings(await updateSettings(body)));
});

// PUT /api/settings/packaging -> the takeaway/delivery packaging rule
router.put("/settings/packaging", async (req, res) => {
  if (!req.user?.isOwner) throw new HttpError(403, "Only the owner can change the packaging rule");
  const amount = (label: string) => z.number().int().min(0, `${label} cannot be negative`).max(1_000_00, `${label} is too large`);
  const body = parse(
    z.object({
      packagingMinPricePaise: z.number().int().min(0).max(1_00_000_00),
      packagingBoxPaise: amount("Box charge"),
      packagingBagPaise: amount("Bag charge"),
      packagingOnTakeaway: z.boolean(),
      packagingOnDelivery: z.boolean(),
    }),
    req.body,
  );
  res.json(publicSettings(await updatePackagingSettings(body)));
});

// Is automatic WhatsApp sending available? (Never returns the token.)
router.get("/whatsapp/status", async (_req, res) => {
  res.json(await whatsapp.getCloudStatus());
});

// Meta webhook verification (GET) and delivery status updates (POST).
router.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"] as string | undefined;
  const token = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"] as string | undefined;
  if (whatsapp.verifyWebhookSubscription(mode, token)) {
    res.type("text/plain").send(challenge ?? "");
  } else {
    res.sendStatus(403);
  }
});

// Raw body is needed to verify Meta's signature.
router.post("/whatsapp/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!whatsapp.isValidWebhookSignature(raw, req.get("x-hub-signature-256"))) {
    res.sendStatus(401);
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    res.sendStatus(400);
    return;
  }
  await whatsapp.handleWebhookPayload(payload);
  res.sendStatus(200);
});

export default router;
