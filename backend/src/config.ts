/**
 * All environment variables are read here, in one place.
 * Other files import `config` instead of touching process.env directly.
 */
import "dotenv/config";
import path from "node:path";

function list(value: string | undefined, fallback: string): string[] {
  return (value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  // Listen on localhost only by default, so other computers cannot reach the API.
  // Use HOST="0.0.0.0" only on a trusted network (and HTTPS + COOKIE_SECURE for the internet).
  host: process.env.HOST || "127.0.0.1",
  corsOrigins: list(process.env.CORS_ORIGIN, "http://localhost:5173"),
  timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, ""),
  isTest: process.env.NODE_ENV === "test" || process.env.VITEST === "true",

  // Production: the backend also serves the built frontend (frontend/dist), so the whole
  // app is ONE web service on ONE address. Not used during `npm run dev`.
  frontendDist: process.env.FRONTEND_DIST || path.resolve(__dirname, "../../frontend/dist"),
  // Behind a hosting platform's proxy (Cloud Run, Render, Railway…) set TRUST_PROXY=1 so
  // rate limiting sees each visitor's real IP address instead of the proxy's.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  auth: {
    // How long a login lasts before you must sign in again.
    sessionDays: Number(process.env.SESSION_DAYS || 30),
    // Set to "true" when the app is served over HTTPS so the login cookie is never sent over plain HTTP.
    cookieSecure: process.env.COOKIE_SECURE === "true",
  },

  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || "",
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en",
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
  },
};
