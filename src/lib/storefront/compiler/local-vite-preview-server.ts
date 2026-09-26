import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createLogger, createServer, type ViteDevServer } from "vite";
import { LocalThemeWorkspaceWriter } from "./local-theme-workspace-writer";
import {
  isLoopbackPreviewHostname,
  LOCAL_PREVIEW_HOST,
} from "./local-preview-host";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "./theme-preview-dev-server";
import { planFencedStart, planFencedWrite } from "./preview-write-fence";
import {
  materializeThemeSandboxWorkspace,
  planThemeSandboxWorkspace,
  type ThemeWorkspaceWriter,
} from "./theme-sandbox-workspace";
import type {
  StartPreviewServerInput,
  StartPreviewServerResult,
  ThemePreviewServer,
} from "./theme-preview-server.types";
import {
  isWorkspaceGeneratedThemePath,
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH,
  refuseThemeWorkspacePath,
} from "./theme-workspace-path";

/**
 * The second implementation of `ThemePreviewServer`: a real Vite dev server on
 * this machine, out of a checkout, instead of inside a container.
 *
 * The sandbox transport is the one that ships. This one exists so the editor's
 * end-to-end path — start a preview, edit a file, see the page update — can be
 * exercised without a container image and without Cloudflare. It is not a
 * stand-in that pretends to serve a Theme: it runs the same pinned toolchain
 * over the same generated workspace, and the editor frames a real React app it
 * can really select in.
 *
 * What it therefore is not is evidence about the sandbox. CI runs this one, so
 * a green run proves the editor works against a local Vite server; the sandbox
 * still needs its own occasional real run. `theme-preview-server-parity` is what
 * keeps the two from drifting apart silently, and `isServing` below records the
 * one contract point where they deliberately differ.
 *
 * Deliberate differences from the sandbox transport, all of them about there
 * being no container:
 *
 * - **Loopback only.** Nothing here is reachable from another machine, and the
 *   address is the one actually bound rather than a configured preview
 *   hostname, which names a Cloudflare proxy this transport does not have.
 * - **No process id.** The dev server runs in this process, so there is no
 *   separate one to name or to kill.
 * - **The workspace survives a stop.** Nothing to destroy: the directory is
 *   the next start's cache, and the fingerprint below is what makes reusing it
 *   safe.
 * - **The file watcher, and nothing else about serving.** The generated config
 *   polls, because a container's writes arrive through the Sandbox API rather
 *   than as filesystem events and nothing else would tell the watcher. Locally
 *   that is overridden back to native events, because with polling an edit
 *   applied through `/applyFiles` does not reach the served module:
 *   `local-preview-sidecar.test.ts` is red without the override and green with
 *   it, reproducibly, on an idle machine. What polling does to lose the edit is
 *   not established — the load-dependence points at the watcher's first scan,
 *   which is a hypothesis and not a measurement. The evidence is narrower than
 *   it looks in one more way: inside the full suite that test passes either
 *   way, so only its isolated run is decisive.
 */

export type LocalVitePreviewServerOptions = Readonly<{
  /**
   * Where Theme workspaces are laid out.
   *
   * A directory rather than a temp dir per start: keeping it is what lets a
   * restart reuse the files, and the reconciliation in the materializer is
   * what makes a stale file unable to survive a new plan.
   */
  workspacesRoot?: string;
  /**
   * Root the same pinned packages resolve from, standing in for the toolchain
   * baked into the sandbox image.
   */
  toolchainRoot?: string;
  approvedDependencies?: readonly string[];
  readyTimeoutMs?: number;
  /** How long a stop may wait on Vite's own teardown before carrying on. */
  stopTimeoutMs?: number;
  maxLogLines?: number;
  /** Port to bind. Zero, the default, asks the OS for a free one. */
  port?: number;
  /**
   * Most bytes one preview's staging may hold. Larger than the whole
   * `public/` quota, so one start's files always fit.
   */
  maxStagedBytes?: number;
  /**
   * A staged file younger than this may be about to be named by a start —
   * this tab's or another's — and is never evicted to make room. A stage that
   * finds no room without evicting one is refused instead.
   */
  stagedGraceMs?: number;
  /** A staged file not staged again within this long is removed. */
  stagedTtlMs?: number;
  /** A temporary file this old belongs to a stage that did not finish. */
  staleTempMs?: number;
}>;

type RunningPreview = Readonly<{
  /** Host path the workspace was laid out in. */
  root: string;
  workspaceFingerprint: string;
  url: string;
  origin: string;
  server: ViteDevServer;
}>;

