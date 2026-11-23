import { env } from "./env";
import { buildApp } from "./app";
import { prisma } from "@repo/database";

const app = buildApp();

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "Shutting down API");
  try {
    await app.close();
    await prisma.$disconnect();
    app.log.info("API shutdown complete");
  } catch {
    app.log.error("API shutdown failed");
    process.exitCode = 1;
  }
}
process.on("SIGTERM", () => { void stop("SIGTERM"); });
process.on("SIGINT", () => { void stop("SIGINT"); });

app.listen({ port: env.API_PORT, host: env.HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API running at ${address}`);
});
