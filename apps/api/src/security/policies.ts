export function safeSessionLogContext(session: { user?: { id?: string } } | null) {
  return { hasSession: Boolean(session), userId: session?.user?.id };
}

export function publicHealthResponse(databaseReady: boolean) {
  return { status: databaseReady ? "ok" : "degraded" };
}

export function canAssignRoleThroughRoleEndpoint(
  role: { isSystem: boolean; name: string } | null,
) {
  return Boolean(role && !role.isSystem && role.name.toLowerCase() !== "super admin");
}
