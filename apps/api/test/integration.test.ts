import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../../../.env.test.local", import.meta.url)) });

for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD"]) {
  assert.ok(process.env[key], `Missing ${key}; configure the ignored .env.test.local file`);
}

const origin = "http://localhost:3000";
let app: Awaited<ReturnType<typeof import("../src/app").buildApp>>;
let prisma: typeof import("@repo/database").prisma;
let baseUrl: string;
let tempStorageRoot: string;
let pngFixture: Buffer;

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function request(path: string, options: RequestInit = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      origin,
      ...(options.body && !isFormData ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function post(path: string, body: unknown, cookie?: string) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

async function login(email: string, password: string) {
  const response = await post("/api/auth/sign-in/email", { email, password });
  const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookie = cookies.map((value) => value.split(";", 1)[0]).find((value) => /session_token=/.test(value));
  if (response.status !== 200 || !cookie) {
    const responseBody = await response.text();
    assert.fail(`Better Auth login failed (${response.status}): ${responseBody}`);
  }
  return cookie;
}

function withCookie(cookie: string): RequestInit {
  return { headers: { cookie } };
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

let adminCookie: string;
let createdUserId: string;
let createdUserEmail: string;
let createdUserPassword: string;
let customRoleId: string;
let dockyardProvisionerRoleId: string;

async function createIntegrationUser(label: string, dockyardId?: string, role = "VIEWER") {
  const email = `${label}-${randomUUID()}@vaultfs-test.invalid`;
  const password = `Vault-${randomUUID()}-Dd6!`;
  const targetId = dockyardId ?? (await createDockyardFor(adminCookie, `Fixture for ${label}`)).id;
  const response = await post("/api/users", { email, password, dockyardId: targetId, role }, adminCookie);
  assert.equal(response.status, 201);
  const userId = (await responseJson(response)).user.id as string;
  return { userId, email, password, cookie: await login(email, password) };
}

async function createDockyardFor(cookie: string, notes: string) {
  const response = await post("/api/dockyard", { notes }, cookie);
  assert.equal(response.status, 201);
  return (await responseJson(response)).data as { id: string; createdById: string };
}

before(async () => {
  const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  assert.equal(databaseName, "vaultfs_p1test_1117a", "integration tests require the disposable Checkpoint test database");
  const port = await unusedPort();
  tempStorageRoot = await mkdtemp(path.join(tmpdir(), "vaultfs-checkpoint4-"));
  process.env.API_PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.BETTER_AUTH_URL = `http://127.0.0.1:${port}/api/auth`;
  process.env.FILE_STORAGE_ROOT = tempStorageRoot;
  process.env.FILE_SIGNING_SECRET = randomBytes(48).toString("base64url");
  delete process.env.FILE_PUBLIC_BASE_URL;
  process.env.FILE_MAX_SIZE_BYTES = "1048576";
  process.env.FILE_MAX_COUNT = "5";

  const [{ buildApp }, database, sharpModule] = await Promise.all([
    import("../src/app"),
    import("@repo/database"),
    import("sharp"),
  ]);
  pngFixture = await sharpModule.default({ create: { width: 2, height: 2, channels: 3, background: { r: 48, g: 120, b: 200 } } }).png().toBuffer();
  prisma = database.prisma;
  app = buildApp();
  const { requireApiKey } = await import("../src/middleware/api-key-auth");
  app.get("/__test/api-key/write", { preHandler: [requireApiKey({ requiredScopes: ["WRITE"] })] }, async () => ({ success: true }));
  app.get("/__test/api-key/dockyard/:dockyardId", { preHandler: [requireApiKey({ requestedDockyardId: (request) => (request.params as { dockyardId: string }).dockyardId })] }, async () => ({ success: true }));
  await app.listen({ port, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${port}`;
  adminCookie = await login(process.env.SUPER_ADMIN_EMAIL!, process.env.SUPER_ADMIN_PASSWORD!);
});

after(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  if (tempStorageRoot) {
    const expectedParent = path.resolve(tmpdir());
    const resolved = path.resolve(tempStorageRoot);
    assert.ok(resolved.startsWith(`${expectedParent}${path.sep}`), "test storage must remain under the OS temp directory");
    assert.ok(path.basename(resolved).startsWith("vaultfs-checkpoint4-"), "test storage path must be uniquely named");
    await rm(resolved, { recursive: true, force: true });
  }
});

test("Better Auth login, logout, and expired sessions work over HTTP", async () => {
  const me = await request("/api/users/me", withCookie(adminCookie));
  assert.equal(me.status, 200);
  assert.equal((await responseJson(me)).isSuperAdmin, true);

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: process.env.SUPER_ADMIN_EMAIL! } });
  const session = await prisma.session.findFirstOrThrow({ where: { userId: admin.id }, orderBy: { createdAt: "desc" } });
  await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  assert.equal((await request("/api/users/me", withCookie(adminCookie))).status, 401);

  adminCookie = await login(process.env.SUPER_ADMIN_EMAIL!, process.env.SUPER_ADMIN_PASSWORD!);
  const logout = await post("/api/auth/sign-out", {}, adminCookie);
  assert.equal(logout.status, 200);
  assert.equal((await request("/api/users/me", withCookie(adminCookie))).status, 401);
  adminCookie = await login(process.env.SUPER_ADMIN_EMAIL!, process.env.SUPER_ADMIN_PASSWORD!);
});

test("public email signup cannot create a Better Auth account", async () => {
  const email = `public-${randomUUID()}@vaultfs-test.invalid`;
  const response = await post("/api/auth/sign-up/email", {
    name: "Public signup", email, password: "Disposable-password-8",
  });
  assert.ok([400, 403, 404].includes(response.status));
  assert.equal(await prisma.user.count({ where: { email } }), 0);
});

test("Super Admin provisions an account and its Dockyard membership in one audited action", async () => {
  const dockyard = await createDockyardFor(adminCookie, "Provisioning scope");
  const other = await createDockyardFor(adminCookie, "Unrelated scope");
  const admin = await createIntegrationUser("provisioning-admin", dockyard.id, "ADMIN");
  const manager = await createIntegrationUser("provisioning-manager", dockyard.id, "MANAGER");
  const viewer = await createIntegrationUser("provisioning-viewer", dockyard.id);
  const regular = await createIntegrationUser("provisioning-regular-user", other.id);

  const email = `provisioned-${randomUUID()}@vaultfs-test.invalid`;
  const password = "Disposable-initial-password-8";
  const input = {
    email: ` ${email.toUpperCase()} `, password, dockyardId: dockyard.id, role: "VIEWER",
  };
  assert.equal((await post("/api/users", input)).status, 401);
  for (const account of [admin, manager, viewer, regular]) {
    assert.equal((await post("/api/users", input, account.cookie)).status, 403);
  }
  assert.equal((await post("/api/users", { ...input, dockyardId: other.id }, admin.cookie)).status, 403);
  for (const invalid of [{ dockyardId: undefined }, { role: undefined }, { roleIds: ["Super Admin"] }, { password: "short" }, { designation: "Operations" }, { role: "SUPER_ADMIN" }]) {
    assert.equal((await post("/api/users", { ...input, ...invalid }, adminCookie)).status, 400);
  }
  assert.equal((await request("/api/users/directory?search=provisioning", withCookie(adminCookie))).status, 404);
  assert.equal((await post(`/api/dockyard/${dockyard.id}/members`, { userId: regular.userId, role: "VIEWER" }, adminCookie)).status, 404);
  assert.equal((await request("/api/users", {
    method: "POST", headers: { origin: "https://other.invalid", cookie: adminCookie },
    body: JSON.stringify(input),
  })).status, 403);
  assert.equal((await post("/api/users", { ...input, dockyardId: randomUUID() }, adminCookie)).status, 404);
  assert.equal(await prisma.user.count({ where: { email } }), 0);

  const [one, two] = await Promise.all([
    post("/api/users", input, adminCookie),
    post("/api/users", { ...input, email }, adminCookie),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [201, 409]);
  const { user } = await responseJson(one.status === 201 ? one : two);
  assert.equal(user.email, email);
  assert.equal((await post("/api/users", { ...input, dockyardId: other.id }, adminCookie)).status, 409);
  assert.equal(await prisma.dockyardMember.count({ where: { userId: user.id } }), 1);
  assert.ok(!Object.hasOwn(user, "password"));
  const membership = await prisma.dockyardMember.findUniqueOrThrow({ where: { dockyardId_userId: { dockyardId: dockyard.id, userId: user.id } } });
  assert.equal(membership.role, "VIEWER");
  assert.equal(await prisma.userRole.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.userCreationAudit.count({ where: { actorUserId: dockyard.createdById, targetUserId: user.id, dockyardId: dockyard.id } }), 1);
  assert.equal((await request("/api/users/me", withCookie(await login(email, password)))).status, 200);
  assert.equal((await request(`/api/users/${user.id}`, { method: "PUT", ...withCookie(admin.cookie), body: JSON.stringify({ email: regular.email }) })).status, 403);
  assert.equal((await post(`/api/users/${user.id}/ban`, {}, admin.cookie)).status, 403);
});

test("admin-created credentials log in and password reset uses the same Better Auth format", async () => {
  createdUserEmail = `phase1-${randomUUID()}@vaultfs-test.invalid`;
  createdUserPassword = `Initial-${randomUUID()}-Aa9!`;
  const dockyard = await createDockyardFor(adminCookie, "Credentials fixture");
  const created = await post("/api/users", {
    email: createdUserEmail,
    password: createdUserPassword,
    dockyardId: dockyard.id,
    role: "VIEWER",
  }, adminCookie);
  assert.equal(created.status, 201);
  createdUserId = (await responseJson(created)).user.id;

  const credential = await prisma.account.findFirstOrThrow({
    where: { userId: createdUserId, providerId: "credential" },
  });
  const { verifyPassword } = await import("better-auth/crypto");
  assert.ok(credential.password);
  assert.equal(await verifyPassword({ hash: credential.password, password: createdUserPassword }), true);

  const originalCookie = await login(createdUserEmail, createdUserPassword);
  assert.equal((await request("/api/users/me", withCookie(originalCookie))).status, 200);

  const resetPassword = `Reset-${randomUUID()}-Bb8!`;
  const reset = await request(`/api/users/${createdUserId}/password`, {
    method: "PATCH",
    body: JSON.stringify({ newPassword: resetPassword }),
    headers: { cookie: adminCookie, "content-type": "application/json" },
  });
  assert.equal(reset.status, 200);
  assert.equal((await request("/api/users/me", withCookie(originalCookie))).status, 401);
  assert.notEqual((await post("/api/auth/sign-in/email", { email: createdUserEmail, password: createdUserPassword })).status, 200);

  const resetCookie = await login(createdUserEmail, resetPassword);
  assert.equal((await request("/api/users/me", withCookie(resetCookie))).status, 200);
  createdUserPassword = resetPassword;
});

test("legacy local credentials remain usable after issuer backfill", async () => {
  const { hashPassword } = await import("better-auth/crypto");
  const userId = randomUUID();
  const email = `legacy-${userId}@vaultfs-test.invalid`;
  const password = `Legacy-${randomUUID()}-Cc7!`;
  await prisma.user.create({ data: { id: userId, name: "Legacy Credential Fixture", email } });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      issuer: null,
      userId,
      password: await hashPassword(password),
    },
  });

  // Execute the checked-in idempotent data migration against a fresh legacy fixture.
  const migration = await readFile(new URL(
    "../../../packages/database/prisma/migrations/20261117090000_backfill_credential_issuer/migration.sql",
    import.meta.url,
  ), "utf8");
  await prisma.$executeRawUnsafe(migration);
  const migratedAccount = await prisma.account.findFirstOrThrow({ where: { userId, providerId: "credential" } });
  assert.equal(migratedAccount.issuer, "local:credential");
  const cookie = await login(email, password);
  assert.equal((await request("/api/users/me", withCookie(cookie))).status, 200);
});

test("Super Admin protection rejects role escalation and unauthorized role assignment", async () => {
  const rolesResponse = await request("/api/roles", withCookie(adminCookie));
  assert.equal(rolesResponse.status, 200);
  const rolesBody = await responseJson(rolesResponse);
  const systemRole = rolesBody.roles.find((role: { name: string }) => role.name === "Super Admin");
  assert.ok(systemRole);

  const systemAssignment = await post(`/api/roles/${systemRole.id}/users`, { userId: createdUserId }, adminCookie);
  assert.equal(systemAssignment.status, 403);

  const userCookie = await login(createdUserEmail, createdUserPassword);
  assert.equal((await post(`/api/roles/${systemRole.id}/users`, { userId: createdUserId }, userCookie)).status, 403);
  const directAssignment = await request(`/api/users/${createdUserId}`, {
    method: "PUT",
    body: JSON.stringify({ roleIds: [systemRole.id] }),
    headers: { cookie: userCookie, "content-type": "application/json" },
  });
  assert.equal(directAssignment.status, 403);

  const createdRole = await post("/api/roles", {
    name: `Dockyard Creator ${randomUUID()}`,
    permissions: [{ resource: "dockyard", action: "create", scope: "any" }],
  }, adminCookie);
  assert.equal(createdRole.status, 200);
  customRoleId = (await responseJson(createdRole)).role.id;
});

test("Dockyard creation requires an authorized role and validates the request", async () => {
  const userCookie = await login(createdUserEmail, createdUserPassword);
  assert.equal((await post("/api/dockyard", { notes: "unauthorized attempt" }, userCookie)).status, 403);

  const unauthorizedAssignment = await post(`/api/roles/${customRoleId}/users`, { userId: createdUserId }, userCookie);
  assert.equal(unauthorizedAssignment.status, 403);

  assert.equal((await post(`/api/roles/${customRoleId}/users`, { userId: createdUserId }, adminCookie)).status, 200);
  const authorizedCookie = await login(createdUserEmail, createdUserPassword);
  assert.equal((await post("/api/dockyard", { notes: "   " }, authorizedCookie)).status, 400);
  const created = await post("/api/dockyard", { notes: "Integration test Dockyard" }, authorizedCookie);
  assert.equal(created.status, 201);
  const payload = await responseJson(created);
  assert.equal(payload.data.status, "ACTIVE");
  assert.equal(payload.data.createdById, createdUserId);
  assert.equal(payload.data.notes, "Integration test Dockyard");
});

test("the migration preserves Dockyards and preserves creator administration", async () => {
  const dockyards = await prisma.dockyards.findMany({ select: { id: true } });
  assert.ok(dockyards.length >= 2, "expected the pre-existing isolated test Dockyards to remain present");

  for (const dockyard of dockyards) {
    const adminCount = await prisma.dockyardMember.count({
      where: { dockyardId: dockyard.id, role: "ADMIN" },
    });
    assert.ok(adminCount >= 1, `preserved Dockyard ${dockyard.id} should retain an owner`);
  }
});

test("membership APIs enforce owner boundaries, isolation, and audited global access", async () => {
  const ownerA = await createIntegrationUser("dock-owner-a");
  const ownerB = await createIntegrationUser("dock-owner-b");
  const outsider = await createIntegrationUser("dock-outsider");
  const globalAdmin = await createIntegrationUser("global-admin");

  const provisionerResponse = await post("/api/roles", {
    name: `Dockyard Provisioner ${randomUUID()}`,
    permissions: [{ resource: "dockyard", action: "create", scope: "any" }],
  }, adminCookie);
  assert.equal(provisionerResponse.status, 200);
  const provisionerId = (await responseJson(provisionerResponse)).role.id as string;
  dockyardProvisionerRoleId = provisionerId;
  for (const userId of [ownerA.userId, ownerB.userId]) {
    const grant = await request(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ roleIds: [provisionerId] }),
      headers: { cookie: adminCookie, "content-type": "application/json" },
    });
    assert.equal(grant.status, 200);
  }

  const dockyardA = await createDockyardFor(ownerA.cookie, "Owned by owner A");
  const dockyardB = await createDockyardFor(ownerB.cookie, "Owned by owner B");
  const viewer = await createIntegrationUser("dock-viewer", dockyardA.id);
  assert.equal(dockyardA.createdById, ownerA.userId);
  assert.equal(dockyardB.createdById, ownerB.userId);

  const ownerMembership = await prisma.dockyardMember.findUniqueOrThrow({
    where: { dockyardId_userId: { dockyardId: dockyardA.id, userId: ownerA.userId } },
  });
  assert.equal(ownerMembership.role, "ADMIN");

  const ownerList = await responseJson(await request("/api/dockyard", withCookie(ownerA.cookie)));
  assert.equal(ownerList.success, "true", "preserve the existing Dockyard list response shape");
  assert.ok(ownerList.data.some((dockyard: { id: string }) => dockyard.id === dockyardA.id));
  assert.ok(!ownerList.data.some((dockyard: { id: string }) => dockyard.id === dockyardB.id));
  assert.equal((await request(`/api/dockyard/${dockyardB.id}`, withCookie(ownerA.cookie))).status, 404);

  assert.equal((await request(`/api/dockyard/${dockyardA.id}`, withCookie(viewer.cookie))).status, 200);
  assert.equal((await request(`/api/dockyard/${dockyardA.id}/members`, withCookie(ownerA.cookie))).status, 200);

  const viewerAdd = await post(`/api/dockyard/${dockyardB.id}/members`, {
    userId: viewer.userId,
    role: "ADMIN",
  }, viewer.cookie);
  assert.equal(viewerAdd.status, 404);
  const viewerChange = await request(`/api/dockyard/${dockyardA.id}/members/${viewer.userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "MANAGER" }),
    headers: { cookie: viewer.cookie, "content-type": "application/json" },
  });
  assert.equal(viewerChange.status, 404);
  const outsiderSelfAdd = await post(`/api/dockyard/${dockyardA.id}/members`, {
    userId: outsider.userId,
    role: "ADMIN",
  }, outsider.cookie);
  assert.equal(outsiderSelfAdd.status, 404);

  const changed = await request(`/api/dockyard/${dockyardA.id}/members/${viewer.userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "MANAGER" }),
    headers: { cookie: ownerA.cookie, "content-type": "application/json" },
  });
  assert.equal(changed.status, 200);
  const managerSelfAdd = await post(`/api/dockyard/${dockyardA.id}/members`, {
    userId: viewer.userId,
    role: "VIEWER",
  }, viewer.cookie);
  assert.equal(managerSelfAdd.status, 404);

  const restored = await request(`/api/dockyard/${dockyardA.id}/members/${viewer.userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "VIEWER" }),
    headers: { cookie: ownerA.cookie, "content-type": "application/json" },
  });
  assert.equal(restored.status, 200);

  const lastAdminRemoval = await request(`/api/dockyard/${dockyardA.id}/members/${ownerA.userId}`, {
    method: "DELETE",
    headers: { cookie: ownerA.cookie },
  });
  assert.equal(lastAdminRemoval.status, 409);

  const globalAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: "Admin" } });
  const assignGlobalAdmin = await request(`/api/users/${globalAdmin.userId}`, {
    method: "PUT",
    body: JSON.stringify({ roleIds: [globalAdminRole.id] }),
    headers: { cookie: adminCookie, "content-type": "application/json" },
  });
  assert.equal(assignGlobalAdmin.status, 200);
  const globalAdminCookie = await login(globalAdmin.email, globalAdmin.password);
  const globalAdminDockyard = await request(`/api/dockyard/${dockyardA.id}`, withCookie(globalAdminCookie));
  assert.equal(globalAdminDockyard.status, 404);
  const globalAdminList = await responseJson(await request("/api/dockyard", withCookie(globalAdminCookie)));
  assert.ok(!globalAdminList.data.some((dockyard: { id: string }) => dockyard.id === dockyardA.id));
  assert.equal((await post(`/api/dockyard/${dockyardA.id}/members`, {
    userId: globalAdmin.userId,
    role: "VIEWER",
  }, globalAdminCookie)).status, 404);

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: process.env.SUPER_ADMIN_EMAIL! } });
  const superAdminAccess = await request(`/api/dockyard/${dockyardA.id}`, withCookie(adminCookie));
  assert.equal(superAdminAccess.status, 200);
  const accessEvent = await prisma.dockyardAuditEvent.findFirst({
    where: {
      dockyardId: dockyardA.id,
      actorUserId: adminUser.id,
      action: "SUPER_ADMIN_DOCKYARD_VIEW",
    },
  });
  assert.ok(accessEvent, "Super Admin cross-membership access must be audited");

  const viewerRemoval = await request(`/api/dockyard/${dockyardA.id}/members/${viewer.userId}`, {
    method: "DELETE",
    headers: { cookie: ownerA.cookie },
  });
  assert.equal(viewerRemoval.status, 200);
});

