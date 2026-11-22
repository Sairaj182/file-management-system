import type { DockyardMemberRole } from "@repo/database";

export type DockyardAction =
  | "VIEW"
  | "MANAGE_MEMBERS"
  | "UPLOAD_FILE"
  | "DOWNLOAD_FILE"
  | "DELETE_FILE"
  | "MANAGE_API_KEYS";

const roleCapabilities: Record<DockyardMemberRole, ReadonlySet<DockyardAction>> = {
  OWNER: new Set([
    "VIEW",
    "MANAGE_MEMBERS",
    "UPLOAD_FILE",
    "DOWNLOAD_FILE",
    "DELETE_FILE",
    "MANAGE_API_KEYS",
  ]),
  MANAGER: new Set(["VIEW", "UPLOAD_FILE", "DOWNLOAD_FILE", "DELETE_FILE", "MANAGE_API_KEYS"]),
  VIEWER: new Set(["VIEW", "DOWNLOAD_FILE"]),
};

export function hasDockyardCapability(role: DockyardMemberRole, action: DockyardAction) {
  return roleCapabilities[role].has(action);
}
