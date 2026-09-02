import type { StorefrontThemeBuildStatus } from "@/db/storefront.schema";

/**
 * Build states that will not change again.
 *
 * Kept in one place because three separate decisions read it — whether a cancel
 * is still possible, whether the runner may write a result, and whether a build
 * may be published — and they must not drift apart.
 */
export function isTerminalThemeBuildStatus(
  status: StorefrontThemeBuildStatus | string,
): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

/** Build states a cancel can still claim. */
export function isCancellableThemeBuildStatus(
  status: StorefrontThemeBuildStatus | string,
): boolean {
  return status === "queued" || status === "building";
}

/**
 * Only a build that finished its work may be published.
 *
 * A cancelled build has no artifact and is treated exactly as a failed one, so
 * cancelling can never become a way to publish an unbuilt Theme.
 */
export function isPublishableThemeBuildStatus(
  status: StorefrontThemeBuildStatus | string,
): boolean {
  return status === "succeeded";
}
