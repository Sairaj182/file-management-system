import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { api, web, fixture, guard, provision, request, upload } from "./release-http.mjs";

guard();
const primary = ["--env-file", "release-artifacts/primary.env", "-f", "compose.release.yml", "-p", "vaultfs-release-test"];
const restored = ["--env-file", "release-artifacts/restore.env", "-f", "compose.release.yml", "-p", "vaultfs-release-restore"];
const steps = [];
const composeEnv = { ...process.env };
for (const key of Object.keys(parseEnv(await readFile("release-artifacts/primary.env", "utf8")))) {
  if (!key.startsWith("SUPER_ADMIN_")) delete composeEnv[key];
}
function docker(args, { input, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: composeEnv, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
    child.once("error", reject);
    child.once("close", code => {
      if (code !== 0) reject(new Error("Docker " + (args[0] === "compose" ? args[args.indexOf("-p") + 2] : args[0]) + " failed with exit code " + code));
      else resolve(binary ? Buffer.concat(output) : Buffer.concat(output).toString().trim());
    });
  });
}
const compose = (project, ...args) => docker(["compose", ...project, ...args]);
function pass(label) { steps.push(label); console.log("PASS " + label); }

if (process.argv[2] === "start") {
  await compose(primary, "up", "-d", "--wait", "postgres");
  const prisma = ["run", "--rm", "--no-deps", "-T", "-w", "/app/packages/database", "api", "node", "node_modules/prisma/build/index.js", "migrate"];
  await compose(primary, ...prisma, "deploy");
  console.log(await compose(primary, ...prisma, "status"));
  pass("Explicit migration and clean migration ledger");
  await compose(primary, "run", "--rm", "--no-deps", "-T", "-e", "SUPER_ADMIN_EMAIL", "-e", "SUPER_ADMIN_PASSWORD",
    "api", "node", "/app/apps/api/node_modules/tsx/dist/cli.mjs", "/app/packages/database/prisma/seed/index.ts");
  pass("Explicit bootstrap");
  await compose(primary, "up", "-d", "--wait");
  pass("Compose service health");
} else if (process.argv[2] === "restore") {
  try {
    const apiOwner = await compose(primary, "exec", "-T", "api", "sh", "-c", "id -u; stat -c %u /var/lib/vaultfs");
    const webUser = await compose(primary, "exec", "-T", "web", "id", "-u");
    if (apiOwner !== "1001\n1001" || webUser !== "1001") throw new Error("App UID or object volume owner differed");
    const policy = await docker(["inspect", "--format", "{{.HostConfig.RestartPolicy.Name}}", "vaultfs-release-test-api-1"]);
    const pgPorts = JSON.parse(await docker(["inspect", "--format", "{{json .HostConfig.PortBindings}}", "vaultfs-release-test-postgres-1"]));
    if (policy !== "unless-stopped" || Object.keys(pgPorts ?? {}).length) throw new Error("Unexpected restart or PostgreSQL port policy");
    pass("Non-root app services, storage ownership, restart policy and unpublished PostgreSQL");
    await request(api, "/api/health");
    const loginPage = await request(web, "/login");
    if (!loginPage.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")) throw new Error("Missing dashboard framing protection");
    await request(web, "/vault-api/dockyard", { method: "POST", headers: { origin: "https://untrusted.invalid" } }, 403);
    const { route, auth, session } = await provision("Recovery");
    await request(api, route + "/files", { method: "POST", headers: { cookie: session.cookie, origin: "https://untrusted.invalid" } }, 403);
    await request(web, "/dockyards", { headers: { cookie: session.cookie } });
    const file = await upload(route, auth, "recovery.png");
    const filePath = route + "/files/" + file.id;
    const signed = await request(api, filePath + "/signed-url", {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresInSeconds: 300 }),
    });
    const signedPath = new URL((await signed.json()).data.url).pathname;
    const verify = async base => {
      const { data } = await (await request(base, filePath, { headers: auth })).json();
      if (data.sha256 !== createHash("sha256").update(fixture).digest("hex") ||
          data.sizeBytes !== String(fixture.length)) throw new Error("Metadata did not match the saved bytes");
      for (const route of [filePath + "/download", signedPath]) {
        const response = await request(base, route, { headers: route === signedPath ? {} : auth });
        if (!Buffer.from(await response.arrayBuffer()).equals(fixture)) throw new Error("Recovered bytes did not match");
      }
    };
    await verify(api);
    pass("Runtime cookie, origin denial, web-to-API, health, metadata, download and signed download");

    await compose(primary, "stop", "api", "web");
    const stopped = await docker(["inspect", "--format", "{{.State.ExitCode}}", "vaultfs-release-test-api-1"]);
    if (stopped !== "0" || !(await compose(primary, "logs", "api")).includes("API shutdown complete")) throw new Error("API did not shut down gracefully");
    pass("Graceful API shutdown on SIGTERM");
    await compose(primary, "up", "-d", "--wait", "--force-recreate", "api", "web");
    await verify(api);
    pass("Objects and credentials survived API and web recreation");

    await compose(primary, "stop", "postgres");
    try {
      for (let attempt = 0; ; attempt++) {
        try { await request(api, "/api/health", {}, 503); break; }
        catch (error) { if (attempt >= 4) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
      }
    } finally {
      await compose(primary, "up", "-d", "--wait");
    }
    await request(api, "/api/health");
    pass("API readiness returns 503 with PostgreSQL stopped and recovers after restart");

    await compose(primary, "stop", "web", "api");
    try {
      const dump = "release-artifacts/metadata.dump";
      await compose(primary, "exec", "-T", "postgres", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/vaultfs-release.dump');
      await docker(["cp", "vaultfs-release-test-postgres-1:/tmp/vaultfs-release.dump", dump]);
      const archive = await docker(["compose", ...primary, "run", "--rm", "--no-deps", "-T", "api", "tar", "-C", "/var/lib/vaultfs", "-cf", "-", "."], { binary: true });
      await writeFile("release-artifacts/objects.tar", archive);
      await copyFile("release-artifacts/primary.env", "release-artifacts/secrets-recovery.env");
      pass("Quiesced writer backup of metadata, objects and separately retained secrets");

      const secrets = await readFile("release-artifacts/secrets-recovery.env", "utf8");
      await writeFile("release-artifacts/restore.env", secrets.replaceAll(/(?<=[:=])4415(?=\/|\r?$)/gm, "4425").replaceAll(/(?<=[:=])4416(?=\/|\r?$)/gm, "4426"));
      await compose(restored, "up", "-d", "--wait", "postgres");
      const tables = await compose(restored, "exec", "-T", "postgres", "sh", "-c", 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = \'public\'"');
      if (tables !== "0") throw new Error("Restore environment must start with an empty PostgreSQL database");
      const target = "vaultfs-release-restore-postgres-1:/tmp/vaultfs-release.dump";
      await docker(["cp", path.resolve(dump), target]);
      await compose(restored, "exec", "-T", "postgres", "sh", "-c", 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error /tmp/vaultfs-release.dump');
      await docker(["compose", ...restored, "run", "--rm", "--no-deps", "-T", "api", "tar", "-C", "/var/lib/vaultfs", "-xf", "-"], { input: archive });
      await compose(restored, "up", "-d", "--wait");
      await verify("http://127.0.0.1:4425");
      const who = await (await request("http://127.0.0.1:4425", "/api/users/me", { headers: { cookie: session.cookie } })).json();
      if (!who.isSuperAdmin) throw new Error("Restored session did not retain expected role");
      await request("http://127.0.0.1:4426", "/dockyards", { headers: { cookie: session.cookie } });
      pass("Restored metadata, object bytes, key digest, signing secret and Better Auth session");
    } finally {
      await compose(primary, "up", "-d", "--wait");
    }
  } finally {
    await writeFile("release-artifacts/runtime.json", JSON.stringify({ passed: steps }, null, 2));
  }
} else {
  throw new Error("Use release-docker.mjs start or restore");
}
