import { definePermission } from "./factory";

export const DockyardPermissions = {
  READ_ANY: definePermission("dockyard", "read", "any"),

  CREATE_ANY: definePermission("dockyard", "create", "any"),

  UPDATE_ANY: definePermission("dockyard", "update", "any"),

  DELETE_ANY: definePermission("dockyard", "delete", "any"),

} as const;
