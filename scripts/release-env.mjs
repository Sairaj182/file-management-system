import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const secret = () => randomBytes(32).toString("hex");
const database = "vaultfs_release_test";
const password = secret();
const values = {
  POSTGRES_DB: database,
  POSTGRES_USER: database,
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://${database}:${password}@postgres:5432/${database}`,
  RELEASE_API_PORT: "4415",
  RELEASE_WEB_PORT: "4416",
  VAULTFS_TAG: "checkpoint6",
  BETTER_AUTH_URL: "http://127.0.0.1:4415/api/auth",
  FILE_PUBLIC_BASE_URL: "http://127.0.0.1:4415",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:4415/api",
  WEB_ORIGIN: "http://127.0.0.1:4416",
  SUPER_ADMIN_EMAIL: "release-admin@vaultfs-test.invalid",
  SUPER_ADMIN_PASSWORD: secret(),
  BETTER_AUTH_SECRET: secret(),
  JWT_SECRET: secret(),
  FILE_SIGNING_SECRET: secret(),
};
await mkdir("release-artifacts", { recursive: true, mode: 0o700 });
await writeFile("release-artifacts/primary.env", Object.entries(values).map(([name, value]) => name + "=" + value).join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log("Created private release-artifacts/primary.env for the disposable release project.");