async function createApiKeyAdmin(label: string) {
  const actor = await createIntegrationUser(label);
  const roleResponse = await post("/api/roles", {
    name: `API Key Provisioner ${randomUUID()}`,
    permissions: [{ resource: "dockyard", action: "create", scope: "any" }],
  }, adminCookie);
  assert.equal(roleResponse.status, 200);
  const roleId = (await responseJson(roleResponse)).role.id as string;
  const grant = await request(`/api/users/${actor.userId}`, { method: "PUT", body: JSON.stringify({ roleIds: [roleId] },), headers: { cookie: adminCookie, "content-type": "application/json" } });
  assert.equal(grant.status, 200);
  return { ...actor, dockyard: await createDockyardFor(actor.cookie, `${label} API key fixture`) };
}

function apiKeyRequest(path: string, key: string, options: RequestInit = {}) {
  return request(path, { ...options, headers: { ...(options.headers ?? {}), "x-api-key": key } });
}

function multipart(files: Array<{ name: string; bytes: Buffer; contentType?: string }>) {
  const form = new FormData();
  for (const file of files) form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.contentType ?? "application/octet-stream" }), file.name);
  return form;
}

test("API key creation discloses the secret once and stores only a digest", async () => {
  const owner = await createApiKeyAdmin("api-key-owner");
  assert.equal((await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"], expiresAt: new Date(Date.now() - 1000).toISOString() }, owner.cookie)).status, 400);
  const created = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { name: "integration", scopes: ["READ", "WRITE"] }, owner.cookie);
  assert.equal(created.status, 201);
  const body = await responseJson(created);
  assert.match(body.secret, /^vfs_live_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(body.data).includes(body.secret), false);
  const row = await prisma.api.findUniqueOrThrow({ where: { id: body.data.id } });
  assert.equal(row.keyDigest, (await import("../src/security/api-key")).digestApiKey(body.secret));
  assert.equal(row.keyPrefix, body.secret.split("_")[2]);
  assert.equal(JSON.stringify(row).includes(body.secret), false);
  const listed = await request(`/api/dockyard/${owner.dockyard.id}/api-keys`, withCookie(owner.cookie));
  assert.equal(listed.status, 200);
  const listedBody = await responseJson(listed);
  assert.equal(JSON.stringify(listedBody).includes(body.secret), false);
  assert.equal(JSON.stringify(listedBody).includes("keyDigest"), false);
  const metadata = await request(`/api/dockyard/${owner.dockyard.id}/api-keys/${body.data.id}`, withCookie(owner.cookie));
  assert.equal(metadata.status, 200);
  assert.equal(JSON.stringify(await responseJson(metadata)).includes(body.secret), false);
  const verified = await apiKeyRequest("/api/integration/me", body.secret);
  assert.equal(verified.status, 200);
  const profile = await responseJson(verified);
  assert.equal(profile.data.dockyardId, owner.dockyard.id);
  assert.deepEqual(profile.data.scopes, ["READ", "WRITE"]);
  assert.equal(JSON.stringify(profile).includes(body.secret), false);
  assert.ok((await prisma.api.findUniqueOrThrow({ where: { id: body.data.id } })).lastUsedAt);
});

test("API key management denies viewers and ordinary global admins; Super Admin access is audited", async () => {
  const owner = await createApiKeyAdmin("api-key-access-owner");
  const viewer = await createIntegrationUser("api-key-viewer");
  const manager = await createIntegrationUser("api-key-manager");
  await prisma.dockyardMember.create({ data: { dockyardId: owner.dockyard.id, userId: viewer.userId, role: "VIEWER", addedById: owner.userId } });
  await prisma.dockyardMember.create({ data: { dockyardId: owner.dockyard.id, userId: manager.userId, role: "MANAGER", addedById: owner.userId } });
  const viewerCreate = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, viewer.cookie);
  assert.equal(viewerCreate.status, 404);
  assert.equal((await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, manager.cookie)).status, 201);
  const ordinaryAdmin = await createIntegrationUser("api-key-global-admin");
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "Admin" } });
  await prisma.userRole.create({ data: { userId: ordinaryAdmin.userId, roleId: adminRole.id } });
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/api-keys`, withCookie(ordinaryAdmin.cookie))).status, 404);
  const elevatedList = await request(`/api/dockyard/${owner.dockyard.id}/api-keys`, withCookie(adminCookie));
  assert.equal(elevatedList.status, 200);
  assert.ok(await prisma.dockyardAuditEvent.count({ where: { dockyardId: owner.dockyard.id, actorUserId: (await prisma.user.findUniqueOrThrow({ where: { email: process.env.SUPER_ADMIN_EMAIL! } })).id, action: "SUPER_ADMIN_API_KEY_LIST" } }));
});

test("API key scopes, Dockyard isolation, invalid credentials, and cookie fallback are denied", async () => {
  const owner = await createApiKeyAdmin("api-key-scope-owner");
  const other = await createApiKeyAdmin("api-key-other-owner");
  const keyResponse = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, owner.cookie);
  const secret = (await responseJson(keyResponse)).secret as string;
  assert.equal((await apiKeyRequest("/__test/api-key/write", secret)).status, 403);
  assert.equal((await apiKeyRequest(`/__test/api-key/dockyard/${other.dockyard.id}`, secret)).status, 403);
  assert.equal((await apiKeyRequest("/api/integration/me", "vfs_live_0000000000000000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", withCookie(owner.cookie))).status, 401);
  const audit = await prisma.dockyardAuditEvent.findMany({ where: { dockyardId: owner.dockyard.id, action: { startsWith: "API_KEY_AUTH_" } } });
  assert.equal(JSON.stringify(audit).includes(secret), false);
});

test("expired, revoked, and inactive-Dockyard API keys are rejected", async () => {
  const owner = await createApiKeyAdmin("api-key-expired-owner");
  const expiredResponse = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"], expiresAt: new Date(Date.now() + 60_000).toISOString() }, owner.cookie);
  const expiredBody = await responseJson(expiredResponse);
  await prisma.api.update({ where: { id: expiredBody.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await apiKeyRequest("/api/integration/me", expiredBody.secret)).status, 401);
  const revokeResponse = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, owner.cookie);
  const revokeBody = await responseJson(revokeResponse);
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/api-keys/${revokeBody.data.id}`, { method: "DELETE", headers: { cookie: owner.cookie } })).status, 204);
  assert.equal((await apiKeyRequest("/api/integration/me", revokeBody.secret)).status, 401);
  const inactive = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, owner.cookie);
  const inactiveBody = await responseJson(inactive);
  await prisma.dockyards.update({ where: { id: owner.dockyard.id }, data: { status: "SUSPENDED" } });
  assert.equal((await apiKeyRequest("/api/integration/me", inactiveBody.secret)).status, 403);
});

