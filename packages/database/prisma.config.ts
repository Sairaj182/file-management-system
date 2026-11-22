// Prisma config - env vars are injected by dotenv-cli for database commands.
// Client generation during a clean dependency install does not connect to a DB;
// provide a local placeholder URL only so Prisma can load its config then.
// Run prisma commands from monorepo root: pnpm db:studio / pnpm db:generate / pnpm db:migrate
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ??
  (process.env.npm_lifecycle_event === "postinstall"
    ? "postgresql://vaultfs:vaultfs@localhost:5432/vaultfs?schema=public"
    : undefined);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
