/**
 * Why a server function refused a request on account of who is asking.
 *
 * - `AUTH_REQUIRED`: nobody is signed in — the session is gone or expired.
 * - `ACCESS_DENIED`: someone is signed in, but their role does not allow this.
 * - `ACCOUNT_CHANGED`: someone is signed in, but not the account the request
 *   was made for — the editor that sent it belongs to another. Only a request
 *   that says whose it is can be refused this way; see `editor-writer.ts`.
 *
 * The two need different answers from the client: the first means signing in
 * again, the second means signing in again would not help. Anything else is an
 * ordinary failure, and is never read as one of these.
 */
export const AUTH_FAILURE_CODES = [
  "AUTH_REQUIRED",
  "ACCESS_DENIED",
  "ACCOUNT_CHANGED",
] as const;
export type AuthFailureCode = (typeof AUTH_FAILURE_CODES)[number];

export function isAuthFailureCode(value: unknown): value is AuthFailureCode {
  return (AUTH_FAILURE_CODES as readonly unknown[]).includes(value);
}

/**
 * The error the auth middlewares throw.
 *
 * Its message is the fixed, operator-facing sentence the middlewares always
 * used, so anything that only displays a message reads as before.
 */
export class AuthFailure extends Error {
  readonly code: AuthFailureCode;

  constructor(code: AuthFailureCode, message: string) {
    super(message);
    this.name = "AuthFailure";
    this.code = code;
  }
}

export function authRequired(
  message = "Unauthorized: Please sign in to continue",
): AuthFailure {
  return new AuthFailure("AUTH_REQUIRED", message);
}

export function accessDenied(message: string): AuthFailure {
  return new AuthFailure("ACCESS_DENIED", message);
}

export function accountChanged(): AuthFailure {
  return new AuthFailure(
    "ACCOUNT_CHANGED",
    "Account changed: this request was made for a different account than the one signed in",
  );
}

/**
 * The code of an auth failure, or null for any other error.
 *
 * Only an `AuthFailure` with a known code counts. A plain `Error` whose message
 * happens to start with "Unauthorized", or an object carrying a `code`, is an
 * ordinary failure: guessing "signed out" from text would send someone to the
 * sign-in page for a problem signing in cannot fix.
 */
export function classifyAuthFailure(error: unknown): AuthFailureCode | null {
  return error instanceof AuthFailure && isAuthFailureCode(error.code)
    ? error.code
    : null;
}
