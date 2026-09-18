import { createAuth } from "@/auth";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

/**
 * Auth instance bound to the Cloudflare runtime bindings.
 *
 * The admin plugin is configured in `@/auth`, so its endpoints are already
 * typed on `auth.api` (`createUser`, `setRole`, `listUsers`, `banUser`, …).
 * Call them directly rather than re-wrapping them here: the previous wrapper
 * widened `role` to `string` and hid that the endpoints return a `Response`.
 */
export function getAuthWithAdmin() {
  return createAuth(env, requestUrl());
}

/**
 * The URL this call is serving, when there is one.
 *
 * Outside production `createAuth` takes its base URL from the request, and the
 * base URL is what Better Auth derives cookie security from. A caller that
 * omits it gets the configured `PUBLIC_URL` instead — so an instance that
 * *reads* a session can disagree with the one that *issued* it about whether
 * the cookie is `__Secure-` prefixed, and then simply does not find it.
 *
 * That is not hypothetical. It is what the default Wrangler environment does on
 * a developer machine: `PUBLIC_URL` is the deployed `https://` origin, the auth
 * handler was given the request and issued a plain cookie for `http://localhost`,
 * and `getSession` looked for the secure one and reported no user. The dashboard
 * guard then bounced a browser that was holding a perfectly good session, with
 * the session row sitting in the database.
 *
 * Resolved here rather than at each call site so that the two sides cannot come
 * apart again. Absent outside a request, which is correct: there is no origin to
 * follow, and the configured value is the only answer.
 */
function requestUrl(): string | null {
  try {
    return getRequest().url;
  } catch {
    return null;
  }
}

export type AuthWithAdmin = ReturnType<typeof getAuthWithAdmin>;
