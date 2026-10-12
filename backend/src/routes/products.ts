import { Router } from "express";
import { z } from "zod";
import { optionalText, paise, parse, parseId, wholeNumber } from "../lib/validation";
import * as products from "../services/productService";

const router = Router();

const productFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  sku: optionalText(40),
  pricePaise: paise,
  lowStockThreshold: wholeNumber,
  description: optionalText(500),
};
const createSchema = z.object({ ...productFields, stock: wholeNumber });
const updateSchema = z.object(productFields);

// GET /api/products?search=pen&includeInactive=true&lowStock=true
router.get("/", async (req, res) => {
  const query = parse(
    z.object({ search: z.string().optional(), includeInactive: z.string().optional(), lowStock: z.string().optional() }),
    req.query,
  );
  res.json(
    await products.listProducts({
      search: query.search,
      includeInactive: query.includeInactive === "true",
      lowStockOnly: query.lowStock === "true",
    }),
  );
});

router.get("/:id", async (req, res) => {
  res.json(await products.getProduct(parseId(req.params.id)));
});

router.post("/", async (req, res) => {
  res.status(201).json(await products.createProduct(parse(createSchema, req.body)));
});

router.put("/:id", async (req, res) => {
  res.json(await products.updateProduct(parseId(req.params.id), parse(updateSchema, req.body)));
});

// PATCH /api/products/:id/status  { "isActive": false }
router.patch("/:id/status", async (req, res) => {
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  res.json(await products.setProductActive(parseId(req.params.id), isActive));
});

export default router;
