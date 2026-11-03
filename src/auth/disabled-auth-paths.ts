/**
 * Better Auth endpoints that `auth.handler` would otherwise answer over HTTP
 * and Morph does not offer, closed with Better Auth's own `disabledPaths`.
 *
 * Every endpoint of the configuration and its plugins is routed unless it is
 * marked SERVER_ONLY (better-call dist/router.mjs:21-26), whether or not
 * Morph's UI calls it, and both the platform's `/api/auth/*` route and the
 * storefront host pass requests straight to `auth.handler`. Several of these
 * re-set the session cookie of the session a request was sent under —
 * `/update-user` (dist/api/routes/update-user.mjs:69), `/update-session`
 * (update-session.mjs:50), `/change-email` (update-user.mjs:441) — so a late
 * response could sign a browser back in as an earlier account after another
 * one signed in (src/auth/session-identity.integration.test.ts, "(e)").
 *
 * `disabledPaths` is checked in the router's `onRequest` only
 * (dist/api/index.mjs:164-166): server code keeps calling the same endpoints
 * through `auth.api.*` (`updateProfile` calls `updateUser`, the session list
 * calls `listSessions`, revoking calls `revokeSession`, the user admin calls
 * `adminUpdateUser`, invites call `createUser`). Over HTTP a disabled path
 * answers 404.
 *
 * Still served over HTTP, because Morph's dashboard or a storefront calls
 * them: get-session, sign-in/email, sign-up/email (storefront accounts),
 * sign-out, revoke-other-sessions, and the email-OTP send-verification-otp,
 * verify-email, check-verification-otp and reset-password. None of those
 * re-sets the session cookie of an existing session on success with this
 * configuration; sign-in and sign-up set a new one and sign-out clears it,
 * which is the account change itself.
 *
 * Not closable here: `/callback/:id` and `/reset-password/:token`. The list
 * is compared with the request's literal path, so a parameterised route
 * never matches. Neither is configured to do anything (no social provider,
 * no reset-link sender) and neither sets a session cookie for an existing
 * session.
 */
export const DISABLED_AUTH_PATHS: readonly string[] = [
  // Core
  "/sign-in/social",
  "/reset-password",
  "/verify-password",
  "/verify-email",
  "/send-verification-email",
  "/change-email",
  "/change-password",
  "/update-session",
  "/update-user",
  "/delete-user",
  "/request-password-reset",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/link-social",
  "/list-accounts",
  "/delete-user/callback",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  "/ok",
  "/error",
  // anonymous()
  "/sign-in/anonymous",
  "/delete-anonymous-user",
  // admin()
  "/admin/set-role",
  "/admin/get-user",
  "/admin/create-user",
  "/admin/update-user",
  "/admin/list-users",
  "/admin/list-user-sessions",
  "/admin/unban-user",
  "/admin/ban-user",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/has-permission",
  // emailOTP()
  "/sign-in/email-otp",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];
