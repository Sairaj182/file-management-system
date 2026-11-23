import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const categories = ["unit", "whitebox", "blackbox", "integration", "acceptance", "usability", "performance"];
const directory = "release-artifacts";
const report = directory + "/test-summary.json";

if (process.argv[2] === "report") {
  const result = JSON.parse(await readFile(report, "utf8"));
  console.log("VaultFS test results from " + result.timestamp);
  console.table(result.checks);
  process.exitCode = result.checks.every(item => item.status === "PASS") ? 0 : 1;
} else {
  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error("Run with pnpm test:all");
  const checks = [];
  for (const category of categories) {
    const started = performance.now();
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, [pnpm, "test:" + category], { stdio: "inherit" });
      child.once("error", () => resolve(1));
      child.once("exit", status => resolve(status ?? 1));
    });
    checks.push({ category, status: code === 0 ? "PASS" : "FAIL", exitCode: code, seconds: Number(((performance.now() - started) / 1000).toFixed(2)) });
  }
  await mkdir(directory, { recursive: true });
  await writeFile(report, JSON.stringify({ timestamp: new Date().toISOString(), checks }, null, 2));
  console.table(checks);
  process.exitCode = checks.every(item => item.status === "PASS") ? 0 : 1;
}
