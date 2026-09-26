import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { idSchema } from "@/lib/validations/commerce";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { storefrontThemeFileDal } from "@/lib/storefront/dal/storefront-theme-file.dal";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import { storefrontPageDal } from "@/lib/storefront/dal/storefront-page.dal";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { themePreviewWorkspaceInput } from "@/lib/storefront/service/theme-preview-workspace-files";
import { readAtSourceGeneration } from "@/lib/storefront/service/source-generation-snapshot";
import {
  THEME_PREVIEW_SERVER_PORT,
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
} from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import {
  isWorkspaceGeneratedThemePath,
  newDirtyWorkspaceMarker,
  refuseThemeWorkspacePath,
} from "@/lib/storefront/compiler/theme-workspace-path";
import { injectPreviewBindings } from "@/lib/storefront/ast/inject-preview-bindings";
import { hoistColocatedContentFieldsForPreview } from "@/lib/storefront/ast/hoist-colocated-content-fields";
import { deriveThemePreviewSessionId } from "@/lib/storefront/service/theme-preview-session-id";
import { createServerThemePreviewServer } from "@/lib/storefront/service/theme-preview-server.factory";
import { createThemePreviewContentSnapshot } from "@/lib/storefront/compiler/theme-preview-content";
import { recordPreviewStartFailure } from "./preview-start-failure-record";
import { withSignedPreviewMedia } from "./preview-media-urls";
import {
  logPreviewServerEvent,
  previewAddressDigest,
} from "@/lib/storefront/compiler/preview-server-observation";
import {
  classifyPreviewAddressProbe,
  PREVIEW_ADDRESS_PROBE_PATH,
  previewAddressBelongsTo,
  type PreviewAddressState,
} from "@/lib/storefront/service/preview-address-probe";
import { readPreviewErrorCode } from "@/lib/storefront/service/preview-proxy-observation";
import {
  syncPreviewFiles,
  type FencedPreviewFileWrite,
} from "@/lib/storefront/service/preview-file-sync";
import {
  runFencedWriteInSandbox,
  type FenceSandbox,
} from "@/lib/storefront/compiler/preview-write-fence-sandbox";

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
  /** Loopback origin a locally-run preview sidecar listens on. */
  MORPH_LOCAL_THEME_PREVIEW_ORIGIN?: string;
  /** The token that sidecar was started with. */
  MORPH_LOCAL_THEME_PREVIEW_TOKEN?: string;
};

