import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./lib/db";

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`✔ Billing API running at http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}/api`);
  console.log("  Logins are required. Open the app in your browser to sign in.");
});

// Open a database connection now, so the first bill of the day doesn't wait for it,
// and touch it every 4 minutes so an idle shop counter never has to reconnect.
const warmUp = () => prisma.$queryRaw`SELECT 1`.catch((error: unknown) => console.warn("[db] warm-up failed:", (error as Error).message));
void warmUp();
setInterval(warmUp, 4 * 60_000).unref();

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