/** The origin of a URL, or null when it is not one this can read. */
function safeOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function withPreviewServerBase(origin: string): string {
  return new URL(THEME_PREVIEW_SERVER_BASE_PATH, `${origin}/`).toString();
}

function withReadyTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * A preview id as a single directory name.
 *
 * The id is derived server-side, so this is not the boundary that keeps a
 * hostile path out — it is what stops two different ids from landing in one
 * directory, or one id from climbing out of the workspaces root.
 */
const SHA256_DIGEST = /^[0-9a-f]{64}$/;
/** Names `workspaceDirectoryName` would leave unchanged. */
const STAGED_PREVIEW_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/;

/** The largest staged file: the per-file quota of `public/`. */
const LOCAL_PREVIEW_MAX_BINARY_BYTES = 5 * 1024 * 1024;

/** A refused stage: the request was wrong, not the sidecar. */
export class LocalPreviewStagingError extends Error {
  constructor(reason: string) {
    super(`BINARY_STAGE_REFUSED: ${reason}.`);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function workspaceDirectoryName(previewId: string): string {
  const safe = previewId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "-");
  if (!safe) throw new Error("A preview needs an id to be addressed by.");
  return safe.slice(0, 120);
}

/**
 * Re-exported so the callers that already ask this module where a local
 * preview may live keep asking one place. The rule itself lives in
 * `local-preview-host`, which is pure, because the Worker imports it and this
 * module must never reach a Worker bundle.
 */
export { LOCAL_PREVIEW_HOST, isLoopbackPreviewHostname };

/**
 * Raised when the started server is polling for file changes.
 *
 * The `watch: { usePolling: false }` override below is load-bearing and, until
 * this check, was guarded only by a test that has to run alone to mean
 * anything: the defect is a race with the watcher's first scan, so it appears
 * only when a write lands immediately after `start()`. Anything that keeps the
 * watcher busy first — a prior request, a full suite, a CI machine under load —
 * hides it. A structural check has none of that dependence. The merged config
 * either says polling or it does not, on any machine, under any load, on every
 * start.
 */
export const LOCAL_PREVIEW_POLLING_WATCHER = "LOCAL_PREVIEW_POLLING_WATCHER";

export class LocalVitePreviewServer implements ThemePreviewServer {
  private readonly workspacesRoot: string;
  private readonly toolchainRoot: string;
  private readonly approvedDependencies: ReadonlySet<string>;
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly maxLogLines: number;
  private readonly port: number;
  private readonly running = new Map<string, RunningPreview>();
  /**
   * Per preview, the newest version written to each file, and the writes
   * queued behind one another so that comparing against it and writing are
   * one step. See `preview-write-fence.ts`.
   */
  private readonly fenceLedgers = new Map<
    string,
    { files: Record<string, number>; generation: number }
  >();
  private readonly writeQueues = new Map<string, Promise<unknown>>();
  private readonly maxStagedBytes: number;
  private readonly stagedTtlMs: number;
  private readonly staleTempMs: number;
  private readonly stagedGraceMs: number;

  constructor(options: LocalVitePreviewServerOptions = {}) {
    this.workspacesRoot = path.resolve(
      options.workspacesRoot ?? path.join(process.cwd(), ".morph-previews"),
    );
    this.toolchainRoot = path.resolve(options.toolchainRoot ?? process.cwd());
    this.approvedDependencies = new Set(
      options.approvedDependencies ?? DEFAULT_APPROVED_DEPENDENCIES,
    );
    this.readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.maxLogLines = options.maxLogLines ?? 200;
    this.port = options.port ?? 0;
    this.maxStagedBytes = options.maxStagedBytes ?? 64 * 1024 * 1024;
    this.stagedTtlMs = options.stagedTtlMs ?? 60 * 60 * 1000;
    this.staleTempMs = options.staleTempMs ?? 10 * 60 * 1000;
    this.stagedGraceMs = options.stagedGraceMs ?? 10 * 60 * 1000;
  }

  /** The host path a preview's workspace lives in. */
  workspaceRootFor(previewId: string): string {
    return path.join(this.workspacesRoot, workspaceDirectoryName(previewId));
  }

