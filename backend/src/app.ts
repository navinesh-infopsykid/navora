import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config";
import customerRoutes from "./routes/customers";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import invoiceRoutes from "./routes/invoices";
import miscRoutes from "./routes/misc";
import productRoutes from "./routes/products";
import stockRoutes from "./routes/stock";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH"],
      exposedHeaders: ["Content-Disposition"],
    }),
  );

  // Basic rate limiting for every API route (generous for a single shop).
  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 300, standardHeaders: "draft-8", legacyHeaders: false }),
  );

  // JSON bodies (the WhatsApp webhook needs the raw body, so it is skipped here).
  const json = express.json({ limit: "200kb" });
  app.use((req, res, next) => (req.path === "/api/whatsapp/webhook" ? next() : json(req, res, next)));

  app.use("/api/products", productRoutes);
  app.use("/api/stock-adjustments", stockRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api", miscRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}