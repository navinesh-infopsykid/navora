import type { CookieOptions, Request, RequestHandler, Response } from "express";
import type { User } from "@prisma/client";
import { config } from "../config";
import { HttpError } from "../lib/errors";
import { getSessionUser, unauthorized } from "../services/authService";

export const SESSION_COOKIE = "billing_session";

// Adds `req.user` and `req.sessionId` to Express's Request type.
declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    sessionId?: number;
  }
}

/** Reads one cookie from the Cookie header (no extra dependency needed). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // JavaScript in the page cannot read it
    sameSite: "lax", // not sent with requests started by other websites (CSRF protection)
    secure: config.auth.cookieSecure,
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Loads the logged-in user if there is a valid session cookie. Never rejects. */
export const loadUser: RequestHandler = async (req, _res, next) => {
  if (!req.path.startsWith("/api/")) return next(); // web page files don't need a login check
  const session = await getSessionUser(readCookie(req, SESSION_COOKIE));
  if (session) {
    req.user = session.user;
    req.sessionId = session.sessionId;
  }
  next();
};

// These API paths work without logging in.
const PUBLIC_PATHS = ["/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/auth/logout", "/api/health", "/api/whatsapp/webhook"];

/** Blocks every /api request from people who are not logged in (except the public paths above). */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.path.startsWith("/api/") || PUBLIC_PATHS.includes(req.path)) return next();
  if (!req.user) return next(unauthorized());
  next();
};

export const requireOwner: RequestHandler = (req, _res, next) => {
  if (!req.user?.isOwner) return next(new HttpError(403, "Only the owner can manage users"));
  next();
};
