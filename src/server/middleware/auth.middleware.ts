import {
  accessDenied,
  accountChanged,
  authRequired,
} from "@/lib/auth/auth-failure";
import {
  claimsAnotherWriter,
  editorWriterClaim,
} from "@/lib/auth/editor-writer";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthWithAdmin } from "../auth/helpers";

export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const request = getRequest();
    const auth = getAuthWithAdmin();

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      throw authRequired();
    }
    // Signed in, but as someone other than the editor that sent this.
    if (claimsAnotherWriter(editorWriterClaim(context), session.user.id)) {
      throw accountChanged();
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
}).server(async ({ next, context }) => {
  const request = getRequest();
  const auth = getAuthWithAdmin();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw authRequired();
  }
  // Signed in, but as someone other than the editor that sent this.
  if (claimsAnotherWriter(editorWriterClaim(context), session.user.id)) {
    throw accountChanged();
  }

  if (!hasAnyRole(session.user.role, ["admin"])) {
    throw accessDenied("Forbidden: Administrator access is required");
  }

  return next({
    context: {
      session,
      user: session.user,
      auth,
    },
  });
});

/**
 * Catalogue mutations change what the storefront sells, so they are restricted
 * to administrators. Reads stay open to signed-in CMS users, mirroring assets.
 */
export const productAdminMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, context }) => {
  const request = getRequest();
  const auth = getAuthWithAdmin();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw authRequired();
  }
  // Signed in, but as someone other than the editor that sent this.
  if (claimsAnotherWriter(editorWriterClaim(context), session.user.id)) {
    throw accountChanged();
  }

  if (!hasAnyRole(session.user.role, ["admin"])) {
    throw accessDenied("Forbidden: Administrator access is required");
  }

  return next({
    context: {
      session,
      user: session.user,
      auth,
    },
  });
});

export const productReadMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, context }) => {
  const request = getRequest();
  const auth = getAuthWithAdmin();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw authRequired();
  }
  // Signed in, but as someone other than the editor that sent this.
  if (claimsAnotherWriter(editorWriterClaim(context), session.user.id)) {
    throw accountChanged();
  }
  if (!hasAnyRole(session.user.role, ["admin", "user"])) {
    throw accessDenied(
      "Forbidden: Catalogue access is not assigned to this account",
    );
  }

  return next({
    context: {
      session,
      user: session.user,
      auth,
    },
  });
});

/**
 * The same check the four middlewares above make, expressed once.
 *
 * They predate it and are left alone — they work, and rewriting middleware that
 * guards every existing mutation is not a change worth making blind. New
 * modules use this.
 *
 * `forbidden` is a per-domain message on purpose: "Forbidden" alone gives an
 * operator no way to know which permission they are missing.
 */
const roleMiddleware = (allowedRoles: readonly string[], forbidden: string) =>
  createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const request = getRequest();
    const auth = getAuthWithAdmin();
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session?.user) {
      throw authRequired();
    }
    // Signed in, but as someone other than the editor that sent this.
    if (claimsAnotherWriter(editorWriterClaim(context), session.user.id)) {
      throw accountChanged();
    }
    if (!hasAnyRole(session.user.role, allowedRoles)) {
      throw accessDenied(forbidden);
    }

    return next({
      context: { session, user: session.user, auth },
    });
  });

/**
 * Commerce configuration — regions, channels, locations, customers.
 *
 * Writes are admin-only for the same reason catalogue writes are: these decide
 * what the storefront sells, where it ships and what it charges.
 */
export const commerceAdminMiddleware = roleMiddleware(
  ["admin"],
  "Forbidden: Administrator access is required",
);

export const commerceReadMiddleware = roleMiddleware(
  ["admin", "user"],
  "Forbidden: Commerce access is not assigned to this account",
);

/** Dashboard accounts expose identity and access data, so only admins read them. */
export const userAdminMiddleware = roleMiddleware(
  ["admin"],
  "Forbidden: User administration access is required",
);

export const assetReadMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next, context }) => {
  const request = getRequest();
  const auth = getAuthWithAdmin();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw authRequired();
  }
  // Signed in, but as someone other than the editor that sent this.
  if (claimsAnotherWriter(editorWriterClaim(context), session.user.id)) {
    throw accountChanged();
  }
  if (!hasAnyRole(session.user.role, ["admin", "user"])) {
    throw accessDenied(
      "Forbidden: Asset access is not assigned to this account",
    );
  }

  return next({
    context: {
      session,
      user: session.user,
      auth,
    },
  });
});
