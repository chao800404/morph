import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthWithAdmin } from "../auth/helpers";

export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const auth = getAuthWithAdmin();

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      throw new Error("Unauthorized: Please sign in to continue");
    }

    return next({
      context: {
        session,
        user: session.user,
        auth,
      },
    });
  },
);

export const hasAnyRole = (role: unknown, allowedRoles: readonly string[]) =>
  typeof role === "string" &&
  role
    .split(",")
    .map((value) => value.trim())
    .some((value) => allowedRoles.includes(value));

/**
 * Asset mutations change the shared CMS media library, so authentication alone
 * is insufficient. Keep reads available to signed-in CMS users and restrict
 * create/update/move/delete operations to administrators.
 */
export const assetAdminMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  const request = getRequest();
  const auth = getAuthWithAdmin();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw new Error("Unauthorized: Please sign in to continue");
  }

  if (!hasAnyRole(session.user.role, ["admin"])) {
    throw new Error("Forbidden: Administrator access is required");
  }

  return next({
    context: {
      session,
      user: session.user,
      auth,
    },
  });
});

export const assetReadMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  const request = getRequest();
  const auth = getAuthWithAdmin();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw new Error("Unauthorized: Please sign in to continue");
  }
  if (!hasAnyRole(session.user.role, ["admin", "user"])) {
    throw new Error("Forbidden: Asset access is not assigned to this account");
  }

  return next({
    context: {
      session,
      user: session.user,
      auth,
    },
  });
});
