/**
 * Applies all migrations to the TEST database (TEST_DATABASE_URL).
 * Run once before `npm test`, and again after adding new migrations.
 *
 *   npm run test:db:setup -w backend
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("TEST_DATABASE_URL is not set in backend/.env — see README 'Running tests'.");
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL) {
  console.error("TEST_DATABASE_URL must point to a different database than DATABASE_URL. Tests delete all data.");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
});
process.exit(result.status ?? 1);
