import { Router } from "express";
import { z } from "zod";
import { optionalText, orderType, parse, parseId } from "../lib/validation";
import { deleteHeldCart, holdCart, listHeldCarts, recallCart } from "../services/heldCartService";

const router = Router();

// GET /api/held-carts -> up to 5 parked bills, oldest first
router.get("/", async (_req, res) => {
  res.json(await listHeldCarts());
});

// POST /api/held-carts -> park the current bill
router.post("/", async (req, res) => {
  const body = parse(
    z.object({
      customerName: optionalText(120),
      customerPhone: optionalText(25),
      discountType: z.enum(["NONE", "FIXED", "PERCENT"]).default("NONE"),
      discountValue: z.number().int().min(0).max(1_00_00_000_00).default(0),
      items: z
        .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(100_000) }))
        .min(1, "Add at least one item before holding the bill")
        .max(200),
      orderType: orderType.optional(),
      bagCount: z.number().int().min(0).max(20).nullish(),
    }),
    req.body,
  );
  res.status(201).json(await holdCart(body, req.user?.name));
});

// POST /api/held-carts/:id/recall -> returns the bill and removes it from the held list
router.post("/:id/recall", async (req, res) => {
  res.json(await recallCart(parseId(req.params.id)));
});

// DELETE /api/held-carts/:id -> discard a held bill
router.delete("/:id", async (req, res) => {
  await deleteHeldCart(parseId(req.params.id));
  res.status(204).end();
});

export default router;