test("rotation immediately revokes the old secret and returns a new one once", async () => {
  const owner = await createApiKeyAdmin("api-key-rotation-owner");
  const first = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ", "DELETE"] }, owner.cookie);
  const old = await responseJson(first);
  const rotatedResponse = await post(`/api/dockyard/${owner.dockyard.id}/api-keys/${old.data.id}/rotate`, {}, owner.cookie);
  assert.equal(rotatedResponse.status, 200);
  const rotated = await responseJson(rotatedResponse);
  assert.notEqual(rotated.secret, old.secret);
  assert.equal(rotated.data.id === old.data.id, false);
  assert.equal((await apiKeyRequest("/api/integration/me", old.secret)).status, 401);
  assert.equal((await apiKeyRequest("/api/integration/me", rotated.secret)).status, 200);
  const legacy = await prisma.api.create({ data: { dockId: owner.dockyard.id, createdById: owner.userId } });
  assert.equal((await post(`/api/dockyard/${owner.dockyard.id}/api-keys/${legacy.id}/rotate`, {}, owner.cookie)).status, 409);
});

test("concurrent API key use and revocation leave the credential unusable afterwards", async () => {
  const owner = await createApiKeyAdmin("api-key-race-owner");
  const created = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, owner.cookie);
  const key = await responseJson(created);
  const concurrentUse = apiKeyRequest("/api/integration/me", key.secret);
  const revocation = request(`/api/dockyard/${owner.dockyard.id}/api-keys/${key.data.id}`, { method: "DELETE", headers: { cookie: owner.cookie } });
  const [useResponse, revokeResponse] = await Promise.all([concurrentUse, revocation]);
  assert.ok([200, 401].includes(useResponse.status));
  assert.equal(revokeResponse.status, 204);
  assert.equal((await apiKeyRequest("/api/integration/me", key.secret)).status, 401);
});

