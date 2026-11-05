import { getResponseHeaders } from "@tanstack/react-start/server";
import type { AuthWithAdmin } from "./helpers";

/**
 * Runs a Better Auth call that changes the signed-in account's data, not who
 * is signed in, and keeps the session cookies it re-sets off this response.
 *
 * Better Auth 1.6.23's `updateUser` ends by re-setting the `session_token`
 * cookie of the session the request was sent under
 * (dist/api/routes/update-user.mjs:69 → setSessionCookie,
 * dist/cookies/index.mjs:118-131), and `tanstackStartCookies` copies it onto
 * the server function's response. For the browser that sent it the value is
 * the token it already holds, so dropping it changes nothing there: the
 * cookie cache is off (no `session_data`), and renewal is off, so the
 * session's expiry in the database is not extended either way. What it does
 * change is a response the browser applies late — after another account
 * signed in, in another tab. That one would put the earlier account's token
 * back and make every tab that account again
 * (src/auth/session-identity.integration.test.ts, "(d)").
 *
 * Only the session cookies this call added are removed, matched by the names
 * Better Auth itself reports (`authCookies`); nothing is decoded or compared,
 * and Better Auth still validates the token on every request. Sign-in and
 * sign-out do not go through here and keep setting and clearing cookies.
 */
export async function withoutSessionCookieRewrite<T>(
  auth: AuthWithAdmin,
  run: () => Promise<T>,
): Promise<T> {
  const headers = getResponseHeaders();
  const before = new Set(headers.getSetCookie());
  try {
    return await run();
  } finally {
    const { authCookies } = await auth.$context;
    const names = [
      authCookies.sessionToken.name,
      authCookies.sessionData.name,
      authCookies.dontRememberToken.name,
    ];
    // Better Auth chunks a large cookie as `name.0`, `name.1`, ….
    const isSessionCookie = (entry: string) =>
      names.some(
        (name) => entry.startsWith(`${name}=`) || entry.startsWith(`${name}.`),
      );
    const all = headers.getSetCookie();
    const kept = all.filter(
      (entry) => before.has(entry) || !isSessionCookie(entry),
    );
    if (kept.length !== all.length) {
      headers.delete("set-cookie");
      for (const entry of kept) headers.append("set-cookie", entry);
    }
  }
}
