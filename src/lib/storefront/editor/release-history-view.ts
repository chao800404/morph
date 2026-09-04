import type { StorefrontReleaseDTO } from "@/lib/storefront/dto/storefront-release.dto";
import { readReleaseNote } from "@/lib/storefront/release-note";

export type ReleaseHistoryRow = Readonly<{
  id: string;
  /** Short, stable handle a person can match against a build or a log line. */
  label: string;
  /**
   * What the publisher said this release was for, when they said anything.
   *
   * The id fragment and timestamp identify a release but describe nothing, so
   * this is the only part of a row that makes one recognisable months later.
   */
  note: string | null;
  createdAt: string;
  isActive: boolean;
  /** Whether this row offers activation at all. */
  canActivate: boolean;
  /** Why it does not, when it does not. Empty for an activatable row. */
  blockedReason: string;
  isInvalidated: boolean;
  hasPublishedContent: boolean;
}>;

/**
 * Turns release history into the rows the panel renders.
 *
 * The server is the authority on whether a release can actually be activated —
 * it re-checks the build and takes the pointer under a compare-and-set. This
 * only rules out what is knowable here, so a row is never offered when pressing
 * it could not possibly work, and never hidden on a guess.
 */
export function describeReleaseHistory(
  releases: readonly StorefrontReleaseDTO[],
  activeReleaseId: string | null,
): ReleaseHistoryRow[] {
  return releases.map((release) => {
    const isActive = release.id === activeReleaseId;
    const isInvalidated = release.status === "invalidated";
    const blockedReason = isActive
      ? "This release is already live."
      : isInvalidated
        ? "This release was invalidated and can no longer be served."
        : "";
    return {
      id: release.id,
      label: release.id.slice(0, 8),
      note: readReleaseNote(release.metadata) ?? null,
      createdAt: release.createdAt,
      isActive,
      canActivate: !isActive && !isInvalidated,
      blockedReason,
      isInvalidated,
      hasPublishedContent: release.contentPublicationId !== null,
    };
  });
}

/**
 * The release the next activation must expect to replace.
 *
 * Activation is a compare-and-set: sending the pointer this view was built from
 * is what makes a second person's activation lose instead of silently
 * overwriting the first.
 */
export function expectedActiveReleaseId(
  rows: readonly ReleaseHistoryRow[],
  activeReleaseId: string | null,
): string | null {
  return rows.some((row) => row.id === activeReleaseId) ? activeReleaseId : null;
}