  /**
   * Whether the pinned packages would actually resolve from a workspace.
   *
   * The container's toolchain is at a fixed path and the image guarantees it is
   * installed. Here it is whatever Node finds by walking up from the workspace,
   * and the generated config *also* has to be told where that is, because it
   * states the roots a dev server may read. If those two answers disagree the
   * failure is a config error several layers down that reads like a Theme bug,
   * so it is asked here instead and answered in one sentence.
   */
  private toolchainProblem(root: string): string | null {
    let current = root;
    for (;;) {
      const candidate = path.join(
        current,
        "node_modules",
        "vite",
        "package.json",
      );
      if (fsSync.existsSync(candidate)) {
        const found = path.join(current, "node_modules", "vite");
        const expected = path.join(this.toolchainRoot, "node_modules", "vite");
        if (path.resolve(found) !== path.resolve(expected)) {
          return `LOCAL_PREVIEW_TOOLCHAIN_ROOT_MISMATCH: A workspace here resolves "vite" from "${current}/node_modules", but this transport was given toolchainRoot "${this.toolchainRoot}". The generated config names the roots a dev server may read, so the two have to be the same tree.`;
        }
        return null;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return `LOCAL_PREVIEW_TOOLCHAIN_MISSING: No "vite" was installed in any node_modules above "${root}". A locally-run Live Preview serves the Theme with the pinned toolchain, so the workspace has to sit under a checkout that has it.`;
      }
      current = parent;
    }
  }

