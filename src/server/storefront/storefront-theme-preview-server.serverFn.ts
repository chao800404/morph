import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { idSchema } from "@/lib/validations/commerce";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { storefrontThemeFileDal } from "@/lib/storefront/dal/storefront-theme-file.dal";
import { CloudflareSandboxVitePreviewServer } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import { deriveThemePreviewSessionId } from "@/lib/storefront/service/theme-preview-session-id";
import {
  resolveThemePreviewServerHost,
  validateExposedPreviewUrl,
} from "@/lib/storefront/service/theme-preview-server-origin";

/**
 * Starts and stops the dev server behind a Theme's Live Preview.
 *
 * Unlike a build, which compiles a frozen revision, the preview serves the
 * mutable workspace: it answers "what am I editing right now", so reading
 * anything else would show the author a Theme they had already moved on from.
 */

const themePreviewServerInputSchema = z.object({
  storefrontId: idSchema("storefront"),
  themeId: idSchema("storefront theme"),
});

type PreviewEnv = {
  THEME_PREVIEW_HOSTNAME?: string;
  Sandbox?: unknown;
};

export const startThemePreviewServer = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(themePreviewServerInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId } = input.data;
    const previewEnv = env as unknown as PreviewEnv;

    // Resolved before any container is touched. A preview with nowhere safe to
    // run should cost nothing and change nothing.
    const host = resolveThemePreviewServerHost({
      configuredPreviewHostname: previewEnv.THEME_PREVIEW_HOSTNAME,
      env: env as unknown as Record<string, unknown>,
    });
    if (!host.enabled) {
      return fail(
        "The Live Preview server needs its own hostname, separate from every Morph hostname.",
        { error: host.reason },
      );
    }

    const files = await storefrontThemeFileDal.listFiles(storefrontId, themeId);
    if (files.length === 0) {
      return fail("This theme has no files to preview.", {
        error: "THEME_EMPTY",
      });
    }
    const entry = files.find((file) => file.isEntry)?.path;
    if (!entry) {
      return fail("This theme has no entry file.", {
        error: "THEME_ENTRY_MISSING",
      });
    }

    const previewId = await deriveThemePreviewSessionId({
      storefrontId,
      themeId,
      userId: context.user.id,
    });

    const server = new CloudflareSandboxVitePreviewServer({
      sandboxBinding: previewEnv.Sandbox,
    });
    const started = await server.start({
      previewId,
      files: files.map((file) => ({ path: file.path, content: file.content })),
      entry,
      previewHostname: host.hostname,
      env: env as unknown as Record<string, unknown>,
    });
    if (!started.ok) {
      return fail("Could not start the Live Preview server.", {
        error: started.stage,
      });
    }

    // Checked again on this side of the boundary. The URL comes back from the
    // container runtime, and the editor is about to frame it.
    const url = validateExposedPreviewUrl({
      url: started.url,
      hostname: host.hostname,
      env: env as unknown as Record<string, unknown>,
    });
    if (!url.ok) {
      await server.stop(previewId, started.processId);
      return fail("The Live Preview server returned an unusable address.", {
        error: url.reason,
      });
    }

    return ok("Live Preview server ready", {
      previewId,
      url: url.url,
      origin: url.origin,
      readyMs: started.readyMs,
      hoistedContentFields: started.hoistedContentFields,
    });
  });

export const stopThemePreviewServer = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(themePreviewServerInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId } = input.data;

    const previewId = await deriveThemePreviewSessionId({
      storefrontId,
      themeId,
      userId: context.user.id,
    });
    const server = new CloudflareSandboxVitePreviewServer({
      sandboxBinding: (env as unknown as PreviewEnv).Sandbox,
    });
    // Stopping something that is not running is the same outcome as stopping
    // it, so a failure here is not worth surfacing to the author.
    await server.stop(previewId).catch(() => {});

    return ok("Live Preview server stopped", { previewId });
  });
