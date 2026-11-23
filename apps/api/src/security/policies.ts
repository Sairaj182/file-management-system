export function safeSessionLogContext(session: { user?: { id?: string } } | null) {
  return { hasSession: Boolean(session), userId: session?.user?.id };
}

export function publicHealthResponse(databaseReady: boolean) {
  return { status: databaseReady ? "ok" : "degraded" };
}

export function isUntrustedCookieMutation(
  method: string,
  cookie: string | undefined,
  origin: string | undefined,
  trustedOrigins: readonly string[],
) {
  return Boolean(cookie && origin &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !trustedOrigins.includes(origin));
}

export function canAssignRoleThroughRoleEndpoint(
  role: { isSystem: boolean; name: string } | null,
) {
  return Boolean(role && !role.isSystem && role.name.toLowerCase() !== "super admin");
}