  /**
   * Starts, or re-uses, the dev server for a Theme.
   *
   * The two questions the sandbox transport asks separately are asked
   * separately here too, because they have different answers: whether the
   * workspace on disk is already exactly this plan, and whether a server is
   * already watching it.
   *
   * A matching workspace keeps its running server, so asking twice for the same
   * revision does not restart anything. A changed plan stops the old server
   * first: Vite can keep serving a route graph compiled from files that are
   * already gone, and a preview that shows a page the author just deleted is
   * worse than one that takes a moment to come back.
   */
  async start(
    input: StartPreviewServerInput,
  ): Promise<StartPreviewServerResult> {
    const requestStartedAt = Date.now();
    const logs: string[] = [];
    const addLog = (line: string) => {
      if (logs.length < this.maxLogLines) logs.push(line);
    };

    // A local transport must not be reachable off this machine. Refused rather
    // than ignored: a caller that configured a preview hostname expects that
    // name to be where the preview is, and silently serving somewhere else is
    // how an editor ends up framing an address nothing resolves.
    if (!isLoopbackPreviewHostname(input.previewHostname)) {
      return {
        ok: false,
        stage: "preview-origin",
        errorMessage: `LOCAL_PREVIEW_NOT_LOOPBACK: A locally-run Live Preview binds loopback only, but the configured preview host is "${input.previewHostname}".`,
        logs,
      };
    }

    const root = this.workspaceRootFor(input.previewId);
    const toolchainFailure = this.toolchainProblem(root);
    if (toolchainFailure) {
      return {
        ok: false,
        stage: "preview-toolchain",
        errorMessage: toolchainFailure,
        logs,
      };
    }
    // The generated config is read by a toolchain resolving against the real
    // filesystem, so it is told the real root. Plan paths stay in the
    // workspace's own vocabulary, which the writer below translates.
    const hostWorkspaceRoot = root.split(path.sep).join("/");

    const workspacePlanStartedAt = Date.now();
    const prepared = planThemeSandboxWorkspace({
      files: input.files,
      entry: input.entry,
      buildId: input.previewId,
      dependencies: input.dependencies,
      approvedDependencies: this.approvedDependencies,
      mode: "preview-server",
      previewContent: input.previewContent,
      hostWorkspaceRoot,
      toolchainRoot: this.toolchainRoot.split(path.sep).join("/"),
    });
    const workspacePlanMs = Date.now() - workspacePlanStartedAt;
    if (!prepared.ok) {
      return {
        ok: false,
        stage: prepared.stage,
        errorMessage: prepared.errorMessage,
        logs,
      };
    }

    // Everything that reads or replaces this preview's workspace or server
    // runs in the preview's one queue, with `writeFiles`: a sync cannot land
    // between a start's reconciliation and its writes, nor on a server that
    // is being replaced, and a start cannot reuse a server that one queued
    // ahead of it is about to replace.
    return this.serialised(
      input.previewId,
      async (): Promise<StartPreviewServerResult> => {
        // Judged here, in the queue, against what has actually been written:
        // a start read before a newer one — or before a sync of a newer save —
        // must not lay the older files back over it. Refused whole, as a fenced
        // sync is; the same version passes. The ledger is raised only once
        // the start has laid its files out — a start refused or failed here
        // raises nothing.
        const ledgerBefore = this.fenceLedgers.get(input.previewId) ?? {
          files: {},
          generation: 0,
        };
        const plan = planFencedStart(ledgerBefore, {
          versions: input.fileVersions ?? {},
          generation: input.sourceGeneration ?? null,
        });
        if (plan.staleGeneration) {
          return {
            ok: false,
            stage: "preview-start-stale",
            errorMessage: `PREVIEW_START_STALE: the workspace was already laid out from source generation ${ledgerBefore.generation}; this start was read at ${input.sourceGeneration}.`,
            logs,
          };
        }
        if (plan.stale.length > 0) {
          return {
            ok: false,
            stage: "preview-start-stale",
            errorMessage: `PREVIEW_START_STALE: a newer version of ${plan.stale
              .slice(0, 3)
              .join(
                ", ",
              )}${plan.stale.length > 3 ? ", …" : ""} is already laid out.`,
            logs,
          };
        }
        const recordLaidOut = () =>
          this.fenceLedgers.set(input.previewId, plan.ledger);
        const existing = this.running.get(input.previewId);
        if (
          existing &&
          existing.workspaceFingerprint === prepared.workspaceFingerprint
        ) {
          // The files it names are the ones already there.
          recordLaidOut();
          return {
            ok: true,
            url: existing.url,
            processId: undefined,
            readyMs: 0,
            timings: this.timings({
              requestStartedAt,
              workspacePlanMs,
              workspaceReused: true,
              reusedProcess: true,
            }),
            hoistedContentFields: prepared.hoistedContentFields,
            warnings: prepared.previewWarnings,
            logs,
          };
        }
        if (existing) {
          await this.stop(input.previewId);
        }

        const workspaceStartedAt = Date.now();
        let mkdirCalls = 0;
        let writeCalls = 0;
        let deleteCalls = 0;
        const writer = new LocalThemeWorkspaceWriter({ root });
        const measured: ThemeWorkspaceWriter = {
          async mkdir(dirPath, options) {
            mkdirCalls += 1;
            await writer.mkdir(dirPath, options);
          },
          async writeFile(filePath, content) {
            writeCalls += 1;
            await writer.writeFile(filePath, content);
          },
          listFiles: (dirPath, options) => writer.listFiles(dirPath, options),
          async deleteFile(filePath) {
            deleteCalls += 1;
            await writer.deleteFile(filePath);
          },
        };

        try {
          // The marker means one thing: every file of this plan is on disk. It
          // is withdrawn before the first file changes, so a start that fails
          // halfway leaves no marker a later start could trust, and it is
          // committed only after the last file is written. It does not say
          // that Vite came up; that is the running server's to say.
          await writer.mkdir("/workspace", { recursive: true });
          await writer.writeFile(
            `/workspace/${THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH}`,
            "dirty",
          );
          await materializeThemeSandboxWorkspace(
            measured,
            prepared.workspaceFiles,
            {
              // Staged ahead of this start when it came over the sidecar, which
              // cannot carry a loader; handed in directly when run in-process.
              loadBinary:
                input.loadBinary ??
                ((ref, filePath) =>
                  this.readStagedBinary(input.previewId, ref, filePath)),
            },
          );
          // Committed last, so a partial write can never make a later start trust
          // an incomplete workspace. The in-memory fingerprint above is what
          // actually decides reuse in this process; this is the same marker the
          // sandbox writes, for a start that follows a process restart.
          await writer.writeFile(
            `/workspace/${THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH}`,
            prepared.workspaceFingerprint,
          );
          // Laid out whole: what the ledger records is now on disk, whether
          // or not the server that follows comes up.
          recordLaidOut();
        } catch (error) {
          return {
            ok: false,
            stage: "preview-workspace",
            errorMessage:
              error instanceof Error
                ? error.message
                : "Could not lay out the Theme workspace.",
            logs,
          };
        }
        const workspaceMaterializeMs = Date.now() - workspaceStartedAt;
        if (deleteCalls > 0) {
          addLog(
            `Removed ${deleteCalls} file(s) an older workspace plan had left behind.`,
          );
        }
        const workspaceMs = Date.now() - workspaceStartedAt;

        const startedAt = Date.now();
        let server: ViteDevServer | null = null;
        try {
          server = await createServer({
            // The same generated config the container runs, pointed at this root.
            configFile: path.join(root, "vite.config.ts"),
            root,
            // Host and port are this transport's decisions, not the Theme's: the
            // config states what may be served, never where. Inline options merge
            // over the file's, so `server.fs` and `hmr` still come from it — but
            // `watch` is overridden, and the reason is a command anyone can run
            // rather than a theory:
            //
            //   pnpm exec vitest run src/lib/storefront/service/local-preview-sidecar.test.ts
            //
            // Remove `usePolling: false` and "serves a Theme the Worker can reach"
            // goes red: an edit written through `/applyFiles` never reaches the
            // served module. Put it back and the file is green. The generated config
            // polls because a container's writes arrive through the Sandbox API
            // rather than as filesystem events; a local write *is* a filesystem
            // event, and polling is what loses it.
            //
            // Why polling loses it is not established. The shape of the evidence —
            // red on an idle machine, green inside the full suite where the load is
            // higher — points at the watcher's first scan, but that is a hypothesis
            // and not a measurement. Read that test's verdict only when it runs
            // alone: a green `pnpm test` says nothing about this option.
            server: {
              host: LOCAL_PREVIEW_HOST,
              port: this.port,
              watch: { usePolling: false },
            },
            clearScreen: false,
            customLogger: this.previewLogger(addLog),
          });
          // Asserted on the merged configuration rather than trusted from the
          // options passed in: the generated config asks for polling, these
          // options override it, and Vite resolves the two. Reading the result is
          // the only way to know which one won — and the failure this prevents is
          // silent, because a polling watcher serves a Theme perfectly well and
          // only loses the writes that arrive while it is still enumerating.
          if (server.config.server.watch?.usePolling) {
            throw new Error(
              `${LOCAL_PREVIEW_POLLING_WATCHER}: this transport needs native filesystem events, and the resolved Vite config asks for polling. A local write is a filesystem event; polling is what loses it while the watcher's first scan is still running. The generated config polls because a container's writes arrive through the Sandbox API instead — so the override belongs here, in the transport that does not use it.`,
            );
          }

          await withReadyTimeout(
            server.listen(),
            this.readyTimeoutMs,
            `LOCAL_PREVIEW_TIMEOUT: Vite did not start listening within ${this.readyTimeoutMs}ms.`,
          );
          const address = server.httpServer?.address();
          const boundPort =
            address && typeof address === "object" ? address.port : null;
          if (!boundPort) {
            throw new Error(
              "LOCAL_PREVIEW_NO_PORT: Vite started without a listening socket.",
            );
          }

          const origin = `http://${LOCAL_PREVIEW_HOST}:${boundPort}`;
          const url = withPreviewServerBase(origin);
          this.running.set(input.previewId, {
            root,
            workspaceFingerprint: prepared.workspaceFingerprint,
            url,
            origin,
            server,
          });

          return {
            ok: true,
            url,
            processId: undefined,
            readyMs: Date.now() - startedAt,
            timings: {
              ...this.timings({
                requestStartedAt,
                workspacePlanMs,
                workspaceReused: false,
                reusedProcess: false,
              }),
              workspaceMs,
              workspaceMaterializeMs,
              mkdirCalls,
              writeCalls,
              // Reconciliation deletes have no field in this result shape, which is
              // the sandbox's. They are counted and logged instead of being
              // reported as reads, which is what they are not.
              readCalls: 0,
              viteReadyMs: Date.now() - startedAt,
            },
            hoistedContentFields: prepared.hoistedContentFields,
            warnings: prepared.previewWarnings,
            logs,
          };
        } catch (error) {
          if (server) await this.closeServer(server).catch(() => {});
          return {
            ok: false,
            stage: "preview-server-start",
            errorMessage:
              error instanceof Error
                ? error.message
                : "Failed to start preview",
            logs,
          };
        }
      },
    );
  }

