import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const storage = await mkdtemp(join(tmpdir(), "vaultfs-dashboard-"));
const suite = process.argv[2];
if (suite !== "acceptance" && suite !== "usability")
  throw new Error("Unknown dashboard test suite.");

try {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("@playwright/test/cli"),
        "test",
        suite + ".spec.ts",
        "--output",
        "test-results/" + suite,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          FILE_STORAGE_ROOT: storage,
          FILE_SIGNING_SECRET: randomBytes(32).toString("hex"),
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = status;
} finally {
  await rm(storage, { recursive: true, force: true });
}
