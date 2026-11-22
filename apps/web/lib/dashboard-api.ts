export type Role = "OWNER" | "MANAGER" | "VIEWER";
export type Dockyard = {
  id: string;
  notes: string;
  status: string;
  createdAt: string;
  memberRole?: Role | null;
};
export type Account = {
  user: { id: string; name: string; email: string };
  permissions: string[];
  isSuperAdmin: boolean;
};
export type Member = {
  userId: string;
  role: Role;
  user: { name: string; email: string };
};
export type StoredFile = {
  id: string;
  originalName: string;
  state: string;
  sizeBytes: string;
  contentType: string;
  sha256: string | null;
  createdAt: string;
};
export type Key = {
  id: string;
  name: string | null;
  prefix: string | null;
  active: boolean;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/vault-api" + path, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof data?.error === "string"
        ? data.error
        : `Request failed (${response.status}). Check your input and try again.`,
    );
  return data as T;
}
export async function data<T>(path: string, method?: string, body?: unknown) {
  return (await api<{ data: T }>(path, method, body)).data;
}
