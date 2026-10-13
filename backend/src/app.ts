import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config";
import customerRoutes from "./routes/customers";
import heldCartRoutes from "./routes/heldCarts";
import { loadUser, requireAuth } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth";
import invoiceRoutes from "./routes/invoices";
import miscRoutes from "./routes/misc";
import productRoutes from "./routes/products";
import stockRoutes from "./routes/stock";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Only ask browsers to upgrade to HTTPS when the site is actually served over HTTPS.
          upgradeInsecureRequests: config.auth.cookieSecure ? [] : null,
        },
      },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      exposedHeaders: ["Content-Disposition"],
      credentials: true, // allow the login cookie when the frontend is on another port
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

  // Login: find the user from the session cookie, then block /api for anyone not logged in.
  app.use(loadUser);
  app.use(requireAuth);

  app.use("/api/auth", authRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/stock-adjustments", stockRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/held-carts", heldCartRoutes);
  app.use("/api", miscRoutes);

  // Production: serve the built frontend from the same address as the API.
  const indexHtml = path.join(config.frontendDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.frontendDist, {
        index: false,
        // Files in /assets have a content hash in their name, so browsers may cache them for a year.
        setHeaders: (res, filePath) => {
          res.setHeader("Cache-Control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
        },
      }),
    );
    // Any other page address (/billing, /invoices/12 …) gets the app, which then shows the right screen.
    app.use((req, res, next) => {
      // Skip API calls and missing files such as /assets/old.js (those should be a 404).
      if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/") || path.extname(req.path)) return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
