import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/errors";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
};

const ENV_HINT = "Check DATABASE_URL in backend/.env (use the Supabase Session pooler string, port 5432, with your real password), then restart npm run dev.";

/** Recognises "cannot connect to the database" errors and explains them in plain words. */
function databaseProblem(err: unknown): string | null {
  const e = err as { code?: string; message?: string; errorCode?: string } | undefined;
  const code = e?.code ?? e?.errorCode ?? "";
  const text = `${code} ${e?.message ?? ""}`;
  if (code === "P1000" || /AuthenticationFailed|password authentication failed|Tenant or user not found/i.test(text)) {
    return `The database rejected the username or password. ${ENV_HINT}`;
  }
  if (["P1001", "P1002", "P1008", "P1017"].includes(code) || /DatabaseNotReachable|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Can't reach database/i.test(text)) {
    return `Cannot connect to the database. If your Supabase project is paused, restore it in the Supabase dashboard. ${ENV_HINT}`;
  }
  if (code === "P1003" || /DatabaseDoesNotExist/i.test(text)) return `The database in DATABASE_URL does not exist. ${ENV_HINT}`;
  if (code === "P2021" || /TableDoesNotExist|does not exist in the current database/i.test(text)) {
    return "The database tables are missing or out of date. Run: npm run db:migrate";
  }
  return null;
}

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

  const dbMessage = databaseProblem(err);
  if (dbMessage) {
    console.error(`[database] ${dbMessage}\n          Details: ${(err as Error)?.message?.split("\n").filter(Boolean).pop() ?? err}`);
    res.status(503).json({ error: dbMessage });
    return;
  }

  console.error("[error]", err);
  res.status(500).json({ error: "Something went wrong on the server. Check the backend terminal for details." });
};
