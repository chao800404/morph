import { createAuth } from "@/auth";
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
  return createAuth(env);
}

export type AuthWithAdmin = ReturnType<typeof getAuthWithAdmin>;