  /**
   * Whether the server this process started is still listening, on this
   * preview's address.
   *
   * The sandbox compares hostnames where this compares origins, and the
   * difference is real rather than an oversight: a developer reaches the
   * sandbox through a proxy that rewrites the scheme and port and leaves the
   * host alone, so origins never match there. Nothing sits between the editor
   * and this server — it frames the exact address returned — so an origin is
   * both comparable and the stricter question.
   */
  async isServing(input: {
    previewId: string;
    previewHostname: string;
    expectedOrigin?: string | null;
  }): Promise<boolean> {
    const running = this.running.get(input.previewId);
    if (!running) return false;
    if (running.server.httpServer?.listening !== true) return false;
    if (!input.expectedOrigin) return true;
    const expected = safeOrigin(input.expectedOrigin);
    return expected !== null && expected === running.origin;
  }

  /**
   * Stops the dev server, and forgets it.
   *
   * The workspace is left where it is. There is no container to destroy, and
   * the directory is the next start's cache; the fingerprint is what makes
   * reusing it safe. Stopping a preview that is not running is the outcome the
   * caller asked for, so it is not an error.
   *
   * `processId` is accepted because the contract carries it. The dev server
   * runs in this process, so there is no second one to name; a caller holding
   * an id from a transport that does have processes is asking a question that
   * is still meaningful, so it is ignored rather than refused.
   */
  /**
   * Where a preview's staged binary files wait, by digest.
   *
   * Beside the workspaces, never inside one: the workspace is laid out only
   * by a start, which is what keeps its fingerprint honest, and Vite serves
   * the workspace. A preview id cannot name this directory, since workspace
   * names never begin with a dot.
   */
  private stagingRootFor(previewId: string): string {
    return path.join(
      this.workspacesRoot,
      ".binary-staging",
      workspaceDirectoryName(previewId),
    );
  }