test("file API supports scoped upload, list, download, verify, signed download, and deletion", async () => {
  const owner = await createApiKeyAdmin("file-flow-owner");
  const created = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ", "WRITE", "DELETE"] }, owner.cookie);
  const key = await responseJson(created);
  const upload = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, key.secret, { method: "POST", body: multipart([{ name: "tiny.png", bytes: pngFixture, contentType: "text/plain" }]) });
  assert.equal(upload.status, 201);
  const uploaded = await responseJson(upload);
  const file = uploaded.data[0];
  assert.equal(file.state, "AVAILABLE");
  assert.equal(file.contentType, "image/png", "content type comes from the actual bytes, not the client header");
  assert.equal(file.sizeBytes, String(pngFixture.length));
  const expectedSha = (await import("node:crypto")).createHash("sha256").update(pngFixture).digest("hex");
  assert.equal(file.sha256, expectedSha);

  const list = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files?page=1&limit=10`, key.secret);
  assert.equal(list.status, 200);
  assert.ok((await responseJson(list)).data.files.some((item: { id: string }) => item.id === file.id));
  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}`, key.secret)).status, 200);

  const downloaded = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, key.secret);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pngFixture);
  const verified = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/verify`, key.secret, { method: "POST" });
  assert.equal((await responseJson(verified)).data.matches, true);

  const signed = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/signed-url`, key.secret, { method: "POST", body: JSON.stringify({ expiresInSeconds: 2 }) });
  assert.equal(signed.status, 200);
  const signedData = (await responseJson(signed)).data;
  const signedUrl = new URL(signedData.url);
  assert.equal(signedUrl.origin, baseUrl);
  const signedDownload = await request(signedUrl.pathname);
  assert.equal(signedDownload.status, 200, `signed download rejected: ${await signedDownload.clone().text()}`);
  assert.deepEqual(Buffer.from(await signedDownload.arrayBuffer()), pngFixture);
  const tamperedToken = `${signedUrl.pathname.slice(0, -1)}${signedUrl.pathname.endsWith("x") ? "y" : "x"}`;
  assert.equal((await request(tamperedToken)).status, 401);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(signedData.expiresAt) - Date.now()) + 50));
  assert.equal((await request(signedUrl.pathname)).status, 401);

  const lastingSigned = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/signed-url`, key.secret, { method: "POST" });
  const lastingPath = new URL((await responseJson(lastingSigned)).data.url).pathname;

  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}`, key.secret, { method: "DELETE" })).status, 204);
  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, key.secret)).status, 404);
  assert.equal((await request(lastingPath)).status, 404);
});

