/**
 * Compares the live database (DIRECT_URL) with prisma/schema.prisma.
 * Prints "No difference detected" when the migrations match the schema.
 *
 *   npm run db:check-drift -w backend
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL (or DATABASE_URL) is not set in backend/.env");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
