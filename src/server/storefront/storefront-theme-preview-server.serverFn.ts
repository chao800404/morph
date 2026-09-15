import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { idSchema } from "@/lib/validations/commerce";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { storefrontThemeFileDal } from "@/lib/storefront/dal/storefront-theme-file.dal";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import { storefrontPageDal } from "@/lib/storefront/dal/storefront-page.dal";
import {
  CloudflareSandboxVitePreviewServer,
  THEME_PREVIEW_SERVER_PORT,
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
} from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import {
  isWorkspaceGeneratedThemePath,
  refuseThemeWorkspacePath,
} from "@/lib/storefront/compiler/theme-workspace-path";
import { injectPreviewBindings } from "@/lib/storefront/ast/inject-preview-bindings";
import { hoistColocatedContentFieldsForPreview } from "@/lib/storefront/ast/hoist-colocated-content-fields";
import { deriveThemePreviewSessionId } from "@/lib/storefront/service/theme-preview-session-id";
import {
  resolveThemePreviewServerHost,
  validateExposedPreviewUrl,
} from "@/lib/storefront/service/theme-preview-server-origin";
import { createThemePreviewContentSnapshot } from "@/lib/storefront/compiler/theme-preview-content";
import { recordPreviewStartFailure } from "./preview-start-failure-record";

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

const touchThemePreviewServerInputSchema = themePreviewServerInputSchema.extend(
  {
    /**
     * The origin the editor is currently framing.
     *
     * Checked rather than assumed: re-exposing a port mints a new address, so
     * a preview can be reachable at an address the author is not looking at.
     */
    previewOrigin: z.string().url().max(2048),
  },
);

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

    const editorContext = await storefrontThemeDal.findEditorContext(
      storefrontId,
      themeId,
    );
    if (!editorContext) {
      return fail("Storefront theme not found", { error: "NOT_FOUND" });
    }
    const [files, pages] = await Promise.all([
      storefrontThemeFileDal.listFiles(storefrontId, themeId),
      storefrontPageDal.listDraftDocuments(storefrontId),
    ]);
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
    const previewContent = await createThemePreviewContentSnapshot({
      templates: editorContext.templates,
      pages,
    });

    const server = new CloudflareSandboxVitePreviewServer({
      sandboxBinding: previewEnv.Sandbox,
    });
    const started = await server.start({
      previewId,
      files: files.map((file) => ({ path: file.path, content: file.content })),
      entry,
      previewHostname: host.hostname,
      previewContent,
      env: env as unknown as Record<string, unknown>,
    });
    if (!started.ok) {
      const traceId = recordPreviewStartFailure({
        stage: started.stage,
        errorMessage: started.errorMessage,
        logs: started.logs,
        storefrontId,
        themeId,
        previewId,
      });
      return fail(
        `Could not start the Live Preview server. (reference ${traceId})`,
        { error: started.stage },
      );
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
      const traceId = recordPreviewStartFailure({
        stage: "preview-origin-rejected",
        errorMessage: url.reason,
        logs: started.logs,
        storefrontId,
        themeId,
        previewId,
      });
      return fail(
        `The Live Preview server returned an unusable address. (reference ${traceId})`,
        { error: url.reason },
      );
    }

    return ok("Live Preview server ready", {
      previewId,
      url: url.url,
      origin: url.origin,
      readyMs: started.readyMs,
      timings: started.timings,
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
 * Keeps a preview someone is watching awake, and reports whether it still is.
 *
 * Called on a timer while the editor holds a healthy preview. Both halves
 * matter: the call renews the sandbox's idle deadline, which an open preview
 * page does not, and its answer is the only way to learn that the sandbox
 * died — the page stays loaded in the browser and keeps answering the
 * editor's heartbeat long after the container behind it has gone.
 *
 * The answer is about the address the editor named, not about the container
 * in general. A dev server can keep running behind an exposed port that has
 * lapsed, and re-exposing mints a new address while the old one stops
 * resolving; in both cases the process list says yes and the author is
 * looking at a preview that returns 410.
 *
 * An editor that closes simply stops calling, and the preview sleeps on its
 * own schedule. Nothing here pins a container awake for an author who left.
 */
export const touchThemePreviewServer = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(touchThemePreviewServerInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId, previewOrigin } = input.data;
    const previewEnv = env as unknown as PreviewEnv;

    const host = resolveThemePreviewServerHost({
      configuredPreviewHostname: previewEnv.THEME_PREVIEW_HOSTNAME,
      env: env as unknown as Record<string, unknown>,
    });
    if (!host.enabled) {
      return ok("Live Preview server checked", {
        previewId: null,
        serving: false,
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
    const serving = await server.isServing({
      previewId,
      previewHostname: host.hostname,
      expectedOrigin: previewOrigin,
    });
    // Not a failure of this request: "the preview is gone" is an answer, and
    // the editor decides what to do about it.
    return ok("Live Preview server checked", {
      previewId: previewId as string | null,
      serving,
    });
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
    const skipped: string[] = [];
    let workspaceFingerprintInvalidated = false;

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
        getExposedPorts?(
          hostname: string,
        ): Promise<Array<{ port: number; status: string; url: string }>>;
        exposePort?(
          port: number,
          options: { hostname: string; name?: string },
        ): Promise<unknown>;
      };
      for (const file of hoisted) {
        // Left as the container generated it. Reported separately from
        // "unchanged", because the two are different facts: one says the
        // container already holds what the editor sent, the other says the
        // editor never owned that file here.
        if (isWorkspaceGeneratedThemePath(file.path)) {
          skipped.push(file.path);
          continue;
        }
        const target = `/workspace/${file.path}`;
        // Written only when it would differ. Vite rebuilds on every write,
        // even one that changes nothing, and a rebuild the author did not ask
        // for costs them the state they were looking at.
        if (await fileMatches(sandbox, target, file.content)) {
          unchanged.push(file.path);
          continue;
        }
        // The marker describes the entire workspace, so invalidate it before
        // the first incremental write. If this request stops halfway, the
        // next start performs a complete sync instead of trusting a partial
        // HMR update as the prior committed plan.
        if (!workspaceFingerprintInvalidated) {
          await sandbox.writeFile(
            THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
            "dirty",
          );
          workspaceFingerprintInvalidated = true;
        }
        await sandbox.writeFile(target, file.content);
        changed.push(file.path);
      }

      const previewEnv = env as unknown as PreviewEnv;
      const host = resolveThemePreviewServerHost({
        configuredPreviewHostname: previewEnv.THEME_PREVIEW_HOSTNAME,
        env: env as unknown as Record<string, unknown>,
      });
      if (host.enabled && typeof sandbox.exposePort === "function") {
        const exposed =
          typeof sandbox.getExposedPorts === "function"
            ? await sandbox.getExposedPorts(host.hostname).catch(() => [])
            : [];
        const isPortActive = exposed.some(
          (entry) =>
            entry.port === THEME_PREVIEW_SERVER_PORT &&
            entry.status === "active",
        );
        if (!isPortActive) {
          await sandbox.exposePort(THEME_PREVIEW_SERVER_PORT, {
            hostname: host.hostname,
            name: "live-preview",
          });
        }
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
      skipped,
    });
  });