test("concurrent file deletion never restores download access", async () => {
  const owner = await createApiKeyAdmin("file-concurrent-delete");
  const issued = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ", "WRITE", "DELETE"] }, owner.cookie);
  const key = await responseJson(issued);
  const uploaded = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, key.secret, { method: "POST", body: multipart([{ name: "concurrent.png", bytes: pngFixture }]) });
  const file = (await responseJson(uploaded)).data[0];
  const [download, deletion] = await Promise.all([
    apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, key.secret),
    apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}`, key.secret, { method: "DELETE" }),
  ]);
  assert.ok([200, 404, 503].includes(download.status));
  assert.ok([204, 503].includes(deletion.status));
  if (deletion.status === 503) {
    const { reconcileFiles } = await import("../src/services/files");
    await reconcileFiles();
  }
  assert.equal(await prisma.dockyardFile.findUniqueOrThrow({ where: { id: file.id } }).then((row) => row.state), "DELETED");
  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, key.secret)).status, 404);
});

test("file uploads enforce size, MIME signatures, empty-file, count, scope, Dockyard and revoked-key rules", async () => {
  const owner = await createApiKeyAdmin("file-policy-owner");
  const other = await createApiKeyAdmin("file-policy-other");
  const readOnly = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ"] }, owner.cookie);
  const readKey = await responseJson(readOnly);
  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, readKey.secret, { method: "POST", body: multipart([{ name: "x.png", bytes: pngFixture }]) })).status, 403);
  assert.equal((await apiKeyRequest(`/api/dockyard/${other.dockyard.id}/files`, readKey.secret, { method: "POST", body: multipart([{ name: "x.png", bytes: pngFixture }]) })).status, 403);

  const writerResponse = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["WRITE"] }, owner.cookie);
  const writer = await responseJson(writerResponse);
  const badContent = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, writer.secret, { method: "POST", body: multipart([{ name: "spoof.png", bytes: Buffer.from("MZ executable"), contentType: "image/png" }]) });
  assert.equal(badContent.status, 422);
  const empty = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, writer.secret, { method: "POST", body: multipart([{ name: "empty.png", bytes: Buffer.alloc(0) }]) });
  assert.equal(empty.status, 422);
  const tooLarge = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, writer.secret, { method: "POST", body: multipart([{ name: "large.png", bytes: Buffer.concat([pngFixture, Buffer.alloc(1_048_576)]) }]) });
  assert.equal(tooLarge.status, 413);
  const mixed = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, writer.secret, { method: "POST", body: multipart([{ name: "good.png", bytes: pngFixture }, { name: "bad.png", bytes: Buffer.from("not an image") }]) });
  assert.equal(mixed.status, 207);
  assert.equal((await responseJson(mixed)).data.length, 1);

  const six = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, writer.secret, { method: "POST", body: multipart(Array.from({ length: 6 }, (_, index) => ({ name: `count-${index}.png`, bytes: pngFixture }))) });
  assert.equal(six.status, 207);

  const legacyKey = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["WRITE"] }, owner.cookie);
  const legacy = await responseJson(legacyKey);
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/api-keys/${legacy.data.id}`, { method: "DELETE", headers: { cookie: owner.cookie } })).status, 204);
  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, legacy.secret, { method: "POST", body: multipart([{ name: "revoked.png", bytes: pngFixture }]) })).status, 401);
});

