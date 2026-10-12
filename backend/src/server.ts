import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./lib/db";

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`✔ Billing API running at http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}/api`);
  console.log("  No login is enabled. Keep this server on your own computer/network only.");
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
