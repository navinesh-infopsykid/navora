import { Router } from "express";
import { z } from "zod";
import { parse } from "../lib/validation";
import { searchCustomers } from "../services/customerService";

const router = Router();

// GET /api/customers?search=meena&limit=8
router.get("/", async (req, res) => {
  const query = parse(
    z.object({
      search: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(25).optional(),
    }),
    req.query,
  );
  res.json(await searchCustomers(query));
});

export default router;