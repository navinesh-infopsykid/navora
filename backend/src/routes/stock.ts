import { Router } from "express";
import { z } from "zod";
import { parse } from "../lib/validation";
import { adjustStock, listStockMovements } from "../services/stockService";

const router = Router();

// GET /api/stock-adjustments?productId=1&type=ADJUSTMENT&limit=100
router.get("/", async (req, res) => {
  const query = parse(
    z.object({
      productId: z.coerce.number().int().positive().optional(),
      type: z.enum(["ADJUSTMENT", "SALE"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
    req.query,
  );
  res.json(await listStockMovements(query));
});

// POST /api/stock-adjustments  { "productId": 1, "change": -2, "reason": "Damaged" }
router.post("/", async (req, res) => {
  const body = parse(
    z.object({
      productId: z.number().int().positive(),
      change: z
        .number()
        .int("Adjustment must be a whole number")
        .refine((v) => v !== 0, "Adjustment cannot be zero")
        .refine((v) => Math.abs(v) <= 1_000_000, "Adjustment is too large"),
      reason: z.string().trim().min(1, "Reason is required").max(200),
    }),
    req.body,
  );
  res.status(201).json(await adjustStock(body));
});

export default router;
