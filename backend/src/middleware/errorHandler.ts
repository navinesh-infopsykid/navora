import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/errors";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
};

/** Turns any thrown error into a JSON response: { error: "message", details?: ... } */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  // Invalid JSON body
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body is not valid JSON" });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large" });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      // The field name is in meta.target (classic engine) or in the driver adapter's error details.
      const meta = err.meta as { target?: string[] | string; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } } | undefined;
      const target = (meta?.target ?? meta?.driverAdapterError?.cause?.constraint?.fields ?? "value").toString();
      const friendly = target.includes("sku") ? "Another product already uses this SKU" : `Duplicate ${target}`;
      res.status(409).json({ error: friendly });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Record not found" });
      return;
    }
  }

  console.error("[error]", err);
  res.status(500).json({ error: "Something went wrong on the server. Check the backend terminal for details." });
};