  /**
   * Keeps one binary file's bytes for the start that will name them.
   *
   * Nothing is written until the bytes are shown to be what the caller says:
   * a well-formed digest, a size within the per-file quota, and bytes of that
   * size that hash to that digest. They land under a temporary name and are
   * renamed into place, so a reader never sees half a file. The workspace is
   * not touched; a start lays them out, and only a start commits it.
   */
  async stageBinary(input: {
    previewId: string;
    digest: string;
    sizeBytes: number;
    bytes: Uint8Array;
  }): Promise<{ staged: true }> {
    // Refused, not made safe: a name that had to be rewritten is not the
    // preview the caller meant, and staging under another name would hand its
    // bytes to whichever preview that name belongs to.
    if (!STAGED_PREVIEW_ID.test(input.previewId)) {
      throw new LocalPreviewStagingError("the preview id is not a valid name");
    }
    if (!SHA256_DIGEST.test(input.digest)) {
      throw new LocalPreviewStagingError("the digest is not a SHA-256");
    }
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 0 ||
      input.sizeBytes > LOCAL_PREVIEW_MAX_BINARY_BYTES
    ) {
      throw new LocalPreviewStagingError("the size is out of range");
    }
    if (input.bytes.byteLength !== input.sizeBytes) {
      throw new LocalPreviewStagingError(
        `${input.bytes.byteLength} bytes arrived, ${input.sizeBytes} were declared`,
      );
    }
    if (sha256Hex(input.bytes) !== input.digest) {
      throw new LocalPreviewStagingError("the bytes do not hash to the digest");
    }
    // Expired first: it removes directories it empties, which would include
    // this preview's own if it were created before.
    await this.expireStaging();
    const root = this.stagingRootFor(input.previewId);
    await fs.mkdir(root, { recursive: true });
    await this.makeRoomInStaging(root, input.digest, input.sizeBytes);
    const target = path.join(root, input.digest);
    const temporary = path.join(root, `.${input.digest}.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, input.bytes);
    await fs.rename(temporary, target);
    return { staged: true };
  }

  /**
   * Removes what no start can still want, across every preview's staging:
   * temporary files of stages that never finished, and files not staged
   * again within the time limit. Directories left empty go too, so a preview
   * that is gone leaves nothing behind.
   */
  private async expireStaging() {
    const stagingRoot = path.join(this.workspacesRoot, ".binary-staging");
    const now = Date.now();
    for (const directory of await fs
      .readdir(stagingRoot, { withFileTypes: true })
      .catch(() => [])) {
      if (!directory.isDirectory()) continue;
      const root = path.join(stagingRoot, directory.name);
      let remaining = 0;
      for (const entry of await fs
        .readdir(root, { withFileTypes: true })
        .catch(() => [])) {
        if (!entry.isFile()) continue;
        const file = path.join(root, entry.name);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat) continue;
        const limit = entry.name.endsWith(".tmp")
          ? this.staleTempMs
          : this.stagedTtlMs;
        if (now - stat.mtimeMs > limit) {
          await fs.rm(file, { force: true });
        } else {
          remaining += 1;
        }
      }
      // Only a directory idle for as long as a stale temporary file: one just
      // created by a stage in another request is empty until its file lands.
      const idle = await fs.stat(root).catch(() => null);
      if (remaining === 0 && idle && now - idle.mtimeMs > this.staleTempMs) {
        await fs.rmdir(root).catch(() => undefined);
      }
    }
  }

  /**
   * Makes room for one more file in a preview's staging, or refuses.
   *
   * Only files older than the grace period are evicted, oldest first: a
   * younger one may be about to be named by a start. If the file still does
   * not fit, the stage is refused — a start that cannot be prepared says so,
   * rather than quietly removing what another is preparing. Bytes already
   * staged under the same digest are not counted twice.
   */
  private async makeRoomInStaging(
    root: string,
    digest: string,
    incomingBytes: number,
  ) {
    const now = Date.now();
    const kept: { file: string; size: number; modified: number }[] = [];
    for (const entry of await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => [])) {
      if (!entry.isFile() || entry.name === digest) continue;
      const file = path.join(root, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat) kept.push({ file, size: stat.size, modified: stat.mtimeMs });
    }
    kept.sort((left, right) => left.modified - right.modified);
    let total = kept.reduce((sum, entry) => sum + entry.size, 0);
    for (const oldest of kept) {
      if (total + incomingBytes <= this.maxStagedBytes) break;
      if (now - oldest.modified <= this.stagedGraceMs) break;
      await fs.rm(oldest.file, { force: true });
      total -= oldest.size;
    }
    if (total + incomingBytes > this.maxStagedBytes) {
      throw new LocalPreviewStagingError(
        "the preview's staging is full of files a start may still need",
      );
    }
  }

  /** A staged file's bytes, checked again: the disk is not the transfer. */
  private async readStagedBinary(
    previewId: string,
    ref: { digest: string; sizeBytes: number },
    filePath: string,
  ): Promise<Uint8Array> {
    // The digest names a file, so it is checked before it becomes a path: a
    // start's JSON is the caller's word, and `../` is not a SHA-256.
    if (!SHA256_DIGEST.test(ref.digest)) {
      throw new Error(
        `BINARY_DIGEST_INVALID: "${filePath}" names no SHA-256 digest.`,
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(
        await fs.readFile(
          path.join(this.stagingRootFor(previewId), ref.digest),
        ),
      );
    } catch {
      throw new Error(
        `BINARY_NOT_STAGED: "${filePath}" (${ref.digest}) was not staged before the start.`,
      );
    }
    if (bytes.byteLength !== ref.sizeBytes || sha256Hex(bytes) !== ref.digest) {
      throw new Error(
        `BINARY_STAGED_CORRUPT: the staged bytes of "${filePath}" are not ${ref.digest}.`,
      );
    }
    return bytes;
  }

  async stop(previewId: string, _processId?: string): Promise<void> {
    const running = this.running.get(previewId);
    this.running.delete(previewId);
    if (!running) return;
    await this.closeServer(running.server);
  }

  /**
   * Closes a dev server without waiting on the crawl it is about to cancel.
   *
   * Two waits have to be handled explicitly, and both of them are the
   * difference between a preview that can be replaced and one that cannot.
   *
   * Vite's `close()` cancels the static-import crawl and *then* waits for
   * in-flight requests, so a request still waiting for that crawl to reach idle
   * never settles and `close()` waits on it forever. Measured against this
   * toolchain, that is exactly what happens after any JSX module has been
   * transformed: the first request for a Theme module leaves the server unable
   * to stop. Waiting for idle first costs tens of milliseconds and removes it.
   *
   * Separately, an HTTP server's `close()` waits for open sockets to end, and a
   * browser — or a test client with a keep-alive connection — does not end one
   * because the server wants it to. Destroying the sockets is the right answer
   * here: the preview is going away, and a page being torn down should see the
   * connection end rather than a request that never finishes.
   */
  private async closeServer(server: ViteDevServer): Promise<void> {
    await Promise.race([
      server.waitForRequestsIdle().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, this.stopTimeoutMs)),
    ]);
    const closing = server.close();
    const httpServer = server.httpServer;
    // Not on every server type Vite can hand back, hence the check rather than
    // a call: HTTP/2 has no such method and does not need one here.
    if (httpServer && "closeAllConnections" in httpServer) {
      httpServer.closeAllConnections();
    }
    await closing;
  }

  /**
   * Writes edited files into a workspace already being served.
   *
   * The same thing the sandbox transport's caller does through the container
   * API, and for the same reason: Vite is watching the workspace, so writing
   * the file is what makes the page update — by hot module replacement rather
   * than by a reload, which is what keeps the state the author is looking at.
   *
   * A fingerprint that matched before this call no longer describes the
   * workspace, so it is invalidated first: if this throws halfway, the next
   * start lays the whole plan out again instead of trusting a partial update.
   *
   * The paths the workspace owns are refused by the same two rules the sandbox
   * path refuses them with, before anything is read or written: an editor may
   * write Theme source, and the generated config, the platform's own marker and
   * the generated `package.json` are not that.
   */
  async writeFiles(
    previewId: string,
    files: readonly { path: string; content: string; fence?: number }[],
    /** The source generation the sync was checked at; see the sandbox's. */
    generation?: number | null,
  ): Promise<{
    changed: readonly string[];
    unchanged: readonly string[];
    refused: readonly string[];
  }> {
    // Queued per preview, so the fence comparison and the write it allows are
    // one step: no other write for this preview — nor a start — can land
    // between them.
    return this.serialised(previewId, () =>
      this.writeFilesNow(previewId, files, generation ?? null),
    );
  }

  /** Runs `operation` after everything already queued for this preview. */
  private async serialised<T>(
    previewId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.writeQueues.get(previewId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(operation);
    this.writeQueues.set(previewId, run);
    try {
      return await run;
    } finally {
      if (this.writeQueues.get(previewId) === run) {
        this.writeQueues.delete(previewId);
      }
    }
  }

  private async writeFilesNow(
    previewId: string,
    files: readonly { path: string; content: string; fence?: number }[],
    generation: number | null,
  ): Promise<{
    changed: readonly string[];
    unchanged: readonly string[];
    refused: readonly string[];
  }> {
    const running = this.running.get(previewId);
    if (!running) {
      throw new Error(
        `LOCAL_PREVIEW_NOT_RUNNING: There is no preview server for "${previewId}".`,
      );
    }
    for (const file of files) {
      const refusal = refuseThemeWorkspacePath(file.path);
      if (refusal) throw new Error(refusal);
      if (isWorkspaceGeneratedThemePath(file.path)) {
        throw new Error(
          `RESERVED_THEME_GENERATED_PATH: Theme source cannot replace the generated workspace file "${file.path}"`,
        );
      }
    }

    const current: Record<string, string | null> = {};
    for (const file of files) {
      current[file.path] = await fs
        .readFile(path.join(running.root, file.path), "utf8")
        .catch(() => null);
    }
    // A caller that sends no fence is not ordered against anyone; one that
    // does is held to the newest version this preview has taken.
    const fenced = files.filter(
      (file): file is typeof file & { fence: number } =>
        typeof file.fence === "number",
    );
    const ledger = this.fenceLedgers.get(previewId) ?? {
      files: {},
      generation: 0,
    };
    const plan = planFencedWrite(ledger.files, fenced, current);
    if (plan.refused.length > 0) {
      return { changed: [], unchanged: [], refused: plan.refused };
    }

    const writer = new LocalThemeWorkspaceWriter({ root: running.root });
    const changed: string[] = [];
    const unchanged: string[] = [];
    let invalidated = false;
    for (const file of files) {
      if (current[file.path] === file.content) {
        unchanged.push(file.path);
        continue;
      }
      if (!invalidated) {
        await writer.writeFile(
          `/workspace/${THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH}`,
          "dirty",
        );
        invalidated = true;
      }
      const target = `/workspace/${file.path.replace(/\\/g, "/")}`;
      // A new file may be the first in its folder. The container's script
      // makes the folder; without this, the same sync failed here with
      // ENOENT, and only on this transport.
      await writer.mkdir(target.slice(0, target.lastIndexOf("/")), {
        recursive: true,
      });
      await writer.writeFile(target, file.content);
      changed.push(file.path);
    }
    this.fenceLedgers.set(previewId, {
      files: plan.ledger,
      generation:
        generation !== null && generation > ledger.generation
          ? generation
          : ledger.generation,
    });
    return { changed, unchanged, refused: [] };
  }

  /** Every preview this process is serving, for a caller that has to clean up. */
  servingPreviewIds(): readonly string[] {
    return [...this.running.keys()];
  }

  /**
   * Vite's own logger, kept as the log this result reports.
   *
   * `silent` suppresses its printing but not the messages: a failed start has
   * to say why, and the platform's start-failure record is built from these.
   */
  private previewLogger(addLog: (line: string) => void) {
    const logger = createLogger("silent");
    logger.error = (message) => {
      addLog(message);
    };
    logger.warn = (message) => {
      addLog(message);
    };
    logger.info = () => {};
    return logger;
  }

  /**
   * The shape the sandbox transport reports, with container-only stages at
   * zero.
   *
   * A field with no counterpart here is zero rather than a plausible small
   * number: nothing was measured, and a fabricated duration would make the two
   * transports look comparable in exactly the place they are not.
   */
  private timings(input: {
    requestStartedAt: number;
    workspacePlanMs: number;
    workspaceReused: boolean;
    reusedProcess: boolean;
  }) {
    return {
      totalMs: Date.now() - input.requestStartedAt,
      sandboxHandleMs: 0,
      workspaceMs: 0,
      workspacePlanMs: input.workspacePlanMs,
      workspaceFingerprintReadMs: 0,
      workspaceMaterializeMs: 0,
      workspaceReused: input.workspaceReused,
      firstFilesystemCallMs: 0,
      mkdirCalls: 0,
      mkdirCumulativeMs: 0,
      writeCalls: 0,
      writeCumulativeMs: 0,
      readCalls: 0,
      readCumulativeMs: 0,
      exposePortMs: 0,
      configureLifecycleMs: 0,
      processLookupMs: 0,
      viteReadyMs: 0,
      reusedProcess: input.reusedProcess,
    };
  }
}
