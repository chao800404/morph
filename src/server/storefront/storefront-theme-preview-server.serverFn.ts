import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { idSchema } from "@/lib/validations/commerce";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { storefrontThemeFileDal } from "@/lib/storefront/dal/storefront-theme-file.dal";
import { CloudflareSandboxVitePreviewServer } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import { refuseThemeWorkspacePath } from "@/lib/storefront/compiler/theme-workspace-path";
import { injectPreviewBindings } from "@/lib/storefront/ast/inject-preview-bindings";
import { hoistColocatedContentFieldsForPreview } from "@/lib/storefront/ast/hoist-colocated-content-fields";
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

/**
 * Whether the container already holds exactly this content.
 *
 * Read before writing, so a save that changes nothing is not turned into a
 * rebuild. It also lets the editor tell the difference between "the preview
 * has not caught up yet" and "the preview was already showing this", which is
 * the difference between waiting and being finished.
 *
 * Unreadable means unknown, and unknown is treated as different: writing a
 * file that was already correct is wasteful, and skipping one that was not
 * would leave the author looking at the wrong page.
 */
async function fileMatches(
  sandbox: {
    readFile?(
      path: string,
      options?: { encoding?: string },
    ): Promise<{ content?: unknown } | string>;
  },
  path: string,
  content: string,
): Promise<boolean> {
  if (!sandbox.readFile) return false;
  try {
    const result = await sandbox.readFile(path, { encoding: "utf-8" });
    const existing =
      typeof result === "string"
        ? result
        : typeof result?.content === "string"
          ? result.content
          : null;
    return existing === content;
  } catch {
    return false;
  }
}

const applyThemePreviewFilesInputSchema = themePreviewServerInputSchema.extend({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(1024),
        content: z.string().max(2_000_000),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Writes edited Theme files into the container already serving the preview.
 *
 * Updates reach a real preview as files, not as a message: Vite is watching
 * that workspace, so writing them is what makes the page update, and it
 * updates by hot module replacement rather than by reloading — which is the
 * whole reason for running a real Theme, since a reload would throw away the
 * state the author is looking at.
 *
 * The bridge confirms afterwards, when the page has actually updated. Nothing
 * here reports success on the author's behalf: this says the files were
 * written, which is a different claim from the preview showing them.
 */
export const applyThemePreviewFiles = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(applyThemePreviewFilesInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId, files } = input.data;

    for (const file of files) {
      const refusal = refuseThemeWorkspacePath(file.path);
      if (refusal) {
        return fail(refusal, { error: "RESERVED_THEME_PATH" });
      }
    }

    // The same two passes the workspace was laid out with. A file written
    // without them would lose its editor identity the moment it was saved,
    // and the preview would quietly stop being selectable.
    const hoisted = hoistColocatedContentFieldsForPreview(
      injectPreviewBindings(files).files,
    ).files;

    const previewId = await deriveThemePreviewSessionId({
      storefrontId,
      themeId,
      userId: context.user.id,
    });

    const changed: string[] = [];
    const unchanged: string[] = [];

    try {
      const { getSandbox } = await import("@cloudflare/sandbox");
      const sandbox = getSandbox(
        (env as unknown as PreviewEnv).Sandbox as never,
        previewId,
      ) as unknown as {
        writeFile(path: string, content: string): Promise<void>;
        readFile?(
          path: string,
          options?: { encoding?: string },
        ): Promise<{ content?: unknown } | string>;
      };
      for (const file of hoisted) {
        const target = `/workspace/${file.path}`;
        // Written only when it would differ. Vite rebuilds on every write,
        // even one that changes nothing, and a rebuild the author did not ask
        // for costs them the state they were looking at.
        if (await fileMatches(sandbox, target, file.content)) {
          unchanged.push(file.path);
          continue;
        }
        await sandbox.writeFile(target, file.content);
        changed.push(file.path);
      }
    } catch (error) {
      return fail("Could not update the Live Preview server.", {
        error: error instanceof Error ? error.message : "WRITE_FAILED",
      });
    }

    return ok("Live Preview files written", {
      previewId,
      changed,
      unchanged,
    });
  });
