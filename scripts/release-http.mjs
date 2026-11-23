import { randomUUID } from "node:crypto";

export const api = "http://127.0.0.1:4415";
export const web = "http://127.0.0.1:4416";
export const fixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWMwcT8BRwzEcQAD8hQx1zpSVgAAAABJRU5ErkJggg==", "base64");
export function guard() {
  const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/placeholder");
  if (db.hostname !== "postgres" || db.pathname !== "/vaultfs_release_test" ||
      process.env.RELEASE_API_PORT !== "4415" || process.env.RELEASE_WEB_PORT !== "4416" ||
      process.env.SUPER_ADMIN_EMAIL !== "release-admin@vaultfs-test.invalid" ||
      !process.env.SUPER_ADMIN_PASSWORD) throw new Error("Expected the disposable Checkpoint 6 release environment.");
}

export async function request(base, path, options = {}, status = 200) {
  const response = await fetch(base + path, {
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000), ...options,
  });
  if (response.status !== status) {
    await response.body?.cancel();
    throw new Error(`${options.method ?? "GET"} ${path.split("/").slice(0, 3).join("/")} returned ${response.status}, expected ${status}`);
  }
  return response;
}

export async function provision(label) {
  guard();
  const login = await request(web, "/vault-api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: web, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD }),
  }, 204);
  const cookies = login.headers.getSetCookie();
  if (!cookies.some(cookie => /session_token=.*HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie))) {
    throw new Error("Better Auth session cookie attributes missing");
  }
  const headers = { origin: web, cookie: cookies.map(value => value.split(";")[0]).join("; "), "content-type": "application/json" };
  const create = await request(web, "/vault-api/dockyard", {
    method: "POST", headers, body: JSON.stringify({ notes: label + " " + randomUUID() }),
  }, 201);
  const { data: { id } } = await create.json();
  const route = "/api/dockyard/" + id;
  const key = await request(web, "/vault-api/dockyard/" + id + "/api-keys", {
    method: "POST", headers, body: JSON.stringify({ name: label, scopes: ["READ", "WRITE", "DELETE"] }),
  }, 201);
  const { secret, data: { id: keyId } } = await key.json();
  return { route, auth: { "X-API-Key": secret }, session: headers, keyId };
}

export async function upload(route, auth, name, contents = fixture) {
  const body = new FormData();
  body.append("file", new Blob([contents], { type: "image/png" }), name);
  const response = await request(api, route + "/files", { method: "POST", headers: auth, body }, 201);
  const { data } = await response.json();
  return data[0];
}