test("Dockyard membership governs session file actions and quarantined files cannot be read", async () => {
  const owner = await createApiKeyAdmin("file-membership-owner");
  const viewer = await createIntegrationUser("file-viewer");
  const manager = await createIntegrationUser("file-manager");
  await prisma.dockyardMember.create({ data: { dockyardId: owner.dockyard.id, userId: viewer.userId, role: "VIEWER", addedById: owner.userId } });
  await prisma.dockyardMember.create({ data: { dockyardId: owner.dockyard.id, userId: manager.userId, role: "MANAGER", addedById: owner.userId } });
  const ownerUpload = await request(`/api/dockyard/${owner.dockyard.id}/files`, { method: "POST", body: multipart([{ name: "member.png", bytes: pngFixture }]), headers: { cookie: owner.cookie } });
  assert.equal(ownerUpload.status, 201);
  const file = (await responseJson(ownerUpload)).data[0];
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/files`, { method: "POST", body: multipart([{ name: "denied.png", bytes: pngFixture }]), headers: { cookie: viewer.cookie } })).status, 404);
  assert.ok(await prisma.dockyardAuditEvent.count({ where: { dockyardId: owner.dockyard.id, actorUserId: viewer.userId, action: "FILE_AUTHORIZATION_DENIED" } }));
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, withCookie(viewer.cookie))).status, 200);
  const managerUpload = await request(`/api/dockyard/${owner.dockyard.id}/files`, { method: "POST", body: multipart([{ name: "manager.png", bytes: pngFixture }]), headers: { cookie: manager.cookie } });
  assert.equal(managerUpload.status, 201);

  const fileRow = await prisma.dockyardFile.findUniqueOrThrow({ where: { id: file.id } });
  await prisma.dockyardFile.update({ where: { id: file.id }, data: { state: "QUARANTINED" } });
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, withCookie(viewer.cookie))).status, 404);
  assert.equal((await request(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/signed-url`, { method: "POST", body: "{}", headers: { cookie: owner.cookie } })).status, 404);
  assert.equal(await prisma.dockyardFile.findUniqueOrThrow({ where: { id: file.id } }).then((row) => row.storageKey), fileRow.storageKey);
});

