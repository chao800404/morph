import type { StorefrontPreviewAccessDAL } from "../../dal/storefront-preview-access.dal";
import { mayPreview } from "../build-preview/build-preview-capability";

/**
 * Ends Live Preview access when a session or user loses it, and asks the
 * affected previews to close their sockets (#214 P2d; design §7.3, A6).
 *
 * The database is the revocation. Every request on a `pv-` host, and every
 * socket lease renewal, already reads the grant with its session and user,
 * so a deleted session or a banned user is refused there whether or not
 * anything here runs. This marks the grants revoked, then pushes the close:
 *
 * - the push only speeds sockets up; a failed or slow push undoes nothing,
 *   and the socket's lease still ends it (A5);
 * - nothing here ever throws. It runs after the auth change has been
 *   written, and sign-out, revoking a session, banning or deleting a user
 *   must not be reported as failed because a preview could not be told.
 *
 * Logs carry grant and preview ids only.
 */

export type PreviewAccessClosePush = (
  previewId: string,
  grantIds: readonly string[],
) => Promise<unknown>;

export type PreviewAccessRevocationResult = Readonly<{
  revoked: number;
  pushedPreviews: number;
  failedPreviews: number;
  /** The grants could not be marked revoked (D1 error). */
  revokeFailed: boolean;
}>;

type Logger = Pick<Console, "error">;

export async function revokePreviewAccessAndClose(input: {
  by: Readonly<{ sessionId: string }> | Readonly<{ userId: string }>;
  dal: Pick<StorefrontPreviewAccessDAL, "revokeGrants">;
  push: PreviewAccessClosePush;
  now?: Date;
  log?: Logger;
}): Promise<PreviewAccessRevocationResult> {
  const log = input.log ?? console;
  let revoked: Array<{ id: string; previewId: string }>;
  try {
    revoked = await input.dal.revokeGrants({
      ...input.by,
      now: (input.now ?? new Date()).toISOString(),
    });
  } catch {
    // The session or user change itself already refuses the grants.
    log.error("[preview-access] revoking grants failed", {
      by: "sessionId" in input.by ? "session" : "user",
    });
    return {
      revoked: 0,
      pushedPreviews: 0,
      failedPreviews: 0,
      revokeFailed: true,
    };
  }

  const byPreview = new Map<string, string[]>();
  for (const grant of revoked) {
    byPreview.set(grant.previewId, [
      ...(byPreview.get(grant.previewId) ?? []),
      grant.id,
    ]);
  }
  const outcomes = await Promise.all(
    [...byPreview].map(async ([previewId, grantIds]) => {
      try {
        await input.push(previewId, grantIds);
        return true;
      } catch {
        log.error("[preview-access] close push failed", {
          previewId,
          grantIds,
        });
        return false;
      }
    }),
  );
  return {
    revoked: revoked.length,
    pushedPreviews: outcomes.filter(Boolean).length,
    failedPreviews: outcomes.filter((ok) => !ok).length,
    revokeFailed: false,
  };
}

/**
 * Whether a user update takes Live Preview access away: the user is banned,
 * or no longer has a role that may preview. The same rule every request
 * applies (`mayPreview`).
 */
export function userUpdateEndsPreviewAccess(
  user: Readonly<{ role?: string | null; banned?: boolean | null }>,
): boolean {
  return !mayPreview({ role: user.role ?? null, banned: Boolean(user.banned) });
}
