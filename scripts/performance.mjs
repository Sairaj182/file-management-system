import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { api, provision, request, upload } from "./release-http.mjs";

const exec = promisify(execFile);
const sharp = createRequire(new URL("../apps/api/package.json", import.meta.url))("sharp");
const fixture = await sharp(randomBytes(128 * 128 * 3), { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
if (fixture.length > 65536) throw new Error("Benchmark fixture exceeds 64 KiB");
const sample = async () => {
  const { stdout } = await exec("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}",
    "vaultfs-release-test-api-1", "vaultfs-release-test-postgres-1"], { timeout: 8000 });
  return stdout.trim().split(/\r?\n/);
};
const { route, auth, session, keyId } = await provision("Performance");
const baseline = await upload(route, auth, "download.png", fixture);
const resources = { idle: await sample(), during: [] };
const kinds = ["auth", "list", "download", "upload"];
const timings = Object.fromEntries(kinds.map(kind => [kind, []]));
let errors = 0;
let bytes = 0;
const created = [baseline.id];
const count = 40;
const batchIntervalMs = 600;
const maxConcurrent = 2;
const active = new Set();
let peakConcurrent = 0;
const started = performance.now();
const middle = setTimeout(() => {
  void sample().then(value => { resources.during = value; })
    .catch(() => { resources.during = ["unavailable"]; });
}, 5000);
try {
  for (let index = 0; index < count; index++) {
    if (performance.now() - started >= 25_000) break;
    if (index % maxConcurrent === 0) await new Promise(resolve => setTimeout(resolve, batchIntervalMs));
    if (active.size >= maxConcurrent) await Promise.race(active);
    if (performance.now() - started >= 25_000) break;
    const kind = kinds[index % kinds.length];
    const launch = performance.now();
    const task = (async () => {
      if (kind === "upload") {
        created.push((await upload(route, auth, "load-" + index + ".png", fixture)).id);
        bytes += fixture.length;
      } else {
        const path = kind === "auth" ? "/api/integration/me" : kind === "list" ?
          route + "/files?limit=20" : route + "/files/" + baseline.id + "/download";
        const response = await request(api, path, { headers: auth });
        const payload = await response.arrayBuffer();
        if (kind === "download") {
          if (!Buffer.from(payload).equals(fixture)) throw new Error("Download bytes differed");
          bytes += payload.byteLength;
        }
      }
      timings[kind].push(Number((performance.now() - launch).toFixed(2)));
    })().catch(() => { errors++; }).finally(() => active.delete(task));
    active.add(task);
    peakConcurrent = Math.max(peakConcurrent, active.size);
  }
  await Promise.all(active);
} finally {
  clearTimeout(middle);
  resources.after = await sample();
  for (const id of created) await request(api, route + "/files/" + id, { method: "DELETE", headers: auth }, 204);
  await request(api, route + "/api-keys/" + keyId, {
    method: "DELETE",
    headers: { cookie: session.cookie, origin: session.origin },
  }, 204);
}
const seconds = (performance.now() - started) / 1000;
const results = Object.fromEntries(kinds.map(kind => {
  const values = timings[kind].sort((a, b) => a - b);
  return [kind, { count: values.length, p50Ms: values[Math.ceil(values.length * 0.50) - 1], p95Ms: values[Math.ceil(values.length * 0.95) - 1] }];
}));
const ok = errors === 0 && peakConcurrent === maxConcurrent &&
  resources.during.length === 2 &&
  kinds.every(kind => results[kind].count === 10 && results[kind].p95Ms < 1000);
const report = { ok, maxConcurrent, peakConcurrent, maxLaunchRate: maxConcurrent * 1000 / batchIntervalMs, fixtureBytes: fixture.length, errors, measuredBytes: bytes, elapsedIncludingCleanupSeconds: seconds, results, resources };
report.transferRates = Object.fromEntries(["upload", "download"].map(kind =>
  [kind, Math.round(fixture.length * timings[kind].length * 1000 / timings[kind].reduce((a, b) => a + b, 0))]));
await mkdir("release-artifacts", { recursive: true });
await writeFile("release-artifacts/performance.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = ok ? 0 : 1;