test("checksum mismatch quarantines the file, and reconciliation repairs interrupted storage states", async () => {
  const owner = await createApiKeyAdmin("file-reconciliation-owner");
  const keyResponse = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["READ", "WRITE"] }, owner.cookie);
  const key = await responseJson(keyResponse);
  const uploaded = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, key.secret, { method: "POST", body: multipart([{ name: "corrupt.png", bytes: pngFixture }]) });
  const file = (await responseJson(uploaded)).data[0];
  const row = await prisma.dockyardFile.findUniqueOrThrow({ where: { id: file.id } });
  await writeFile(path.join(tempStorageRoot, "objects", row.storageKey.slice(0, 2), row.storageKey), Buffer.from("changed content"));
  const verified = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/verify`, key.secret, { method: "POST" });
  assert.equal((await responseJson(verified)).data.matches, false);
  assert.equal(await prisma.dockyardFile.findUniqueOrThrow({ where: { id: file.id } }).then((item) => item.state), "QUARANTINED");
  assert.equal((await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files/${file.id}/download`, key.secret)).status, 404);

  const { storage } = await import("../src/storage");
  const { createStorageKey } = await import("../src/security/file-policy");
  const { reconcileFiles } = await import("../src/services/files");
  const stagedKey = createStorageKey();
  const stagedWrite = await storage.writeStream(stagedKey, Readable.from([pngFixture]), 1_048_576);
  const stagedRow = await prisma.dockyardFile.create({ data: { dockyardId: owner.dockyard.id, uploadedById: owner.userId, storageKey: stagedKey, originalName: "recover.png", contentType: "image/png", sizeBytes: BigInt(stagedWrite.sizeBytes), sha256: stagedWrite.sha256, state: "STAGED" } });
  const deletingKey = createStorageKey();
  const deletingWrite = await storage.writeStream(deletingKey, Readable.from([pngFixture]), 1_048_576);
  await storage.finalize(deletingKey);
  const deletingRow = await prisma.dockyardFile.create({ data: { dockyardId: owner.dockyard.id, uploadedById: owner.userId, storageKey: deletingKey, originalName: "recover-delete.png", contentType: "image/png", sizeBytes: BigInt(deletingWrite.sizeBytes), sha256: deletingWrite.sha256, state: "DELETING" } });
  const orphanKey = createStorageKey();
  await storage.writeStream(orphanKey, Readable.from([pngFixture]), 1_048_576);
  const reconciled = await reconcileFiles();
  assert.equal(reconciled.finalized, 1);
  assert.equal(reconciled.deleted, 1);
  assert.equal(reconciled.orphanStagesRemoved, 1);
  assert.equal((await prisma.dockyardFile.findUniqueOrThrow({ where: { id: stagedRow.id } })).state, "AVAILABLE");
  assert.equal((await prisma.dockyardFile.findUniqueOrThrow({ where: { id: deletingRow.id } })).state, "DELETED");
});

