import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  canAssignRoleThroughRoleEndpoint,
  isUntrustedCookieMutation,
  publicHealthResponse,
  safeSessionLogContext,
} from "./security/policies";
import { createDockyardSchema } from "./routes/admin/dockyard-schema";
import { normalizeRecoveryPhone } from "./utils/phone";
import { hasDockyardCapability } from "./security/dockyard-policy";
import { apiKeyDigestMatches, apiKeyFailureLogContext, apiKeyRateLimitKey, createApiKeyMaterial, parseApiKeyPrefix, toDatabaseScopes, toExternalScopes } from "./security/api-key";
import { createSignedFileToken, createStorageKey, inspectAllowedContent, normalizeFilename, verifySignedFileToken } from "./security/file-policy";
import { LocalFilesystemStorage } from "./storage/local-filesystem";
import { StorageUnavailableError } from "./storage/provider";

test("session log context excludes all credential/header fields", () => {
  const context = safeSessionLogContext({ user: { id: "user-123" } });
  assert.deepEqual(context, { hasSession: true, userId: "user-123" });
  assert.equal(JSON.stringify(context).includes("secret-token"), false);
});

test("public health response contains only readiness status", () => {
  assert.deepEqual(publicHealthResponse(false), { status: "degraded" });
  assert.deepEqual(publicHealthResponse(true), { status: "ok" });
});

test("cookie-authenticated writes reject foreign origins while API clients keep access", () => {
  const trusted = ["https://vaultfs.example"];
  assert.equal(isUntrustedCookieMutation("POST", "session=test", "https://other.example", trusted), true);
  assert.equal(isUntrustedCookieMutation("POST", "session=test", trusted[0], trusted), false);
  assert.equal(isUntrustedCookieMutation("POST", undefined, "https://other.example", trusted), false);
  assert.equal(isUntrustedCookieMutation("GET", "session=test", "https://other.example", trusted), false);
});

test("Dockyard creation rejects supplied IDs and validates notes", () => {
  assert.equal(createDockyardSchema.safeParse({ id: "chosen-id" }).success, false);
  assert.equal(createDockyardSchema.safeParse({ notes: "  " }).success, false);
  assert.deepEqual(createDockyardSchema.safeParse({ notes: " Logical warehouse " }).data, { notes: "Logical warehouse" });
});

test("ordinary role assignment rejects system and Super Admin roles", () => {
  assert.equal(canAssignRoleThroughRoleEndpoint({ name: "Operator", isSystem: false }), true);
  assert.equal(canAssignRoleThroughRoleEndpoint({ name: "Super Admin", isSystem: true }), false);
  assert.equal(canAssignRoleThroughRoleEndpoint({ name: "Custom system", isSystem: true }), false);
});

test("recovery phone input is normalized and validated", () => {
  assert.equal(normalizeRecoveryPhone("98765 43210"), "+919876543210");
  assert.equal(normalizeRecoveryPhone("not-a-phone"), null);
});

test("Dockyard resource roles default to least privilege", () => {
  assert.equal(hasDockyardCapability("ADMIN", "MANAGE_MEMBERS"), true);
  assert.equal(hasDockyardCapability("ADMIN", "DELETE_FILE"), true);
  assert.equal(hasDockyardCapability("MANAGER", "MANAGE_MEMBERS"), false);
  assert.equal(hasDockyardCapability("MANAGER", "UPLOAD_FILE"), true);
  assert.equal(hasDockyardCapability("VIEWER", "VIEW"), true);
  assert.equal(hasDockyardCapability("VIEWER", "DOWNLOAD_FILE"), true);
  assert.equal(hasDockyardCapability("VIEWER", "UPLOAD_FILE"), false);
  assert.equal(hasDockyardCapability("VIEWER", "MANAGE_API_KEYS"), false);
});

