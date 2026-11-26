import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isMorphAppOrigin } from "@/lib/storefront/service/preview-access/preview-access-app-origin";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { idSchema } from "@/lib/validations/commerce";
import { storefrontPreviewAccessDal } from "@/lib/storefront/dal/storefront-preview-access.dal";
import { issuePreviewAccessExchange } from "@/lib/storefront/service/preview-access/preview-access";
import { previewAccessHostname } from "@/lib/storefront/service/preview-access/preview-access-request";
import { deriveThemePreviewSessionId } from "@/lib/storefront/service/theme-preview-session-id";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

const issuePreviewAccessInputSchema = z
  .object({
    storefrontId: idSchema("storefront"),
    themeId: idSchema("storefront theme"),
    /** The editor's fresh id for this attempt; not a secret. */
    flowId: z.string().regex(/^[0-9a-f]{32}$/),
    /** What the begin page the editor framed reported; never the binder. */
    binderHash: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * Whose begin page reported it: the editor's frame, or a tab the editor
     * opened (#214 P3). Redeem must present the same kind.
     */
    kind: z.enum(["iframe", "tab"]).default("iframe"),
    /**
     * SHA-256 of the preview session the editor framed the preview with, for
     * a frame's flow: with this request's own origin it is what a later
     * document with no channel in its URL is given one against. Not a secret
     * (the session is in the framed address); a tab's flow binds none.
     */
    previewSessionHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

/**
 * Issues the code that lets the browser framing this author's preview redeem
 * a grant for it (#214 P2, design §4a step 3).
 *
 * Authorised as starting the preview is: the same middleware, and the preview
 * host is derived here from the signed-in user, never taken from the client,
 * so a code can only ever be for this user's own preview of this Theme. The
 * code is bound to the binder hash and the flow; only the browser holding
 * that binder can redeem it, and only on that host.
 */
export const issueThemePreviewAccess = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(issuePreviewAccessInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const {
      storefrontId,
      themeId,
      flowId,
      binderHash,
      kind,
      previewSessionHash,
    } = input.data;
    // The editor's own origin, from this request: never taken from the
    // client, and only one of Morph's own is bound.
    let editorOrigin: string | undefined;
    if (previewSessionHash !== undefined) {
      if (kind !== "iframe") {
        return fail("Preview sign-in could not start. Retry Preview.", {
          error: "CHANNEL_BINDING_INVALID",
        });
      }
      const requestOrigin = new URL(getRequest().url).origin;
      if (
        !isMorphAppOrigin(
          requestOrigin,
          env as unknown as Record<string, unknown>,
          import.meta.env.DEV,
        )
      ) {
        return fail("Preview sign-in could not start. Retry Preview.", {
          error: "CHANNEL_BINDING_INVALID",
        });
      }
      editorOrigin = requestOrigin;
    }
    const parent = (env as unknown as Record<string, unknown>)
      .THEME_PREVIEW_HOSTNAME;
    if (typeof parent !== "string" || !parent) {
      return fail("Live Preview access is not configured.", {
        error: "PREVIEW_ACCESS_UNAVAILABLE",
      });
    }
    // The Theme must be this storefront's and live, read as redeem reads it.
    const authority = await storefrontPreviewAccessDal.readAuthority({
      sessionId: context.session.session.id,
      userId: context.user.id,
      storefrontId,
      themeId,
    });
    if (!authority.themeLive) {
      return fail("Storefront theme not found", { error: "NOT_FOUND" });
    }

    const previewId = await deriveThemePreviewSessionId({
      storefrontId,
      themeId,
      userId: context.user.id,
    });
    const issued = await issuePreviewAccessExchange({
      dal: storefrontPreviewAccessDal,
      kind,
      sessionId: context.session.session.id,
      userId: context.user.id,
      storefrontId,
      themeId,
      previewId,
      previewHost: previewAccessHostname(previewId, parent),
      flowId,
      binderHash,
      ...(editorOrigin !== undefined
        ? { editorOrigin, previewSessionHash: previewSessionHash! }
        : {}),
    });
    if (!issued.ok) {
      return fail("Preview sign-in could not start. Retry Preview.", {
        error: issued.reason,
      });
    }
    return ok("Preview access issued", {
      code: issued.code,
      expiresAt: issued.expiresAt,
    });
  });