test("a PostgreSQL metadata insert failure leaves no staged object", async () => {
  const owner = await createApiKeyAdmin("file-database-failure-owner");
  const issued = await post(`/api/dockyard/${owner.dockyard.id}/api-keys`, { scopes: ["WRITE"] }, owner.cookie);
  const key = await responseJson(issued);
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION public.vaultfs_test_fail_file_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."originalName" = 'db-failure.png' THEN RAISE EXCEPTION 'test database failure'; END IF; RETURN NEW; END; $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER vaultfs_test_fail_file_insert BEFORE INSERT ON "DockyardFile" FOR EACH ROW EXECUTE FUNCTION public.vaultfs_test_fail_file_insert()`);
  try {
    const response = await apiKeyRequest(`/api/dockyard/${owner.dockyard.id}/files`, key.secret, { method: "POST", body: multipart([{ name: "db-failure.png", bytes: pngFixture }]) });
    assert.equal(response.status, 503);
    const entries = await (await import("node:fs/promises")).readdir(path.join(tempStorageRoot, ".staging"));
    assert.equal(entries.length, 0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vaultfs_test_fail_file_insert ON "DockyardFile"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.vaultfs_test_fail_file_insert()`);
  }
});

test("concurrent Admin removals preserve at least one Dockyard Admin", async () => {
  const owner = await createIntegrationUser("concurrent-owner");
  assert.ok(dockyardProvisionerRoleId, "membership integration test should create its own provisioning role");
  const grant = await request(`/api/users/${owner.userId}`, {
    method: "PUT",
    body: JSON.stringify({ roleIds: [dockyardProvisionerRoleId] }),
    headers: { cookie: adminCookie, "content-type": "application/json" },
  });
  assert.equal(grant.status, 200);

  const dockyard = await createDockyardFor(owner.cookie, "Concurrent owner invariant");
  const secondAdmin = await createIntegrationUser("concurrent-second-owner", dockyard.id, "ADMIN");

  const removals = await Promise.all([
    request(`/api/dockyard/${dockyard.id}/members/${owner.userId}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    }),
    request(`/api/dockyard/${dockyard.id}/members/${secondAdmin.userId}`, {
      method: "DELETE",
      headers: { cookie: adminCookie },
    }),
  ]);
  assert.deepEqual(removals.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await prisma.dockyardMember.count({ where: { dockyardId: dockyard.id, role: "ADMIN" } }), 1);
});

