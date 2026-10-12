/**
 * All environment variables are read here, in one place.
 * Other files import `config` instead of touching process.env directly.
 */
import "dotenv/config";

function list(value: string | undefined, fallback: string): string[] {
  return (value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 4000),
  // Listen on localhost only by default. This app has NO login, so it must
  // not be reachable from other computers. See README "Security".
  host: process.env.HOST || "127.0.0.1",
  corsOrigins: list(process.env.CORS_ORIGIN, "http://localhost:5173"),
  timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, ""),
  isTest: process.env.NODE_ENV === "test" || process.env.VITEST === "true",

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
