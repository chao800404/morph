import { isServer } from "@tanstack/react-query";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";

/**
 * React Query's own default: three retries in the browser, none on the server
 * (`retry ?? (isServer ? 0 : 3)` in query-core's retryer).
 */
const DEFAULT_BROWSER_RETRIES = 3;

/**
 * Whether a failed query is worth asking again.
 *
 * A server function refusing because nobody is signed in, or because the
 * account lacks the role, gives the same answer however often it is asked, so
 * those two stop at once. Every other failure — including one that merely
 * mentions "Unauthorized" in its text — keeps React Query's default behaviour.
 */
export function queryRetry(failureCount: number, error: unknown): boolean {
  if (classifyAuthFailure(error) !== null) return false;
  return !isServer && failureCount < DEFAULT_BROWSER_RETRIES;
}
