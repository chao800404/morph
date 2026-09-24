import {
  materializeThemeSandboxWorkspace,
  planThemeSandboxWorkspace,
  type ThemeWorkspaceFile,
  type ThemeWorkspaceWriter,
} from "./theme-sandbox-workspace";
import {
  SANDBOX_TOOLCHAIN_ROOT,
  THEME_PREVIEW_SERVER_BASE_PATH,
} from "./theme-preview-dev-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { resolveThemePreviewServerHost } from "@/lib/storefront/service/theme-preview-server-origin";
import {
  isDirtyWorkspaceMarker,
  newDirtyWorkspaceMarker,
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH,
  THEME_PREVIEW_WORKSPACE_MANIFEST_RELATIVE_PATH,
} from "./theme-workspace-path";
import { verifyWorkspaceOnDisk } from "./theme-workspace-verification";
import type { ThemePreviewContentSnapshot } from "./theme-preview-content";
import {
  diffWorkspaceFileDigests,
  enterPreviewStart,
  isContentOnlyChange,
  logPreviewServerEvent,
  newPreviewAttemptId,
  parseWorkspaceManifest,
  previewAddressDigest,
  serializeWorkspaceManifest,
  workspaceFileDigests,
  type WorkspaceChange,
  type WorkspaceManifest,
} from "./preview-server-observation";

/**
 * Runs a Theme's Live Preview as a real Vite dev server inside a sandbox
 * container, instead of compiling it to an artifact.
 *
 * A build answers "what will ship". A preview answers "what am I editing",
 * and it has to answer that repeatedly, in the time between keystrokes. The
 * same container that produces the artifact can hold a dev server open
 * instead: dependencies are already baked into the image, so there is no
 * install step, and Vite transpiles Theme source on demand and pushes later
 * edits over HMR rather than rebuilding.
 *
 * The server is the untrusted side of the isolation contract. It executes
 * Theme JavaScript, so it is reachable only on its own origin, it is given no
 * Morph credential of any kind, and the port it listens on is fixed so the
 * exposed URL cannot end up pointing at nothing.
 */

/** Port the dev server listens on inside the container. */
export const THEME_PREVIEW_SERVER_PORT = 5173;

/** Platform-owned marker written only after a complete workspace succeeds. */
export const THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH = `/workspace/${THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH}`;

/** Per-file digests of the committed workspace; read only for the log. */
export const THEME_PREVIEW_WORKSPACE_MANIFEST_PATH = `/workspace/${THEME_PREVIEW_WORKSPACE_MANIFEST_RELATIVE_PATH}`;

/** The host of a URL, or null when it is not one this can read. */
function safeHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const VITE_BIN = `${SANDBOX_TOOLCHAIN_ROOT}/node_modules/.bin/vite`;

/** Line Vite prints once it can serve requests. Kept as a compatibility path. */
const READY_MARKER = "ready in";

export type PreviewServerProcess = Readonly<{
  id?: string;
  /**
   * Cloudflare Sandbox's process-aware readiness check.
   *
   * It checks the port from inside the container and stops waiting if this
   * process exits. Older providers may not expose it, so log readiness remains
   * as a compatibility path rather than a second source of truth.
   */
  waitForPort?(
    port: number,
    options?: { path?: string; statusMin?: number; statusMax?: number },
  ): Promise<void>;
}>;

function withReadyTimeout(
  ready: Promise<"ready" | "exited">,
  timeoutMs: number,
): Promise<"ready" | "exited" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: "ready" | "exited" | "timeout") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    void ready.then(finish, () => finish("exited"));
  });
}