test("API key material is random, recognizable, and persists only its digest", () => {
  const first = createApiKeyMaterial();
  const second = createApiKeyMaterial();
  assert.match(first.secret, /^vfs_live_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
  assert.equal(parseApiKeyPrefix(first.secret), first.keyPrefix);
  assert.notEqual(first.secret, second.secret);
  assert.notEqual(first.keyDigest, first.secret);
  assert.equal(first.keyDigest.length, 64);
  assert.equal(apiKeyDigestMatches(first.secret, first.keyDigest), true);
  assert.equal(apiKeyDigestMatches(second.secret, first.keyDigest), false);
});

test("API key scopes map to database scopes and rate limit identities never contain secrets", () => {
  assert.deepEqual(toDatabaseScopes(["READ", "WRITE"]), ["FILE_READ", "FILE_WRITE"]);
  assert.deepEqual(toExternalScopes(["FILE_READ", "FILE_DELETE"]), ["READ", "DELETE"]);
  const secret = createApiKeyMaterial().secret;
  const identity = apiKeyRateLimitKey(secret, "127.0.0.1");
  assert.equal(identity, "ip:127.0.0.1");
  assert.equal(identity.includes(secret), false);
  assert.equal(apiKeyRateLimitKey(undefined, "127.0.0.1"), "ip:127.0.0.1");
  assert.deepEqual(apiKeyFailureLogContext(parseApiKeyPrefix(secret)!), { event: "api_key_auth_failed", keyPrefix: parseApiKeyPrefix(secret) });
  assert.equal(JSON.stringify(apiKeyFailureLogContext(parseApiKeyPrefix(secret)!)).includes(secret), false);
});

test("file names, content signatures, and storage keys follow the allowlist", () => {
  assert.equal(normalizeFilename("..\\folder\\ photo.png "), "photo.png");
  assert.throws(() => normalizeFilename("../bad\u0000.png"));
  assert.throws(() => normalizeFilename(`${"a".repeat(256)}.png`));
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(inspectAllowedContent(pngSignature, "image.png"), "image/png");
  assert.equal(inspectAllowedContent(Buffer.from("not a png"), "image.png"), null);
  assert.equal(inspectAllowedContent(pngSignature, "image.exe"), null);
  assert.match(createStorageKey(), /^[a-f0-9]{64}$/);
});

test("signed file tokens bind file and Dockyard, expire, and reject tampering", () => {
  const claims = { dockyardId: "dock-a", fileId: "file-a", expiresAt: 1200 };
  const token = createSignedFileToken(claims, "test-signing-secret-which-is-long-enough");
  assert.deepEqual(verifySignedFileToken(token, "test-signing-secret-which-is-long-enough", 1000, 300), claims);
  assert.equal(verifySignedFileToken(token, "wrong-secret-which-is-also-long-enough", 1000, 300), null);
  assert.equal(verifySignedFileToken(`${token.slice(0, -1)}x`, "test-signing-secret-which-is-long-enough", 1000, 300), null);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const equivalentLastCharacter = alphabet[alphabet.indexOf(token.at(-1)!) ^ 1];
  assert.equal(verifySignedFileToken(token.slice(0, -1) + equivalentLastCharacter, "test-signing-secret-which-is-long-enough", 1000, 300), null);
  assert.equal(verifySignedFileToken(token, "test-signing-secret-which-is-long-enough", 1200, 300), null);
  assert.equal(verifySignedFileToken(token, "test-signing-secret-which-is-long-enough", 1000, 100), null);
});

test("local storage streams, finalizes atomically, hashes, reads, deletes, and rejects unsafe keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultfs-storage-unit-"));
  try {
    const storage = new LocalFilesystemStorage(root);
    const storageKey = createStorageKey();
    const contents = Buffer.from("test-stream-content");
    const written = await storage.writeStream(storageKey, Readable.from([contents]), 1024);
    assert.equal(written.sizeBytes, contents.length);
    assert.equal(written.sha256, (await import("node:crypto")).createHash("sha256").update(contents).digest("hex"));
    assert.equal(await storage.exists(storageKey), false);
    await storage.finalize(storageKey);
    assert.equal(await storage.exists(storageKey), true);
    assert.equal((await storage.stat(storageKey))?.sizeBytes, contents.length);
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readStream(storageKey)) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), contents);
    await storage.delete(storageKey);
    assert.equal(await storage.exists(storageKey), false);
    await assert.rejects(storage.exists("../escape"));
  } finally {
    const resolvedRoot = path.resolve(root);
    assert.ok(resolvedRoot.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    await rm(resolvedRoot, { recursive: true, force: true });
  }
});

test("local storage bounds streams, cleans interruptions, and fails closed on an unavailable root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultfs-storage-failures-"));
  try {
    const storage = new LocalFilesystemStorage(root);
    const tooLargeKey = createStorageKey();
    await assert.rejects(storage.writeStream(tooLargeKey, Readable.from(Buffer.alloc(32)), 16), { code: "FILE_TOO_LARGE" });
    assert.equal(await storage.hasStaged(tooLargeKey), false);

    const interruptedKey = createStorageKey();
    const interrupted = new Readable({ read() { this.push(Buffer.from("partial")); this.destroy(Object.assign(new Error("client disconnected"), { code: "ECONNRESET" })); } });
    await assert.rejects(storage.writeStream(interruptedKey, interrupted, 1024));
    assert.equal(await storage.hasStaged(interruptedKey), false);

    const blockedRoot = path.join(root, "not-a-directory");
    await writeFile(blockedRoot, "file");
    await assert.rejects(new LocalFilesystemStorage(blockedRoot).exists(createStorageKey()), StorageUnavailableError);
  } finally {
    const resolvedRoot = path.resolve(root);
    assert.ok(resolvedRoot.startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    await rm(resolvedRoot, { recursive: true, force: true });
  }
});

test("local storage rejects a linked object directory after initialization", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaultfs-storage-shard-"));
  const storage = new LocalFilesystemStorage(path.join(root, "storage"));
  const key = "ab".repeat(32);
  const outside = path.join(root, "outside");
  try {
    assert.equal(await storage.exists(key), false);
    await mkdir(outside);
    await writeFile(path.join(outside, key), "outside the storage root");
    await symlink(outside, path.join(root, "storage", "objects", "ab"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(storage.readStream(key), StorageUnavailableError);
    await assert.rejects(storage.delete(key), StorageUnavailableError);
  } finally {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    await rm(resolved, { recursive: true, force: true });
  }
});
