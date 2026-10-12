/**
 * Runs before every test file.
 * Points the app at TEST_DATABASE_URL so tests never touch your real data.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  if (testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL) {
    throw new Error("TEST_DATABASE_URL must be a different database from DATABASE_URL — tests delete all data.");
  }
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_URL = testUrl;
} else {
  // Unit tests still run; database tests are skipped (see tests/helpers.ts).
  process.env.DATABASE_URL = "postgresql://not-configured@localhost:5432/not_configured";
}

// Make "today"/"this month" deterministic regardless of the machine's timezone.
process.env.APP_TIMEZONE = "Asia/Kolkata";
process.env.DEFAULT_COUNTRY_CODE = "91";
// Never call the real WhatsApp API from tests.
process.env.WHATSAPP_ACCESS_TOKEN = "";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