async function waitForProcessToStop(
  session: PreviewServerSession,
  processId: string | undefined,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (!processId || !session.listProcesses) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const processes = await session.listProcesses().catch(() => null);
    if (
      processes &&
      !processes.some(
        (process) =>
          process.id === processId &&
          (process.status === "running" || process.status === "starting"),
      )
    ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function withPreviewServerBase(exposedUrl: string): string {
  const url = new URL(exposedUrl);
  url.pathname = THEME_PREVIEW_SERVER_BASE_PATH;
  return url.toString();
}

/**
 * The sandbox surface a preview server needs, beyond writing its workspace.
 */
export type PreviewServerSession = ThemeWorkspaceWriter &
  Readonly<{
    readFile?(
      path: string,
      options?: { encoding?: string },
    ): Promise<{ content?: unknown } | string>;
    startProcess(
      command: string,
      options?: {
        env?: Record<string, string>;
        onOutput?: (stream: "stdout" | "stderr", data: string) => void;
        onExit?: (code: number | null) => void;
      },
    ): Promise<PreviewServerProcess>;
    exposePort(
      port: number,
      options: { hostname: string; name?: string; token?: string },
    ): Promise<{ url: string }>;
    /** Processes already running in this container, if it can say. */
    listProcesses?(): Promise<
      ReadonlyArray<{ id?: string; command?: string; status?: string }>
    >;
    killProcess?(id?: string): Promise<void>;
    unexposePort?(port: number): Promise<void>;
    /**
     * Preview URLs the active runtime can currently forward. Authorization
     * that survives in Durable Object storage without the runtime behind it
     * is omitted, which is what makes this the answer to whether an address
     * still resolves.
     */
    getExposedPorts?(
      hostname: string,
    ): Promise<ReadonlyArray<{ url: string; port: number; status: string }>>;
    setSleepAfter?(value: string | number): Promise<void>;
    destroy(): Promise<void>;
  }>;

export type PreviewServerProvider = Readonly<{
  getSandbox(
    binding: unknown,
    sandboxId: string,
  ): Promise<PreviewServerSession>;
}>;

export type StartPreviewServerInput = Readonly<{
  /** Identifies the container, and so the preview URL, for this Theme. */
  previewId: string;
  files: readonly ThemeWorkspaceFile[];
  entry: string;
  dependencies?: Readonly<Record<string, string>>;
  /** Host the preview URL is built on. Must not be platform surface. */
  previewHostname: string;
  /** Worker vars, so every platform hostname can be refused, not just one. */
  env: Record<string, unknown> | undefined;
  /** Authenticated draft content reduced to render-only values. */
  previewContent?: ThemePreviewContentSnapshot;
}>;

export type StartPreviewServerResult =
  | Readonly<{
      ok: true;
      /** Ties this start to its `[preview-observe]` lines on the server. */
      attemptId?: string;
      url: string;
      processId: string | undefined;
      readyMs: number;
      timings: PreviewServerTimings;
      /** Modules whose `contentFields` export was lifted for Fast Refresh. */
      hoistedContentFields: readonly string[];
      /** Preview behaviour that will differ from the build, and why. */
      warnings: ReadonlyArray<{ path: string; message: string }>;
      logs: readonly string[];
    }>
  | Readonly<{
      ok: false;
      attemptId?: string;
      stage: string;
      errorMessage: string;
      logs: readonly string[];
    }>;

/** What one start decided, gathered as it goes and logged when it ends. */
type StartObservation = {
  readonly attemptId: string;
  workspace?: {
    reused: boolean;
    fingerprint: string;
    /** The marker found: a fingerprint, `dirty` after an incremental sync, or none. */
    previous: string | null;
    change?: WorkspaceChange;
    /** What was written: nothing, only the content snapshot, or everything. */
    update?: "none" | "content-only" | "full";
    /** For a `dirty` workspace: how many files were read back, or why not. */
    verification?: { read: number } | { failed: string };
    /** False when another writer marked the workspace before this one committed. */
    committed?: boolean;
  };
  vite?: {
    action: "reused" | "restarted" | "started";
    runningProcessId: string | null;
    processId: string | null;
  };
  address?: { reused: boolean; digest: string | null };
  /** Why the start left the workspace marked untrusted instead of succeeding. */
  failedClosed?: string;
};

function shortMarker(marker: string | null): string | null {
  if (marker === null) return null;
  return isDirtyWorkspaceMarker(marker) ? "dirty" : marker.slice(0, 12);
}

export type PreviewServerTimings = Readonly<{
  /** Entire server start request, including lazy container startup. */
  totalMs: number;
  /** Getting the Durable Object handle only; this does not start the container. */
  sandboxHandleMs: number;
  /** Wall time spent transforming and laying out the workspace. */
  workspaceMs: number;
  /** Pure in-memory transform and validation time. */
  workspacePlanMs: number;
  /** Time spent reading the prior successful workspace marker. */
  workspaceFingerprintReadMs: number;
  /** Filesystem time used to materialize a changed workspace. */
  workspaceMaterializeMs: number;
  /** True when the complete workspace already matched and no source was written. */
  workspaceReused: boolean;
  /** First filesystem call, where a sleeping container normally starts lazily. */
  firstFilesystemCallMs: number;
  mkdirCalls: number;
  /** Sum of individual mkdir durations; may exceed wall time when calls overlap. */
  mkdirCumulativeMs: number;
  writeCalls: number;
  /** Sum of individual write durations; may exceed wall time when calls overlap. */
  writeCumulativeMs: number;
  readCalls: number;
  readCumulativeMs: number;
  exposePortMs: number;
  configureLifecycleMs: number;
  processLookupMs: number;
  viteReadyMs: number;
  reusedProcess: boolean;
}>;

export type CloudflareSandboxVitePreviewServerOptions = Readonly<{
  sandboxBinding?: unknown;
  sandboxProvider?: PreviewServerProvider;
  approvedDependencies?: readonly string[];
  /**
   * How long to wait for Vite to report itself ready.
   *
   * The container starts lazily on the first filesystem operation, then the
   * workspace is materialized and Vite becomes ready. Keep room for slow-tail
   * starts rather than tearing down a server that was about to answer; the
   * returned stage timings make local and deployed latency measurable.
   */
  readyTimeoutMs?: number;
  /** How long a replaced Vite process may take to release its port. */
  stopTimeoutMs?: number;
  /** Idle time after which the container may be reclaimed. */
  sleepAfter?: string | number;
  maxLogLines?: number;
}>;

export class CloudflareSandboxVitePreviewServer {
  private readonly sandboxBinding?: unknown;
  private readonly sandboxProvider?: PreviewServerProvider;
  private readonly approvedDependencies: ReadonlySet<string>;
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly sleepAfter: string | number;
  private readonly maxLogLines: number;

  constructor(options: CloudflareSandboxVitePreviewServerOptions = {}) {
    this.sandboxBinding = options.sandboxBinding;
    this.sandboxProvider = options.sandboxProvider;
    this.approvedDependencies = new Set(
      options.approvedDependencies ?? DEFAULT_APPROVED_DEPENDENCIES,
    );
    this.readyTimeoutMs = options.readyTimeoutMs ?? 180_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.sleepAfter = options.sleepAfter ?? "10m";
    this.maxLogLines = options.maxLogLines ?? 200;
  }

  private async acquire(previewId: string): Promise<PreviewServerSession> {
    if (this.sandboxProvider) {
      return this.sandboxProvider.getSandbox(this.sandboxBinding, previewId);
    }
    if (this.sandboxBinding) {
      const { getSandbox } = await import("@cloudflare/sandbox");
      return getSandbox(this.sandboxBinding as any, previewId) as any;
    }
    throw new Error(
      "SANDBOX_UNAVAILABLE: Cloudflare Sandbox binding or provider is not configured in current environment",
    );
  }

  async start(
    input: StartPreviewServerInput,
  ): Promise<StartPreviewServerResult> {
    const observation: StartObservation = { attemptId: newPreviewAttemptId() };
    const inflight = enterPreviewStart(input.previewId);
    const startedAt = new Date().toISOString();
    let result: StartPreviewServerResult | null = null;
    try {
      result = await this.startObserved(input, observation);
      return { ...result, attemptId: observation.attemptId };
    } finally {
      inflight.leave();
      logPreviewServerEvent("start", {
        attemptId: observation.attemptId,
        previewId: input.previewId,
        startedAt,
        concurrentAtEntry: inflight.concurrentAtEntry,
        outcome: result === null ? "threw" : result.ok ? "ready" : "failed",
        ...(result && !result.ok
          ? { stage: result.stage, error: result.errorMessage.slice(0, 200) }
          : {}),
        workspace: observation.workspace ?? null,
        vite: observation.vite ?? null,
        address: observation.address ?? null,
        failedClosed: observation.failedClosed ?? null,
        ...(result?.ok ? { timings: result.timings } : {}),
      });
    }
  }

  private async startObserved(
    input: StartPreviewServerInput,
    observation: StartObservation,
  ): Promise<StartPreviewServerResult> {
    const requestStartedAt = Date.now();
    const logs: string[] = [];
    const addLog = (line: string) => {
      if (logs.length < this.maxLogLines) logs.push(line);
    };

    // One rule, shared with the editor side that later frames the URL. A
    // preview on any platform host would put Theme code in Morph's cookie jar.
    const host = resolveThemePreviewServerHost({
      configuredPreviewHostname: input.previewHostname,
      env: input.env,
    });
    if (!host.enabled) {
      return {
        ok: false,
        stage: "preview-origin",
        errorMessage: `${host.reason}: A Live Preview that runs Theme JavaScript needs its own host, separate from every Morph hostname.`,
        logs,
      };
    }
    const previewHost = host.hostname;

    let session: PreviewServerSession | null = null;
    try {
      const sandboxHandleStartedAt = Date.now();
      session = await this.acquire(input.previewId);
      const sandboxHandleMs = Date.now() - sandboxHandleStartedAt;
      // A start that cannot finish leaves the workspace untrusted rather than
      // destroyed. The sandbox is shared by every tab of this preview, and
      // destroying it took down pages another request had just brought up.
      // The marker goes back to `dirty`, so the next start rebuilds the whole
      // workspace and restarts Vite instead of trusting what this one left.
      const failClosed = async (reason: string) => {
        observation.failedClosed = reason;
        logPreviewServerEvent("fail-closed", {
          attemptId: observation.attemptId,
          previewId: input.previewId,
          reason,
        });
        await session!
          .writeFile(
            THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
            newDirtyWorkspaceMarker(),
          )
          .catch(() => {
            addLog("Could not mark the Live Preview workspace untrusted.");
          });
      };

      let firstFilesystemCallMs = 0;
      let sawFilesystemCall = false;
      let mkdirCalls = 0;
      let mkdirCumulativeMs = 0;
      let writeCalls = 0;
      let writeCumulativeMs = 0;
      let readCalls = 0;
      let readCumulativeMs = 0;
      const recordFilesystemCall = async <T>(
        operation: () => Promise<T>,
        kind: "mkdir" | "write" | "read",
      ): Promise<T> => {
        const startedAt = Date.now();
        try {
          return await operation();
        } finally {
          const durationMs = Date.now() - startedAt;
          if (!sawFilesystemCall) {
            sawFilesystemCall = true;
            firstFilesystemCallMs = durationMs;
          }
          if (kind === "mkdir") {
            mkdirCalls += 1;
            mkdirCumulativeMs += durationMs;
          } else if (kind === "write") {
            writeCalls += 1;
            writeCumulativeMs += durationMs;
          } else {
            readCalls += 1;
            readCumulativeMs += durationMs;
          }
        }
      };
      const measuredWriter: ThemeWorkspaceWriter = {
        mkdir: (path, options) =>
          recordFilesystemCall(() => session!.mkdir(path, options), "mkdir"),
        writeFile: (path, content) =>
          recordFilesystemCall(
            () => session!.writeFile(path, content),
            "write",
          ),
        ...(session.listFiles
          ? { listFiles: (path, options) => session!.listFiles!(path, options) }
          : {}),
        ...(session.deleteFile
          ? { deleteFile: (path) => session!.deleteFile!(path) }
          : {}),
      };

      const workspaceStartedAt = Date.now();
      const workspacePlanStartedAt = Date.now();
      const prepared = planThemeSandboxWorkspace({
        files: input.files,
        entry: input.entry,
        buildId: input.previewId,
        dependencies: input.dependencies,
        approvedDependencies: this.approvedDependencies,
        mode: "preview-server",
        previewContent: input.previewContent,
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

      // The marker says whether the container holds exactly the workspace
      // this version of Morph just planned. Reading it first also remains the
      // measured lazy-start boundary for a sleeping container.
      const workspaceFingerprintReadStartedAt = Date.now();
      let existingWorkspaceFingerprint: string | null = null;
      if (session.readFile) {
        try {
          const value = await recordFilesystemCall(
            () =>
              session!.readFile!(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, {
                encoding: "utf-8",
              }),
            "read",
          );
          const content =
            typeof value === "string"
              ? value
              : typeof value.content === "string"
                ? value.content
                : null;
          existingWorkspaceFingerprint = content?.trim() ?? null;
        } catch {
          existingWorkspaceFingerprint = null;
        }
      }
      const workspaceFingerprintReadMs =
        Date.now() - workspaceFingerprintReadStartedAt;
      const workspaceReused =
        existingWorkspaceFingerprint === prepared.workspaceFingerprint;
      observation.workspace = {
        reused: workspaceReused,
        fingerprint: prepared.workspaceFingerprint.slice(0, 12),
        previous: shortMarker(existingWorkspaceFingerprint),
      };

      // Process state answers a separate question: whether the matching (or
      // newly materialized) files already have a Vite server watching them.
      const processLookupStartedAt = Date.now();
      const running = await session.listProcesses?.().catch(() => []);
      const processLookupMs = Date.now() - processLookupStartedAt;
      const alreadyServing = (running ?? []).find(
        (process) =>
          process.command?.includes(VITE_BIN) &&
          (process.status === "running" || process.status === "starting"),
      );

      const readWorkspaceMarker = async (): Promise<string | null> => {
        if (!session!.readFile) return null;
        try {
          const value = await recordFilesystemCall(
            () =>
              session!.readFile!(THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH, {
                encoding: "utf-8",
              }),
            "read",
          );
          const content =
            typeof value === "string"
              ? value
              : typeof value.content === "string"
                ? value.content
                : null;
          return content?.trim() ?? null;
        } catch {
          return null;
        }
      };

      let workspaceMaterializeMs = 0;
      let workspaceUpdate: "none" | "content-only" | "full" = workspaceReused
        ? "none"
        : "full";
      if (!workspaceReused) {
        const nextDigests = workspaceFileDigests(prepared.workspaceFiles);
        const themeSourcePaths = new Set(input.files.map((file) => file.path));

        // What the disk holds, known one of two ways or not at all.
        let change: WorkspaceChange;
        let diskIsKnown: boolean;
        if (isDirtyWorkspaceMarker(existingWorkspaceFingerprint)) {
          // Something wrote here after the last complete write, so neither
          // the marker nor the manifest describes the disk. Read it instead.
          const verification = await verifyWorkspaceOnDisk(
            {
              readFile: session.readFile
                ? (path, options) =>
                    recordFilesystemCall(
                      () => session!.readFile!(path, options),
                      "read",
                    )
                : undefined,
              listFiles: session.listFiles
                ? (path, options) => session!.listFiles!(path, options)
                : undefined,
            },
            prepared.workspaceFiles,
          );
          observation.workspace.verification = verification.ok
            ? { read: verification.read }
            : { failed: verification.reason };
          change = diffWorkspaceFileDigests(
            verification.ok ? verification.onDisk : null,
            nextDigests,
            themeSourcePaths,
          );
          diskIsKnown = verification.ok;
        } else {
          let previousManifest: WorkspaceManifest | null = null;
          if (existingWorkspaceFingerprint !== null && session.readFile) {
            try {
              const value = await recordFilesystemCall(
                () =>
                  session!.readFile!(THEME_PREVIEW_WORKSPACE_MANIFEST_PATH, {
                    encoding: "utf-8",
                  }),
                "read",
              );
              previousManifest = parseWorkspaceManifest(
                typeof value === "string"
                  ? value
                  : typeof value.content === "string"
                    ? value.content
                    : null,
              );
            } catch {
              previousManifest = null;
            }
          }
          change = diffWorkspaceFileDigests(
            previousManifest?.files ?? null,
            nextDigests,
            themeSourcePaths,
          );
          // The manifest describes the disk only while the marker names the
          // same workspace: one start wrote every file, then the manifest,
          // then the marker. A missing or mismatched one says nothing.
          diskIsKnown =
            previousManifest !== null &&
            existingWorkspaceFingerprint !== null &&
            previousManifest.fingerprint === existingWorkspaceFingerprint;
        }
        observation.workspace.change = change;

        // A known disk that already matches needs nothing written; one that
        // differs only in the content snapshot needs only that; anything else
        // — or a disk that could not be known — is written whole, and Vite
        // restarted, as before.
        workspaceUpdate = !diskIsKnown
          ? "full"
          : change.paths.length === 0
            ? "none"
            : isContentOnlyChange(change)
              ? "content-only"
              : "full";

        const workspaceMaterializeStartedAt = Date.now();
        if (workspaceUpdate === "content-only") {
          // Only the content snapshot changed. The dev server reads its data
          // file per request and pages accept the new snapshot module without
          // applying it, so the running Vite and every page it serves stay.
          const changedPaths = new Set(change.paths);
          for (const file of prepared.workspaceFiles) {
            if (!changedPaths.has(file.path)) continue;
            await measuredWriter.writeFile(file.path, file.content);
          }
        } else if (workspaceUpdate === "full") {
          await materializeThemeSandboxWorkspace(
            measuredWriter,
            prepared.workspaceFiles,
          );
        }
        workspaceMaterializeMs = Date.now() - workspaceMaterializeStartedAt;

        // Commit only if no other writer has marked the workspace since this
        // start read the marker. Each `dirty` carries its own token, so a sync
        // that began while this start was reading or writing is noticed here,
        // and the commit is left to the start that reads the disk after it.
        // (Checking and writing are two calls; a writer can still step in
        // between them. Closing that needs a single owner for the workspace.)
        const markerNow = await readWorkspaceMarker();
        observation.workspace.committed =
          markerNow === existingWorkspaceFingerprint;
        if (observation.workspace.committed) {
          await recordFilesystemCall(
            () =>
              session!.writeFile(
                THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
                serializeWorkspaceManifest(
                  prepared.workspaceFingerprint,
                  nextDigests,
                ),
              ),
            "write",
          ).catch(() => {
            addLog("Could not persist the Live Preview workspace manifest.");
          });

          // Commit the marker last. A failed or partial write can therefore
          // never make a later request trust an incomplete workspace.
          await recordFilesystemCall(
            () =>
              session!.writeFile(
                THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
                prepared.workspaceFingerprint,
              ),
            "write",
          ).catch(() => {
            addLog("Could not persist the Live Preview workspace fingerprint.");
          });
        } else {
          addLog(
            "Another writer marked the Live Preview workspace; not committing.",
          );
        }
      }
      observation.workspace.update = workspaceUpdate;
      const workspaceMs = Date.now() - workspaceStartedAt;

      // Authorize the URL before the server exists, so a process that becomes
      // ready immediately still has somewhere to be reached. Re-exposing an
      // active port mints a new token and resets the proxy tunnel, interrupting
      // in-flight browser requests. Re-use the existing address when active.
      let exposePortMs = 0;
      let exposedUrl: string;
      const existingPorts =
        typeof session.getExposedPorts === "function"
          ? await session.getExposedPorts(previewHost).catch(() => [])
          : [];
      const activePort = existingPorts.find(
        (entry) =>
          entry.port === THEME_PREVIEW_SERVER_PORT && entry.status === "active",
      );
      if (activePort) {
        exposedUrl = activePort.url;
      } else {
        const exposePortStartedAt = Date.now();
        const exposed = await session.exposePort(THEME_PREVIEW_SERVER_PORT, {
          hostname: previewHost,
          name: "live-preview",
        });
        exposePortMs = Date.now() - exposePortStartedAt;
        exposedUrl = exposed.url;
      }
      const previewUrl = withPreviewServerBase(exposedUrl);
      observation.address = {
        reused: Boolean(activePort),
        digest: previewAddressDigest(exposedUrl),
      };

      const configureLifecycleStartedAt = Date.now();
      if (session.setSleepAfter) {
        await session.setSleepAfter(this.sleepAfter);
      }
      const configureLifecycleMs = Date.now() - configureLifecycleStartedAt;

      // Asking twice for the exact same workspace must not start a second
      // server. A changed full plan is different: Vite can still hold the old
      // transformed route graph until its polling watcher notices the writes.
      // Framing it in that window loads a route tree that cannot reach a page
      // just created. Restart on a fingerprint change so the first request is
      // compiled from the complete new plan; incremental source edits continue
      // to use the live process and React Refresh.
      if (alreadyServing && workspaceUpdate !== "full") {
        observation.vite = {
          action: "reused",
          runningProcessId: alreadyServing.id ?? null,
          processId: alreadyServing.id ?? null,
        };
        const totalMs = Date.now() - requestStartedAt;
        return {
          ok: true,
          url: previewUrl,
          processId: alreadyServing.id,
          readyMs: 0,
          timings: {
            totalMs,
            sandboxHandleMs,
            workspaceMs,
            workspacePlanMs,
            workspaceFingerprintReadMs,
            workspaceMaterializeMs,
            workspaceReused,
            firstFilesystemCallMs,
            mkdirCalls,
            mkdirCumulativeMs,
            writeCalls,
            writeCumulativeMs,
            readCalls,
            readCumulativeMs,
            exposePortMs,
            configureLifecycleMs,
            processLookupMs,
            viteReadyMs: 0,
            reusedProcess: true,
          },
          hoistedContentFields: prepared.hoistedContentFields,
          warnings: prepared.previewWarnings,
          logs,
        };
      }

      if (alreadyServing) {
        if (!session.killProcess) {
          await failClosed("restart-unavailable");
          return {
            ok: false,
            stage: "preview-server-restart",
            errorMessage:
              "PREVIEW_SERVER_RESTART_UNAVAILABLE: The changed workspace could not replace its stale Vite process.",
            logs,
          };
        }
        // The process found earlier is not this start's. Another request may
        // have replaced it since, and stopping that one would take down a
        // server someone else just started — so ask again, and stop only the
        // one found, only if it is still running. Starting a second server
        // beside another request's would only fail on the pinned port, so
        // that request is left to finish. (A request can still step in
        // between this check and the kill; closing that needs one owner for
        // starts, which this does not add.)
        const current = await session.listProcesses?.().catch(() => null);
        const isRunningVite = (process: {
          command?: string;
          status?: string;
        }) =>
          Boolean(process.command?.includes(VITE_BIN)) &&
          (process.status === "running" || process.status === "starting");
        const replacement = current?.find(
          (process) =>
            process.id !== alreadyServing.id && isRunningVite(process),
        );
        if (replacement) {
          return {
            ok: false,
            stage: "preview-server-restart",
            errorMessage:
              "PREVIEW_SERVER_BUSY: Another start replaced the Vite process while this one was preparing.",
            logs,
          };
        }
        // An unreadable list says nothing, so the process found earlier is
        // still assumed to be running and is stopped as before.
        const stillRunning = current
          ? current.some(
              (process) =>
                process.id === alreadyServing.id && isRunningVite(process),
            )
          : true;
        if (stillRunning) {
          await session.killProcess(alreadyServing.id);
          // `killProcess()` requests termination, but a completed RPC does
          // not guarantee that the OS has released Vite's listening socket.
          // Starting the replacement immediately can make `--strictPort` exit
          // even though the old process disappears a moment later. Confirm
          // the process is gone before binding the same port again.
          if (
            !(await waitForProcessToStop(
              session,
              alreadyServing.id,
              this.stopTimeoutMs,
            ))
          ) {
            await failClosed("stale-vite-did-not-stop");
            return {
              ok: false,
              stage: "preview-server-restart",
              errorMessage:
                "PREVIEW_SERVER_STOP_TIMEOUT: The stale Vite process did not stop before its replacement was due to start.",
              logs,
            };
          }
        }
      }

      const startedAt = Date.now();
      let resolveLogOrExit: (value: "ready" | "exited") => void;
      const logOrExit = new Promise<"ready" | "exited">((resolve) => {
        resolveLogOrExit = resolve;
      });

      observation.vite = {
        action: alreadyServing ? "restarted" : "started",
        runningProcessId: alreadyServing?.id ?? null,
        processId: null,
      };
      const process = await session.startProcess(
        // --strictPort so the server cannot quietly land on another port and
        // leave the exposed URL pointing at nothing.
        `${VITE_BIN} --config ${prepared.workspaceRoot}/vite.config.ts --host 0.0.0.0 --port ${THEME_PREVIEW_SERVER_PORT} --strictPort`,
        {
          // Nothing from Morph's own environment. The preview holds no
          // credential, and its capability is the preview URL alone.
          env: { NODE_ENV: "development" },
          onOutput: (_stream, data) => {
            addLog(data);
            if (data.includes(READY_MARKER)) resolveLogOrExit("ready");
          },
          onExit: () => resolveLogOrExit("exited"),
        },
      );

      // The live Sandbox API does not guarantee that background-process
      // output callbacks are delivered while this Worker request is waiting.
      // The process object does provide a process-aware port check, which is
      // also the thing we actually need to know: can this Vite process serve
      // the page? Keep the output marker only for older providers and tests.
      observation.vite.processId = process.id ?? null;
      const portReady = process.waitForPort
        ? process
            .waitForPort(THEME_PREVIEW_SERVER_PORT, {
              path: THEME_PREVIEW_SERVER_BASE_PATH,
            })
            .then(() => "ready" as const)
            .catch((error) => {
              addLog(
                error instanceof Error
                  ? error.message
                  : "Preview server port check failed.",
              );
              return "exited" as const;
            })
        : null;
      const outcome = await withReadyTimeout(
        portReady ? Promise.race([portReady, logOrExit]) : logOrExit,
        this.readyTimeoutMs,
      );
      if (outcome !== "ready") {
        // This start's own process, by the id it was given: never one that
        // another request started.
        await session.killProcess?.(process.id).catch(() => {});
        await failClosed(`vite-${outcome}`);
        return {
          ok: false,
          stage: "preview-server-start",
          errorMessage:
            outcome === "timeout"
              ? `PREVIEW_SERVER_TIMEOUT: Vite did not report itself ready within ${this.readyTimeoutMs}ms.`
              : "PREVIEW_SERVER_EXITED: Vite exited before it was ready to serve.",
          logs,
        };
      }

      const viteReadyMs = Date.now() - startedAt;
      return {
        ok: true,
        url: previewUrl,
        processId: process.id,
        readyMs: viteReadyMs,
        timings: {
          totalMs: Date.now() - requestStartedAt,
          sandboxHandleMs,
          workspaceMs,
          workspacePlanMs,
          workspaceFingerprintReadMs,
          workspaceMaterializeMs,
          workspaceReused,
          firstFilesystemCallMs,
          mkdirCalls,
          mkdirCumulativeMs,
          writeCalls,
          writeCumulativeMs,
          readCalls,
          readCumulativeMs,
          exposePortMs,
          configureLifecycleMs,
          processLookupMs,
          viteReadyMs,
          reusedProcess: false,
        },
        hoistedContentFields: prepared.hoistedContentFields,
        warnings: prepared.previewWarnings,
        logs,
      };
    } catch (error) {
      if (session) {
        observation.failedClosed = "start-error";
        logPreviewServerEvent("fail-closed", {
          attemptId: observation.attemptId,
          previewId: input.previewId,
          reason: "start-error",
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            200,
          ),
        });
        await session
          .writeFile(
            THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
            newDirtyWorkspaceMarker(),
          )
          .catch(() => {});
      }
      return {
        ok: false,
        stage: "preview-server-start",
        errorMessage:
          error instanceof Error ? error.message : "Failed to start preview",
        logs,
      };
    }
  }

  /**
   * Tears a preview down.
   *
   * Revokes the URL before killing the process, so the window where the URL
   * resolves to something no longer being supervised stays closed.
   */
  /**
   * Whether the sandbox is still serving this preview, and a renewal of its
   * idle deadline in the same breath.
   *
   * The container sleeps on an idle timer that only sandbox calls postpone.
   * An open editor does not postpone it — the preview page holds its own
   * connection, not one the sandbox counts — so a Theme left on screen while
   * its author reads or steps away is put to sleep underneath them. Asking
   * this question is itself the answer to that: the call renews the deadline,
   * so a preview someone is still looking at stays alive, and an editor that
   * stops asking lets it sleep on schedule rather than pinning it awake for
   * nobody.
   *
   * The answer matters as much as the renewal. A dead sandbox leaves the
   * already-loaded preview page running in the browser, still replying to the
   * editor's heartbeat, so nothing on that side can notice: the heartbeat
   * proves the document is alive, never that the sandbox behind it is. This
   * asks the sandbox.
   */
  async isServing(input: {
    previewId: string;
    previewHostname: string;
    /** The address the editor is framing, if it said which. */
    expectedOrigin?: string | null;
  }): Promise<boolean> {
    const serving = await this.isServingUnobserved(input);
    logPreviewServerEvent("renew", {
      previewId: input.previewId,
      serving,
      framedAddress: previewAddressDigest(input.expectedOrigin),
    });
    return serving;
  }

  private async isServingUnobserved(input: {
    previewId: string;
    previewHostname: string;
    expectedOrigin?: string | null;
  }): Promise<boolean> {
    try {
      const session = await this.acquire(input.previewId);
      const running = await session.listProcesses?.();
      if (!running) return false;
      const viteRunning = running.some(
        (process) =>
          process.command?.includes(VITE_BIN) &&
          (process.status === "running" || process.status === "starting"),
      );
      if (!viteRunning) return false;

      // A running dev server is not a reachable one: the address in front of
      // it can be replaced while the process keeps running. What can be
      // concluded from that, though, is narrower than it looks.
      //
      // An empty list is not evidence of absence. Measured against a local
      // sandbox whose preview URL answered 200 throughout, this returns no
      // entries at all — so treating empty as unreachable reconnects a working
      // preview once per renewal, which is worse than the stale frame this
      // was added to catch. Only a list that names other addresses and not
      // this one proves anything, and that is the case it answers.
      if (!session.getExposedPorts || !input.expectedOrigin) return viteRunning;
      const exposed = await session.getExposedPorts(input.previewHostname);
      const active = exposed.filter(
        (entry) =>
          entry.port === THEME_PREVIEW_SERVER_PORT && entry.status === "active",
      );
      if (active.length === 0) return viteRunning;

      // Re-exposing mints a new address. The old one stops resolving even
      // though a port is active again, so the question is not whether some
      // preview is reachable but whether the one being framed is.
      //
      // Compared by hostname, never by origin. A developer's editor reaches
      // the sandbox through loopback, which rewrites the scheme and port of
      // the URL it was given and leaves the host alone — so origins never
      // match locally, while the host still carries the token that changes
      // when a port is exposed again.
      const expectedHost = safeHostname(input.expectedOrigin);
      if (!expectedHost) return false;
      return active.some((entry) => safeHostname(entry.url) === expectedHost);
    } catch {
      return false;
    }
  }

  async stop(previewId: string, processId?: string): Promise<void> {
    logPreviewServerEvent("stop", { previewId, processId: processId ?? null });
    const session = await this.acquire(previewId);
    await session.unexposePort?.(THEME_PREVIEW_SERVER_PORT).catch(() => {});
    await session.killProcess?.(processId).catch(() => {});
    await session.destroy();
  }
}
