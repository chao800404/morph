import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
} from "better-auth/plugins/admin/access";

export const statement = {
  ...defaultStatements,
  project: ["create", "share", "update", "delete"],
  asset: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const user = ac.newRole({
  project: ["create", "update", "delete"],
  asset: ["read"],
});

export const guest = ac.newRole({
  project: [],
  asset: [],
});

export const administrator = ac.newRole({
  ...adminAc.statements,
  user: ["impersonate-admins", ...adminAc.statements.user],
  project: ["create", "share", "update", "delete"],
  asset: ["create", "read", "update", "delete"],
});
