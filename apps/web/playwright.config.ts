import { defineConfig } from "@playwright/test";

const api = "http://127.0.0.1:4315/api";
const web = "http://127.0.0.1:4316";
const database = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/placeholder",
);
if (
  database.pathname !== "/vaultfs_p1test_1117a" ||
  database.hostname !== "127.0.0.1" ||
  database.port !== "5434"
) {
  throw new Error(
    "Dashboard tests require the disposable VaultFS database at 127.0.0.1:5434.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: web, browserName: "chromium", actionTimeout: 10_000 },
  webServer: [
    {
      command: "pnpm --filter api run start",
      cwd: "../..",
      port: 4315,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        API_PORT: "4315",
        BETTER_AUTH_URL: api + "/auth",
        CORS_ORIGIN: web,
        COOKIE_DOMAIN: "",
        FILE_PUBLIC_BASE_URL: "http://127.0.0.1:4315",
      },
      timeout: 60_000,
    },
    {
      command: "pnpm exec next dev -H 127.0.0.1 -p 4316",
      port: 4316,
      env: { API_URL: api, NEXT_PUBLIC_API_URL: api, WEB_ORIGIN: web },
      timeout: 60_000,
    },
  ],
});