export const startThemePreviewServer = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(themePreviewServerInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId } = input.data;

    // Resolved before any container or sidecar is touched. A preview with
    // nowhere safe to run should cost nothing and change nothing, and which
    // transport that is comes from the environment rather than from a flag.
    const selection = createServerThemePreviewServer(
      env as unknown as Record<string, unknown>,
    );
    if (!selection.enabled) {
      return fail(selection.message, { error: selection.reason });
    }

    const editorContext = await storefrontThemeDal.findEditorContext(
      storefrontId,
      themeId,
    );
    if (!editorContext) {
      return fail("Storefront theme not found", { error: "NOT_FOUND" });
    }
    // The files together with the generation they are: the preview refuses
    // a start read before a save it has already laid out, which only works
    // if the generation named here is the one these files were read at.
    let entries: Awaited<
      ReturnType<typeof themeSourceStore.getWorkspaceSnapshot>
    >;
    let sourceGeneration: number;
    let pages: Awaited<ReturnType<typeof storefrontPageDal.listDraftDocuments>>;
    try {
      const [snapshot, draftPages] = await Promise.all([
        readAtSourceGeneration(
          () => themeSourceStore.getSourceGeneration(storefrontId, themeId),
          () => themeSourceStore.getWorkspaceSnapshot(storefrontId, themeId),
        ),
        storefrontPageDal.listDraftDocuments(storefrontId),
      ]);
      entries = snapshot.value;
      sourceGeneration = snapshot.generation;
      pages = draftPages;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("SOURCE_GENERATION_UNSTABLE")) {
        return fail("The theme is being saved; try the preview again.", {
          error: "SOURCE_GENERATION_UNSTABLE",
        });
      }
      throw error;
    }
    if (entries.length === 0) {
      return fail("This theme has no files to preview.", {
        error: "THEME_EMPTY",
      });
    }
    // Every file, binary ones by reference; their bytes are read as each is
    // written, through the blob store's digest check.
    const workspace = themePreviewWorkspaceInput(entries, (digest) =>
      themeSourceStore.readBinaryFile(digest),
    );
    const entry = workspace.entry;
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
    // Library media is readable only with a session the preview page lacks,
    // so the snapshot carries signed addresses for it instead.
    const previewContent = await withSignedPreviewMedia(
      await createThemePreviewContentSnapshot({
        templates: editorContext.templates,
        pages,
      }),
    );

    const server = selection.server;
    const started = await server.start({
      previewId,
      files: workspace.files,
      entry,
      previewHostname: selection.previewHostname,
      previewContent,
      fileVersions: workspace.fileVersions,
      sourceGeneration,
      loadBinary: workspace.loadBinary,
      env: env as unknown as Record<string, unknown>,
    });
    if (!started.ok) {
      const traceId = recordPreviewStartFailure({
        stage: started.stage,
        errorMessage: started.errorMessage,
        logs: started.logs,
        attemptId: started.attemptId,
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
    // container runtime or the sidecar, and the editor is about to frame it.
    const url = selection.admitAddress({
      url: started.url,
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
      attemptId: started.attemptId,
      url: url.url,
      origin: url.origin,
      // Which transport served this, for the same reason the build runner now
      // reports it: after a deployment there is no sidecar, so "it must be the
      // container" is a code argument, and a code argument is what a bug breaks.
      // Reported as a name and timings, never the container handle itself.
      kind: selection.kind,
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
    const selection = createServerThemePreviewServer(
      env as unknown as Record<string, unknown>,
    );
    // Stopping something that is not running is the same outcome as stopping
    // it, so a failure here is not worth surfacing to the author — and neither
    // is having no transport to stop, which is the same nothing.
    if (selection.enabled) {
      await selection.server.stop(previewId).catch(() => {});
    }

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

    const selection = createServerThemePreviewServer(
      env as unknown as Record<string, unknown>,
    );
    if (!selection.enabled) {
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
    const serving = await selection.server.isServing({
      previewId,
      previewHostname: selection.previewHostname,
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
 * Whether the address a loading preview frame uses still answers.
 *
 * Asked while a frame is loading — early, and again when the frame reports a
 * refused request — so an address left stale by a container restart is
 * noticed in seconds rather than at the load timeout. The answer comes from
 * one request sent through the same Sandbox proxy the frame's requests use,
 * so it covers the page itself as well as its modules. It is an answer for
 * the editor to act on, never an action: nothing here restarts anything.
 */
export const probeThemePreviewAddress = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(touchThemePreviewServerInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { storefrontId, themeId, previewOrigin } = input.data;

    const selection = createServerThemePreviewServer(
      env as unknown as Record<string, unknown>,
    );
    const answer = (state: PreviewAddressState, status: number | null) =>
      ok("Live Preview address checked", { state, status });
    if (!selection.enabled) return answer("unknown", null);

    const previewId = await deriveThemePreviewSessionId({
      storefrontId,
      themeId,
      userId: context.user.id,
    });

    // The local sidecar has no preview proxy and no refusal to observe; its
    // own liveness answer is the whole of what can be asked.
    if (selection.kind !== "cloudflare-sandbox") {
      const serving = await selection.server.isServing({
        previewId,
        previewHostname: selection.previewHostname,
        expectedOrigin: previewOrigin,
      });
      return answer(serving ? "serving" : "stale", null);
    }

    const address = previewAddressBelongsTo({
      previewOrigin,
      previewId,
      previewHostname: selection.previewHostname,
      port: THEME_PREVIEW_SERVER_PORT,
    });
    if (!address) return answer("unknown", null);

    try {
      const { proxyToSandbox } = await import("@cloudflare/sandbox");
      const response = await proxyToSandbox(
        new Request(new URL(PREVIEW_ADDRESS_PROBE_PATH, address), {
          headers: { Accept: "text/html" },
        }),
        env as never,
      );
      if (!response) return answer("unknown", null);
      const code =
        response.status >= 400 ? await readPreviewErrorCode(response) : null;
      if (response.status < 400) await response.body?.cancel();
      const state = classifyPreviewAddressProbe(response.status, code);
      logPreviewServerEvent("probe", {
        previewId,
        framedAddress: previewAddressDigest(previewOrigin),
        status: response.status,
        code,
        state,
      });
      return answer(state, response.status);
    } catch {
      return answer("unknown", null);
    }
  });

const applyThemePreviewFilesInputSchema = themePreviewServerInputSchema.extend({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(1024),
        content: z.string().max(2_000_000),
        /** The saved version this copy was edited from; `null` if never saved. */
        baseVersion: z.number().int().positive().nullable(),
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

    const previewId = await deriveThemePreviewSessionId({
      storefrontId,
      themeId,
      userId: context.user.id,
    });
    const selection = createServerThemePreviewServer(
      env as unknown as Record<string, unknown>,
    );

    // How the files reach the preview; everything before it — the check
    // against what is saved and the preview passes — is `syncPreviewFiles`.
    // `generation` is the one the saved files this sync was checked against
    // were read at, handed over by `syncPreviewFiles` — never read again
    // here, where a save landing in between would stamp these files with a
    // generation they do not belong to.
    const write = async (
      writable: readonly FencedPreviewFileWrite[],
      generation: number | null,
    ): Promise<{
      changed: string[];
      unchanged: string[];
      refused: string[];
    }> => {
      if (selection.enabled && selection.applyFiles) {
        // A sidecar's filesystem is in another process. It applies the same
        // fence and "only write what differs" rule on its side, because there
        // it is what decides whether Vite rebuilds.
        const applied = await selection.applyFiles({
          previewId,
          files: writable,
          generation,
        });
        return {
          changed: [...applied.changed],
          unchanged: [...applied.unchanged],
          refused: [...(applied.refused ?? [])],
        };
      }

      const { getSandbox } = await import("@cloudflare/sandbox");
      const sandbox = getSandbox(
        (env as unknown as PreviewEnv).Sandbox as never,
        previewId,
      ) as unknown as FenceSandbox & {
        getExposedPorts?(
          hostname: string,
        ): Promise<Array<{ port: number; status: string; url: string }>>;
        exposePort?(
          port: number,
          options: { hostname: string; name?: string },
        ): Promise<unknown>;
      };
      let reexposedAddress: string | null = null;
      // One step in the container: compare each file's version with the
      // newest written, write only what differs, record the versions. Done as
      // separate calls from here, another request could land between them.
      // Only files that differ are written: Vite rebuilds on every write, and
      // a rebuild the author did not ask for costs them the state they were
      // looking at. Before the first one, the workspace marker is set dirty,
      // so a start that runs meanwhile, or after a write that stopped
      // halfway, reads the disk back instead of trusting it.
      const { changed, unchanged, refused } = await runFencedWriteInSandbox(
        sandbox,
        {
          op: "write",
          root: "/workspace",
          files: writable,
          generation,
          marker: {
            path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
            content: newDirtyWorkspaceMarker(),
          },
        },
      );
      const workspaceFingerprintInvalidated = changed.length > 0;

      // Re-exposed through the same selection that chose the transport, so
      // the host a preview is reached on is decided in one place rather than
      // re-derived here from a binding.
      if (
        selection.enabled &&
        selection.kind === "cloudflare-sandbox" &&
        typeof sandbox.exposePort === "function"
      ) {
        const exposed =
          typeof sandbox.getExposedPorts === "function"
            ? await sandbox
                .getExposedPorts(selection.previewHostname)
                .catch(() => [])
            : [];
        const isPortActive = exposed.some(
          (entry) =>
            entry.port === THEME_PREVIEW_SERVER_PORT &&
            entry.status === "active",
        );
        if (!isPortActive) {
          const reexposed = await sandbox.exposePort(
            THEME_PREVIEW_SERVER_PORT,
            {
              hostname: selection.previewHostname,
              name: "live-preview",
            },
          );
          reexposedAddress =
            previewAddressDigest(
              (reexposed as { url?: string } | undefined)?.url,
            ) ?? "unknown";
        }
      }

      // An incremental write leaves the marker `dirty`, so the next start
      // from any tab rewrites the workspace and restarts Vite; a re-expose
      // replaces the address every tab is framing. Both reach beyond this
      // tab, so both are recorded.
      logPreviewServerEvent("sync", {
        previewId,
        changed: changed.length,
        unchanged: unchanged.length,
        markedWorkspaceDirty: workspaceFingerprintInvalidated,
        reexposedAddress,
        refused: refused.length,
      });
      return { changed, unchanged, refused };
    };

    let result: Awaited<ReturnType<typeof syncPreviewFiles>>;
    try {
      result = await syncPreviewFiles({
        files,
        readSaved: async (paths) => {
          const { value, generation } = await readAtSourceGeneration(
            () => themeSourceStore.getSourceGeneration(storefrontId, themeId),
            () =>
              storefrontThemeFileDal.listSavedFiles(
                storefrontId,
                themeId,
                paths,
              ),
          );
          return { files: value, generation };
        },
        // The same two passes the workspace was laid out with. A file written
        // without them would lose its editor identity the moment it was saved,
        // and the preview would quietly stop being selectable.
        prepare: (prepared) =>
          hoistColocatedContentFieldsForPreview(
            injectPreviewBindings([...prepared]).files,
          ).files,
        isGenerated: isWorkspaceGeneratedThemePath,
        write,
      });
    } catch (error) {
      return fail("Could not update the Live Preview server.", {
        error: error instanceof Error ? error.message : "WRITE_FAILED",
      });
    }

    if (!result.ok) {
      return {
        ...fail(
          "Another tab has saved newer versions of these files; this tab's copy is out of date.",
          { error: "PREVIEW_SOURCE_STALE" },
        ),
        stalePaths: result.stalePaths,
      };
    }

    return ok("Live Preview files written", {
      previewId,
      changed: result.changed,
      unchanged: result.unchanged,
      skipped: result.skipped,
    });
  });
