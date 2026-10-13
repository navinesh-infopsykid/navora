/**
 * The single shared Prisma client.
 *
 * We use Prisma's Rust-free client together with the `pg` driver
 * (`@prisma/adapter-pg`). It talks to PostgreSQL (Supabase) directly.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { PoolConfig } from "pg";
import "../config";

function buildPoolConfig(rawUrl: string): PoolConfig {
  const url = new URL(rawUrl);
  // Prisma-only parameters that the pg driver does not understand.
  url.searchParams.delete("pgbouncer");
  url.searchParams.delete("connection_limit");
  // SSL is configured below instead of via the URL.
  url.searchParams.delete("sslmode");

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const sslSetting = (process.env.DATABASE_SSL || (isLocal ? "disable" : "require")).toLowerCase();

  return {
    connectionString: url.toString(),
    // Encrypted connection for Supabase. "require" encrypts traffic without
    // checking the certificate chain (the same as psql's sslmode=require).
    ssl: sslSetting === "disable" ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
    // Opening a new connection to Supabase takes several network round trips (TLS + login).
    // Keep idle connections for 5 minutes (the pg default is 10 seconds), so the next bill
    // reuses one instead of reconnecting.
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 5 * 60_000),
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
  };
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.");
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg(buildPoolConfig(databaseUrl)),
});
