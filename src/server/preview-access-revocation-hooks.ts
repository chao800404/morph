import { env } from "cloudflare:workers";
import { getSandbox } from "@cloudflare/sandbox";
import { storefrontPreviewAccessDal } from "@/lib/storefront/dal/storefront-preview-access.dal";
import {
  type PreviewAccessClosePush,
  revokePreviewAccessAndClose,
  userUpdateEndsPreviewAccess,
} from "@/lib/storefront/service/preview-access/preview-access-revocation";
import { previewSandboxBinding } from "@/lib/storefront/service/preview-sandbox-binding";

/**
 * What Better Auth's database hooks call once a session or user change has
 * been written (#214 P2d). Sign-out, revoking a session (Morph's own
 * `revokeSession` and the admin plugin's), banning (which also deletes the
 * user's sessions), a role change and deleting a user all reach one of these.
 *
 * None of them throws: the auth change is already done, and a preview that
 * cannot be told is bounded by its socket lease (preview-socket-lease.ts).
 */

/** How long one preview's close push may take before it is given up. */
export const PREVIEW_CLOSE_PUSH_TIMEOUT_MS = 5_000;

/** Asks one preview's Durable Object to close these grants' sockets. */
export const pushPreviewGrantClosures: PreviewAccessClosePush = (
  previewId,
  grantIds,
) => {
  const preview = getSandbox(
    previewSandboxBinding(env as unknown as Record<string, unknown>) as never,
    previewId,
    { normalizeId: true },
  ) as unknown as {
    closePreviewGrants(ids: readonly string[]): Promise<number>;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    preview.closePreviewGrants([...grantIds]),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("PREVIEW_CLOSE_PUSH_TIMEOUT")),
        PREVIEW_CLOSE_PUSH_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

async function settle(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    console.error("[preview-access] revocation hook failed");
  }
}

export function previewAccessAfterSessionDeleted(
  session: Readonly<{ id: string }>,
): Promise<void> {
  return settle(() =>
    revokePreviewAccessAndClose({
      by: { sessionId: session.id },
      dal: storefrontPreviewAccessDal,
      push: pushPreviewGrantClosures,
    }),
  );
}

export function previewAccessAfterUserUpdated(
  user: Readonly<{ id: string; role?: string | null; banned?: boolean | null }>,
): Promise<void> {
  if (!userUpdateEndsPreviewAccess(user)) return Promise.resolve();
  return settle(() =>
    revokePreviewAccessAndClose({
      by: { userId: user.id },
      dal: storefrontPreviewAccessDal,
      push: pushPreviewGrantClosures,
    }),
  );
}

export function previewAccessAfterUserDeleted(
  user: Readonly<{ id: string }>,
): Promise<void> {
  return settle(() =>
    revokePreviewAccessAndClose({
      by: { userId: user.id },
      dal: storefrontPreviewAccessDal,
      push: pushPreviewGrantClosures,
    }),
  );
}
