import { spawn } from "node:child_process";
import { guard } from "./release-http.mjs";

guard();
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["e2e/run.mjs", "acceptance"], {
    cwd: "apps/web",
    stdio: "inherit",
    env: { ...process.env, VAULTFS_DOCKER_E2E: "1" },
  });
  child.once("error", reject);
  child.once("exit", result => resolve(result ?? 1));
});
process.exitCode = code;
