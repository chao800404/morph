import {
  resolveThemeFramework,
  type ThemeFrameworkAdapter,
} from "../theme-framework";
import type { PreviewServing } from "../editor/preview-serving";
import {
  parsePreviewRequestTraceRecords,
  PREVIEW_REQUEST_TRACE_ENV,
  PREVIEW_REQUEST_TRACE_RECORD_PATH,
  PREVIEW_REQUEST_TRACE_STATUS_PATH,
} from "./theme-preview-request-trace";
import {
  registeredThemeToolchains,
  themeToolchainForFramework,
} from "../theme-framework/theme-toolchains";
import { prepareSandboxToolchain } from "./sandbox-toolchain";
import {
  materializeThemeSandboxWorkspace,
  unplannedWorkspaceFiles,
  type ThemeWorkspaceFile,
  type ThemeWorkspaceWriter,
  isBinaryWorkspaceFile,
  type ThemeWorkspaceBinaryLoader,
  type ThemePreviewRuntime,
} from "./theme-sandbox-workspace";
import {
  writeSandboxWorkspaceFile,
  type SandboxFileWriter,
} from "./sandbox-file-writer";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "./theme-preview-dev-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { boundedPreviewLogAppender } from "./bounded-preview-log";
import { START_PREVIEW_ADDRESS_PROBE_PATH } from "../service/preview-address-probe";
import { resolveThemePreviewServerHost } from "@/lib/storefront/service/theme-preview-server-origin";
import {
  isDirtyWorkspaceMarker,
  newDirtyWorkspaceMarker,
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH,
  THEME_PREVIEW_WORKSPACE_MANIFEST_RELATIVE_PATH,
} from "./theme-workspace-path";
import { verifyWorkspaceOnDisk } from "./theme-workspace-verification";
import {
  fenceLedgerVouchesFor,
  gatedServeCommand,
  PREVIEW_FENCE_LEDGER_PATH,
  PREVIEW_INSTANCE_PATH,
  PREVIEW_START_STAGING_PREFIX,
  runFencedWriteInSandbox,
  runPreviewContentRequestInSandbox,
  writePreviewServeGate,
  type FenceSandbox,
  type PreviewClaimStanding,
  type PreviewStartClaim,
} from "./preview-write-fence-sandbox";
import type { ThemePreviewContentSnapshot } from "./theme-preview-content";
import type { PlatformHostnameEnv } from "@/lib/storefront/service/storefront-request-routing";
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
import type { PreviewStartAttemptStatus } from "./preview-start-attempt-guard";
import {
  classifyPreviewStartInterruption,
  type ThrownStartError,
} from "./preview-start-retry";
import type {
  PreviewStartRetrySignal,
  PreviewStartRetryStep,
} from "../editor/preview-start-recovery";

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

/**
 * Any registered toolchain's Vite or Astro dev server: what a running preview
 * server is.
 */
const PREVIEW_VITE_BINS = registeredThemeToolchains().flatMap((toolchain) => [
  `${toolchain.root}/node_modules/.bin/vite`,
  `${toolchain.root}/node_modules/.bin/astro dev`,
]);
function isPreviewViteCommand(command: string | undefined): boolean {
  return Boolean(
    command && PREVIEW_VITE_BINS.some((bin) => command.includes(bin)),
  );
}

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

function withPreviewServerBase(
  exposedUrl: string,
  framework: ThemeFrameworkAdapter,
  runtime?: ThemePreviewRuntime,
): string {
  const url = new URL(exposedUrl);
  url.pathname = previewServerPath(framework, runtime);
  return url.toString();
}

/**
 * The sandbox surface a preview server needs, beyond writing its workspace.
 */
export type PreviewServerSession = Omit<ThemeWorkspaceWriter, "writeFile"> &
  SandboxFileWriter &
  Readonly<{
    readFile?(
      path: string,
      options?: { encoding?: string },
    ): Promise<{ content?: unknown } | string>;
    startProcess(
      command: string,
      options?: {
        env?: Record<string, string>;
        cwd?: string;
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
    /**
     * A listed process by id, with its port check; null once the container
     * no longer has it. Older providers may not expose it.
     */
    getProcess?(id: string): Promise<PreviewServerProcess | null>;
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
    /**
     * The preview Durable Object's current-start record (`PreviewSandbox`,
     * `preview-start-attempt-guard.ts`). A start claims it, a retry asks it
     * before it is sent, every success asks it before it is answered, and
     * a stop ends it. A session without them is never retried. A claim
     * returns its number, which the start registers as the workspace's
     * owner in the container's fence ledger (user, 2026-11-24).
     */
    claimPreviewStart?(input: {
      attemptId: string;
      deadlineAt: number;
    }): Promise<{ seq: number }>;
    checkPreviewStart?(input: {
      attemptId: string;
      next?: string;
    }): Promise<PreviewStartAttemptStatus>;
    endPreviewStarts?(): Promise<void>;
    /**
     * Runs a command to completion. Every write to the workspace — a sync's,
     * and a start's — is applied through it, under the container's lock.
     */
    exec(command: string): Promise<{
      success: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
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
  /** `null` only where the framework's preview uses none (`preview.entryFile`). */
  entry: string | null;
  dependencies?: Readonly<Record<string, string>>;
  /** Host the preview URL is built on. Must not be platform surface. */
  previewHostname: string;
  /**
   * The Worker vars that name Morph's hostnames, so every platform hostname
   * can be refused, not just one. Only these: a start crosses to another
   * process on the sidecar transport, and the rest of the env holds secrets.
   * Build it with `pickPlatformHostnameEnv`, never by passing the env.
   */
  platformHostEnv: PlatformHostnameEnv | undefined;
  /** Authenticated draft content reduced to render-only values. */
  previewContent?: ThemePreviewContentSnapshot;
  /**
   * The saved version of each file being laid out, recorded as the preview's
   * write fences so a sync made from an older version cannot land afterwards.
   * See `preview-write-fence.ts`.
   */
  fileVersions?: Readonly<Record<string, number>>;
  /**
   * The Theme source generation `files` were read at — the same snapshot,
   * checked by reading it before and after (`readAtSourceGeneration`). A
   * start read before a save that a sync has already laid out is refused,
   * including when that save created a file this start's plan never had.
   */
  sourceGeneration?: number;
  /**
   * Reads a binary file's bytes when it is written. Required whenever
   * `files` holds one; never serialised, so a transport that crosses a
   * process boundary carries binary files its own way.
   */
  loadBinary?: ThemeWorkspaceBinaryLoader;
  /**
   * PROTOTYPE: `start` serves the Theme through the Start server in workerd,
   * at the root path; see `theme-preview-start-runtime.ts`. Absent means
   * today's client-only preview.
   */
  previewRuntime?: ThemePreviewRuntime;
  /**
   * The framework the Theme records. Absent reads as TanStack Start, as
   * every preview did before frameworks were recorded; one Morph cannot
   * preview is refused before anything is started, never previewed as
   * another framework. Passed as recorded, so a value that names no
   * framework is refused too (`THEME_FRAMEWORK_UNKNOWN`).
   */
  framework?: string | null;
  /**
   * Whether this server previews Astro (`MORPH_ASTRO_THEMES=1`, never in
   * production; `astroThemesEnabled`). Decided by the Worker that starts the
   * preview, the policy point for both transports; absent, Astro is refused
   * as before (`THEME_FRAMEWORK_UNAVAILABLE`).
   */
  astroThemes?: boolean;
}>;

/** Where a preview of this framework and runtime is framed, on the exposed origin. */
export function previewServerPath(
  framework: ThemeFrameworkAdapter,
  runtime: ThemePreviewRuntime | undefined,
): string {
  return framework.preview.framePath(runtime);
}

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
      /**
       * The bridge this start's plan laid out and the instance serving it.
       * Null (or absent, from an older transport) is unknown. It names what
       * was written and started, nothing more: a write still waits for the
       * page's own acknowledgement.
       */
      serving?: PreviewServing | null;
      /**
       * Present only when this answer is the automatic retry's: the first
       * attempt was interrupted (`preview-start-retry.ts`). Server-side
       * only — `errorMessage` is container output and never reaches the
       * browser; the server function answers the browser-safe part.
       */
      recoveredFrom?: PreviewStartRecoveredFrom;
    }>
  | Readonly<{
      ok: false;
      attemptId?: string;
      stage: string;
      errorMessage: string;
      logs: readonly string[];
      /** The attempt this one retried, when the failure is the retry's. */
      retryOf?: string;
    }>;

/** The interrupted first attempt a retried start recovered from. */
export type PreviewStartRecoveredFrom = Readonly<{
  attemptId: string;
  stage: string;
  reason: "sandbox-interrupted";
  /** Required: which allow-listed interruption this was. */
  signal: PreviewStartRetrySignal;
  step: PreviewStartRetryStep;
  attempts: 2;
  errorMessage: string;
}>;

/** Refusals of a start that is no longer the current one (auto-retry v2, §3). */
const NOT_CURRENT_START: Readonly<
  Record<
    Exclude<PreviewStartAttemptStatus, "current" | "expired"> | "unconfirmed",
    { stage: string; errorMessage: string }
  >
> = {
  stopped: {
    stage: "preview-start-stopped",
    errorMessage:
      "PREVIEW_START_STOPPED: The preview was stopped while this start was running; its result is not used.",
  },
  superseded: {
    stage: "preview-start-superseded",
    errorMessage:
      "PREVIEW_START_SUPERSEDED: A newer start of this preview replaced this one; its result is not used.",
  },
  unconfirmed: {
    stage: "preview-start-unconfirmed",
    errorMessage:
      "PREVIEW_START_UNCONFIRMED: Could not confirm this start is still the preview's current one; its result is not used.",
  },
};

/**
 * A retry asks before each of its container steps whether it is still the
 * current start; this carries the refusal out of the step it stopped, so
 * the start answers it there. What it may still do in the container then
 * depends on the refusal (`refusalLeavesWorkspace`).
 */
class PreviewStartNotCurrentError extends Error {
  constructor(readonly refusal: { stage: string; errorMessage: string }) {
    super(refusal.errorMessage);
    this.name = "PreviewStartNotCurrentError";
  }
}

/**
 * Whether the Durable Object has already said the workspace is not this
 * start's: another start of the preview claimed it (superseded), or the
 * preview was stopped (the container is gone, and a write would only wake
 * it). Then nothing shared is even attempted. Otherwise it is the fence
 * ledger, under its lock, that decides whether this start may still write
 * the shared marker (`op: "mark"`, user 2026-11-24): a deadline or
 * unconfirmed refusal still marks the workspace untrusted while the ledger
 * names this attempt's claim as its owner, and writes nothing once it
 * names another.
 */
function refusalLeavesWorkspace(refusal: { stage: string }): boolean {
  return (
    refusal.stage === NOT_CURRENT_START.superseded.stage ||
    refusal.stage === NOT_CURRENT_START.stopped.stage
  );
}

/**
 * "Container failed to start", as it reaches the transport over Durable
 * Object RPC: the message only, with at most the SDK's class name folded in
 * front ("SandboxError: Container failed to start: ..."; round 3, formal 1c).
 *
 * The containers library reaches its start only for a container that is
 * not running (`startContainerIfNotRunning`), and this failure leaves it
 * stopped with the call's connection destroyed. The SDK's next call opens
 * a new connection, and that starts a container again: one that would hold
 * nothing of this start, not its staging in /tmp nor a workspace. So after
 * it the start makes no container call at all (not its own staging
 * clean-up, not the fail-closed marker): the fence ledger already refuses
 * to trust a workspace without a proven commit (`fenceLedgerVouchesFor`).
 *
 * Only for what to skip afterwards. It is not a retry signal: this failure
 * stays off the allow-list (user, 2026-11-24; preview-start-retry.ts).
 */
const CONTAINER_FAILED_TO_START =
  /^(?:[A-Za-z]*Error: )?Container failed to start\b/;

/**
 * The platform's two admission refusals, as SDK 0.12.7 passes them on
 * verbatim in a ContainerUnavailableError (CONTAINER_UNAVAILABLE_SIGNATURES),
 * with at most that class name folded in front over Durable Object RPC.
 * The whole message, anchored at both ends, case-insensitive (the SDK
 * lowercases before it matches). Same hazard as above: the failed
 * connection is destroyed, and the next call's connection starts a
 * container (handoff/2026-11-24/container-unavailable-classification.md).
 *
 * Only these two (user, 2026-11-24): not the error's code, which the SDK
 * also uses after a container ran, not the HTTP path's "available at this
 * time", not a start timeout. Only for what to skip afterwards, never a
 * retry signal: the allow-list (preview-start-retry.ts) is unchanged. A
 * future SDK that rewords them misses here, which is today's behaviour.
 */
const CONTAINER_ADMISSION_REFUSED =
  /^(?:ContainerUnavailableError: )?(?:there is no container instance that can be provided to this durable object|maximum number of running container instances exceeded)$/i;

/** Why the container is gone after `error`, or null: calls may go on. */
function containerStartFailure(
  error: unknown,
): "container-failed-to-start" | "container-admission-refused" | null {
  if (!(error instanceof Error)) return null;
  if (CONTAINER_FAILED_TO_START.test(error.message)) {
    return "container-failed-to-start";
  }
  if (CONTAINER_ADMISSION_REFUSED.test(error.message)) {
    return "container-admission-refused";
  }
  return null;
}

function isContainerStartFailure(error: unknown): boolean {
  return containerStartFailure(error) !== null;
}

/**
 * What a start has put in its staging directory, for the container to apply:
 * the files at their workspace-relative paths, and the files the plan no
 * longer has.
 */
type StagedStart = {
  staging: string | null;
  files: string[];
  prune: string[];
};

const WORKSPACE_ROOT = "/workspace";

const workspaceRelative = (absolutePath: string) =>
  absolutePath.slice(WORKSPACE_ROOT.length + 1);

/** What one start decided, gathered as it goes and logged when it ends. */
type StartObservation = {
  readonly attemptId: string;
  workspace?: {
    reused: boolean;
    fingerprint: string;
    /** The marker found: a fingerprint, `dirty` after an incremental sync, or none. */
    previous: string | null;
    /** A committed marker the fence ledger did not vouch for: laid out again. */
    unvouched?: true;
    change?: WorkspaceChange;
    /** What was written: nothing, only the content snapshot, or everything. */
    update?: "none" | "content-only" | "full";
    /** For a `dirty` workspace: how many files were read back, or why not. */
    verification?: { read: number } | { failed: string };
    /** False when another writer marked the workspace before this one committed. */
    committed?: boolean;
    /** How many files already held a newer version, refusing the start. */
    refused?: number;
  };
  vite?: {
    action: "reused" | "restarted" | "started";
    runningProcessId: string | null;
    processId: string | null;
    /**
     * Present, and true, only when this start handed the Vite process the
     * container-side request record's switch (theme-preview-request-trace.ts):
     * the record's health signal on the Worker's side. Absent otherwise, so a
     * deployment's log is unchanged.
     */
    requestTrace?: true;
  };
  address?: { reused: boolean; digest: string | null };
  /** Why the start left the workspace marked untrusted instead of succeeding. */
  failedClosed?: string;
  /** The start step running now, when it is one a retry may follow. */
  step?: PreviewStartRetryStep;
  /**
   * What the fence ledger said of this attempt's claim when it refused it
   * (user, 2026-11-24): another claim owns the workspace, or none can be
   * proven. Absent while the attempt owns it.
   */
  ledger?: Exclude<PreviewClaimStanding, "owner">;
  /** What the start threw, and in which step, when it threw. */
  thrown?: ThrownStartError;
};

/** One start request, across its attempts. */
type StartRequestState = Readonly<{
  inflight: Readonly<{ concurrentAtEntry: number }>;
  requestStartedAt: number;
  deadlineAt: number;
  /** The session its Durable Object is asked through; null: unguarded. */
  guard: PreviewServerSession | null;
  /**
   * The number the Durable Object issued for this request's claim, which
   * both its attempts register in the fence ledger; null when unguarded.
   */
  claimSeq: number | null;
}>;

/** A sandbox handle, and how long getting it took. */
type AcquiredPreviewSession = Readonly<{
  session: PreviewServerSession;
  ms: number;
}>;

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
  /**
   * Starts Vite with the container-side request record on
   * (theme-preview-request-trace.ts). Diagnostics for the container
   * acceptance job only; never set in production.
   */
  requestTrace?: boolean;
  /**
   * The server-side deadline of one start request, shared by its first
   * attempt and its retry (auto-retry v2, §2): each attempt waits for Vite
   * at most what is left of it, and a success that comes back after it is
   * not answered as ready. The length is to be set from the container
   * diagnostics; until then it is the editor's own wait for a start
   * (`PREVIEW_SERVER_TIMEOUT_MS`, 180 s), past which no one is listening.
   */
  startDeadlineMs?: number;
  /** The pause before the retry; counted inside `retryWindowMs`. */
  retryPauseMs?: number;
  /** How long after the request began a retry may still be sent. */
  retryWindowMs?: number;
  /** The clock the deadline and the window are read on. Tests only. */
  now?: () => number;
  /** How the pause is waited out. Tests only. */
  pause?: (ms: number) => Promise<void>;
}>;

/** See `startDeadlineMs`. */
const PREVIEW_START_DEADLINE_MS = 180_000;
/** One retry, after this pause (the replacement container was up 0.5 s later). */
const PREVIEW_START_RETRY_PAUSE_MS = 500;
/** Including the pause: a retry is sent only within this of the request. */
const PREVIEW_START_RETRY_WINDOW_MS = 30_000;

/** Request record lines per log line: each line stays some 15 KB. */
const REQUEST_TRACE_RECORDS_PER_LINE = 100;

/** Per preview and Vite process, the last record line this isolate logged. */
const requestTraceLoggedThrough = new Map<string, number>();

function readFailure(error: unknown): "missing" | "unreadable" {
  // The SDK answers a file that is not there with FileNotFoundError.
  return (error as { name?: unknown } | null)?.name === "FileNotFoundError" ||
    /not found|no such file|ENOENT/i.test(String(error))
    ? "missing"
    : "unreadable";
}

/**
 * The checks a start passes before it may touch a container: its preview
 * host and the framework the Theme records. Pure and cheap. A start that
 * fails one acquires no container, claims nothing and changes nothing
 * (docs/astro-theme-plan.md, A1).
 */
function resolveStartPrerequisites(
  input: StartPreviewServerInput,
):
  | Readonly<{ ok: true; previewHost: string; framework: ThemeFrameworkAdapter }>
  | Readonly<{ ok: false; stage: string; errorMessage: string }> {
  // One rule, shared with the editor side that later frames the URL. A
  // preview on any platform host would put Theme code in Morph's cookie jar.
  const host = resolveThemePreviewServerHost({
    configuredPreviewHostname: input.previewHostname,
    env: input.platformHostEnv,
  });
  if (!host.enabled) {
    return {
      ok: false,
      stage: "preview-origin",
      errorMessage: `${host.reason}: A Live Preview that runs Theme JavaScript needs its own host, separate from every Morph hostname.`,
    };
  }
  const recordedFramework = resolveThemeFramework(input.framework, {
    astroThemes: input.astroThemes === true,
  });
  if (!recordedFramework.ok) {
    return {
      ok: false,
      stage: "preview-framework",
      errorMessage: recordedFramework.message,
    };
  }
  return {
    ok: true,
    previewHost: host.hostname,
    framework: recordedFramework.framework,
  };
}

export class CloudflareSandboxVitePreviewServer {
  private readonly sandboxBinding?: unknown;
  private readonly sandboxProvider?: PreviewServerProvider;
  private readonly approvedDependencies: ReadonlySet<string>;
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly sleepAfter: string | number;
  private readonly maxLogLines: number;
  private readonly requestTrace: boolean;
  private readonly startDeadlineMs: number;
  private readonly retryPauseMs: number;
  private readonly retryWindowMs: number;
  private readonly now: () => number;
  private readonly pause: (ms: number) => Promise<void>;

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
    this.requestTrace = options.requestTrace === true;
    this.startDeadlineMs = options.startDeadlineMs ?? PREVIEW_START_DEADLINE_MS;
    this.retryPauseMs = options.retryPauseMs ?? PREVIEW_START_RETRY_PAUSE_MS;
    this.retryWindowMs = options.retryWindowMs ?? PREVIEW_START_RETRY_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
    this.pause =
      options.pause ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** `acquire`, with how long getting the handle took. */
  private async acquireTimed(
    previewId: string,
  ): Promise<AcquiredPreviewSession> {
    const startedAt = Date.now();
    const session = await this.acquire(previewId);
    return { session, ms: Date.now() - startedAt };
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

  /**
   * Starts the preview, retrying the whole start at most once after the one
   * allow-listed sandbox interruption (auto-retry v2;
   * `preview-start-retry.ts`). Both attempts share one server-side deadline
   * and the one start slot this request entered, and the preview's Durable
   * Object decides whether each is still the current start: a stopped,
   * superseded or expired start is not sent again, and its late success is
   * not answered as ready.
   */
  async start(
    input: StartPreviewServerInput,
  ): Promise<StartPreviewServerResult> {
    const inflight = enterPreviewStart(input.previewId);
    const requestStartedAt = this.now();
    const deadlineAt = requestStartedAt + this.startDeadlineMs;
    const firstAttemptId = newPreviewAttemptId();
    try {
      // A start refused before any container (its preview host, its
      // framework) acquires none and claims nothing: claiming acquires the
      // container. Its one attempt runs unguarded and stops at the same
      // check, before its own acquire, so it never reaches a container and
      // has no workspace to own.
      const refusedBeforeContainer = !resolveStartPrerequisites(input).ok;
      // One handle for the claim and the first attempt.
      const firstAcquire = refusedBeforeContainer
        ? null
        : this.acquireTimed(input.previewId);
      // Claimed before any container step: from here on a newer start or a
      // stop is visible to this one.
      const claimed =
        firstAcquire === null
          ? null
          : await this.claimStart(firstAcquire, firstAttemptId, deadlineAt);
      if (claimed === "unconfirmed") {
        // Ownership cannot be proven without a number (user, 2026-11-24):
        // nothing shared is written, so the start does not run at all. The
        // Durable Object that could not be asked is the one that holds the
        // container, so nothing would have reached it either.
        const refusal = NOT_CURRENT_START.unconfirmed;
        logPreviewServerEvent("start", {
          attemptId: firstAttemptId,
          previewId: input.previewId,
          startedAt: new Date().toISOString(),
          concurrentAtEntry: inflight.concurrentAtEntry,
          outcome: "failed",
          stage: refusal.stage,
          error: refusal.errorMessage.slice(0, 200),
          workspace: null,
          vite: null,
          address: null,
          failedClosed: null,
          guarded: false,
        });
        return { ok: false, attemptId: firstAttemptId, ...refusal, logs: [] };
      }
      const request: StartRequestState = {
        inflight,
        requestStartedAt,
        deadlineAt,
        guard: claimed?.session ?? null,
        claimSeq: claimed?.seq ?? null,
      };
      const first = await this.startAttempt(input, request, {
        attemptId: firstAttemptId,
        mayRetry: true,
        ...(firstAcquire ? { acquired: firstAcquire } : {}),
      });
      if (!first.retry) return first.result;

      // The pause counts inside the window; both are read again after it.
      await this.pause(this.retryPauseMs);
      const retryAttemptId = newPreviewAttemptId();
      const refusal = await this.refuseRetry(request, {
        attemptId: firstAttemptId,
        next: retryAttemptId,
      });
      if (refusal) {
        logPreviewServerEvent("start-retry", {
          retryOf: firstAttemptId,
          previewId: input.previewId,
          outcome: "cancelled",
          reason: refusal.reason,
        });
        // Stopped or superseded: say so. Out of time: the first failure
        // stands, as if no retry existed.
        return refusal.answer
          ? { ...refusal.answer, logs: first.result.logs }
          : first.result;
      }
      logPreviewServerEvent("start-retry", {
        retryOf: firstAttemptId,
        attemptId: retryAttemptId,
        previewId: input.previewId,
        outcome: "sent",
        signal: first.retry.signal,
        step: first.retry.step,
      });
      const second = await this.startAttempt(input, request, {
        attemptId: retryAttemptId,
        mayRetry: false,
        retryOf: firstAttemptId,
      });
      if (!second.result.ok) {
        return { ...second.result, retryOf: firstAttemptId };
      }
      return {
        ...second.result,
        recoveredFrom: {
          attemptId: firstAttemptId,
          stage: first.retry.stage,
          reason: "sandbox-interrupted",
          signal: first.retry.signal,
          step: first.retry.step,
          attempts: 2,
          errorMessage: first.retry.errorMessage,
        },
      };
    } finally {
      inflight.leave();
    }
  }

  /**
   * Claims the preview for this start in its Durable Object, and returns
   * the session to ask it again through, with the claim's number. Null for
   * a session with no such guard (a provider without the Durable Object):
   * the start then runs as before, unguarded, and is never retried.
   * "unconfirmed" when the guard is there but the claim failed or returned
   * no number: workspace ownership cannot be proven (user, 2026-11-24).
   */
  private async claimStart(
    acquiring: Promise<AcquiredPreviewSession>,
    attemptId: string,
    deadlineAt: number,
  ): Promise<
    { session: PreviewServerSession; seq: number } | null | "unconfirmed"
  > {
    let session: PreviewServerSession;
    try {
      ({ session } = await acquiring);
    } catch {
      // The first attempt awaits the same handle, and answers this.
      return null;
    }
    if (
      typeof session.claimPreviewStart !== "function" ||
      typeof session.checkPreviewStart !== "function"
    ) {
      return null;
    }
    try {
      const claimed = await session.claimPreviewStart({ attemptId, deadlineAt });
      const seq = (claimed as { seq?: unknown } | undefined)?.seq;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq)) {
        return "unconfirmed";
      }
      return { session, seq };
    } catch {
      return "unconfirmed";
    }
  }

  /**
   * Why the retry must not be sent, read after the pause: the request's
   * deadline or its retry window has passed, or its Durable Object no longer
   * names the first attempt as current. When none holds, the Durable Object
   * has already handed "current" to `next`.
   */
  private async refuseRetry(
    request: StartRequestState,
    attempt: { attemptId: string; next: string },
  ): Promise<{
    reason: string;
    answer: StartPreviewServerResult | null;
  } | null> {
    const now = this.now();
    if (now >= request.deadlineAt) return { reason: "deadline", answer: null };
    if (now - request.requestStartedAt > this.retryWindowMs) {
      return { reason: "retry-window", answer: null };
    }
    let status: PreviewStartAttemptStatus;
    try {
      status = await request.guard!.checkPreviewStart!(attempt);
    } catch {
      return { reason: "unconfirmed", answer: null };
    }
    if (status === "current") return null;
    if (status === "expired") return { reason: "deadline", answer: null };
    return {
      reason: status,
      answer: {
        ok: false,
        attemptId: attempt.attemptId,
        ...NOT_CURRENT_START[status],
        logs: [],
      },
    };
  }

  /**
   * Why a successful attempt must not be answered as ready: the request's
   * deadline has passed, or the preview's Durable Object no longer names it
   * as the current start (or cannot say). Null to answer it. A retry asks
   * the same before each of its container steps (`beforeContainerStep`).
   */
  private async refuseLateSuccess(
    request: StartRequestState,
    attemptId: string,
  ): Promise<{ stage: string; errorMessage: string } | null> {
    if (this.now() >= request.deadlineAt) {
      return this.deadlineRefusal();
    }
    if (!request.guard) return null;
    let status: PreviewStartAttemptStatus;
    try {
      status = await request.guard.checkPreviewStart!({ attemptId });
    } catch {
      return NOT_CURRENT_START.unconfirmed;
    }
    if (status === "current") return null;
    if (status === "expired") return this.deadlineRefusal();
    return NOT_CURRENT_START[status];
  }

  private deadlineRefusal(): { stage: string; errorMessage: string } {
    return {
      stage: "preview-start-deadline",
      errorMessage: `PREVIEW_START_DEADLINE: This start did not finish within its ${this.startDeadlineMs}ms deadline; its result is not used.`,
    };
  }

  /**
   * One attempt of a start, with its own attempt id and its own
   * `[preview-observe] start` line. Says whether it may be retried: only
   * the first attempt, only when guarded, only for the allow-listed
   * interruption thrown by one of the start's own steps, and only while the
   * request is inside its deadline and its retry window.
   */
  private async startAttempt(
    input: StartPreviewServerInput,
    request: StartRequestState,
    attempt: {
      attemptId: string;
      mayRetry: boolean;
      retryOf?: string;
      /** The handle the claim reached for (first attempt only). */
      acquired?: Promise<AcquiredPreviewSession>;
    },
  ): Promise<{
    result: StartPreviewServerResult;
    retry: {
      signal: PreviewStartRetrySignal;
      step: PreviewStartRetryStep;
      stage: string;
      errorMessage: string;
    } | null;
  }> {
    const observation: StartObservation = { attemptId: attempt.attemptId };
    const startedAt = new Date().toISOString();
    let result: StartPreviewServerResult | null = null;
    let retry: {
      signal: PreviewStartRetrySignal;
      step: PreviewStartRetryStep;
      stage: string;
      errorMessage: string;
    } | null = null;
    let requestTraceStatus: unknown;
    let requestTraceRecord: unknown;
    try {
      const remainingMs = request.deadlineAt - this.now();
      if (remainingMs <= 0) {
        result = { ok: false, ...this.deadlineRefusal(), logs: [] };
        return { result: { ...result, attemptId: attempt.attemptId }, retry };
      }
      // Never a full ready timeout for a retry: what is left of the
      // request's deadline, at most.
      result = await this.startObserved(input, observation, {
        readyTimeoutMs: Math.min(this.readyTimeoutMs, remainingMs),
        ...(attempt.acquired ? { acquired: attempt.acquired } : {}),
        // Both attempts register the request's number in the fence ledger;
        // the retry outranks its first attempt (user, 2026-11-24).
        ...(request.claimSeq !== null
          ? {
              claim: {
                seq: request.claimSeq,
                attempt: attempt.retryOf ? 2 : 1,
                attemptId: attempt.attemptId,
              },
            }
          : {}),
        // A retry also asks before each of its container steps, with the
        // same check its success asks: once another start of this preview
        // has claimed it (another tab), or it was stopped or ran out of
        // time, it stops before its next step, so it never lays its files
        // over the newer start's or starts a second dev server. The first
        // attempt does not ask per step (the retry is the rare path).
        //
        // Check-then-act, not atomic with the write: the DO answer and the
        // container step are two calls, so a claim that lands between them
        // lets that one step run after it. That is no longer what keeps a
        // superseded attempt out of the workspace: the fence ledger is
        // (user, 2026-11-24). Once the newer start has registered its claim
        // there, this attempt's fence, marker, content stamp and dev server
        // launch are refused under the container's lock, whichever attempt
        // it is. This check only stops a retry earlier, before its own
        // staging writes.
        ...(attempt.retryOf && request.guard
          ? {
              beforeContainerStep: async () => {
                const refused = await this.refuseLateSuccess(
                  request,
                  attempt.attemptId,
                );
                if (refused) throw new PreviewStartNotCurrentError(refused);
              },
            }
          : {}),
      });
      if (result.ok) {
        if (this.requestTrace) {
          requestTraceStatus = await this.readRequestTraceStatus(
            input.previewId,
          );
          requestTraceRecord = await this.readRequestTraceRecord(
            input.previewId,
            observation.attemptId,
          );
        }
        const refused = await this.refuseLateSuccess(
          request,
          attempt.attemptId,
        );
        if (refused) result = { ok: false, ...refused, logs: result.logs };
      } else if (attempt.mayRetry && request.guard && observation.thrown) {
        const signal = classifyPreviewStartInterruption(observation.thrown);
        const now = this.now();
        if (
          signal &&
          observation.thrown.step &&
          now < request.deadlineAt &&
          now - request.requestStartedAt <= this.retryWindowMs
        ) {
          retry = {
            signal,
            step: observation.thrown.step,
            stage: result.stage,
            errorMessage: result.errorMessage,
          };
        }
      }
      return { result: { ...result, attemptId: attempt.attemptId }, retry };
    } finally {
      logPreviewServerEvent("start", {
        attemptId: observation.attemptId,
        previewId: input.previewId,
        startedAt,
        concurrentAtEntry: request.inflight.concurrentAtEntry,
        outcome: result === null ? "threw" : result.ok ? "ready" : "failed",
        ...(result && !result.ok
          ? { stage: result.stage, error: result.errorMessage.slice(0, 200) }
          : {}),
        workspace: observation.workspace ?? null,
        vite: observation.vite ?? null,
        address: observation.address ?? null,
        failedClosed: observation.failedClosed ?? null,
        ...(request.guard ? {} : { guarded: false }),
        ...(retry ? { retry: "scheduled" } : {}),
        ...(attempt.retryOf ? { retryOf: attempt.retryOf, attempt: 2 } : {}),
        ...(observation.ledger ? { ledger: observation.ledger } : {}),
        ...(requestTraceStatus !== undefined ? { requestTraceStatus } : {}),
        ...(requestTraceRecord !== undefined ? { requestTraceRecord } : {}),
        ...(result?.ok ? { timings: result.timings } : {}),
      });
    }
  }

  /**
   * The container-side request record's own state
   * (theme-preview-request-trace.ts), read back through the sandbox's file
   * API: its health signal when the container's log holds none of it. Only
   * the record's three fields are kept; anything else reads as what it is.
   */
  private async readRequestTraceStatus(previewId: string): Promise<
    | {
        pid: number | null;
        httpServer: boolean | null;
        writeError: string | null;
        capped: boolean | null;
      }
    | "missing"
    | "unreadable"
  > {
    try {
      const session = await this.acquire(previewId);
      if (!session.readFile) return "unreadable";
      const value = await session.readFile(PREVIEW_REQUEST_TRACE_STATUS_PATH, {
        encoding: "utf-8",
      });
      const text =
        typeof value === "string"
          ? value
          : typeof value.content === "string"
            ? value.content
            : null;
      if (text === null) return "unreadable";
      const parsed = JSON.parse(text.slice(0, 512)) as Record<string, unknown>;
      return {
        pid: typeof parsed.pid === "number" ? parsed.pid : null,
        httpServer:
          typeof parsed.httpServer === "boolean" ? parsed.httpServer : null,
        writeError:
          typeof parsed.writeError === "string"
            ? parsed.writeError.slice(0, 40)
            : null,
        capped: typeof parsed.capped === "boolean" ? parsed.capped : null,
      };
    } catch (error) {
      return readFailure(error);
    }
  }

  /**
   * The container-side request record itself, read back the same way and
   * written to this log in parts, so the job log holds what the container's
   * own log could not. Read only after a start completes, never after a
   * failed request. Lines already logged by this isolate for the same Vite
   * process are left out; one logged twice by another isolate carries the
   * same process id and line number.
   */
  private async readRequestTraceRecord(
    previewId: string,
    attemptId: string,
  ): Promise<
    | {
        chars: number;
        records: number;
        logged: number;
        invalid: number;
        readMs: number;
      }
    | "missing"
    | "unreadable"
  > {
    const readStarted = Date.now();
    let text: string | null;
    try {
      const session = await this.acquire(previewId);
      if (!session.readFile) return "unreadable";
      const value = await session.readFile(PREVIEW_REQUEST_TRACE_RECORD_PATH, {
        encoding: "utf-8",
      });
      text =
        typeof value === "string"
          ? value
          : typeof value.content === "string"
            ? value.content
            : null;
    } catch (error) {
      return readFailure(error);
    }
    if (text === null) return "unreadable";
    const readMs = Date.now() - readStarted;
    const { records, invalid } = parsePreviewRequestTraceRecords(text);
    const fresh = records.filter((record) => {
      if (typeof record.pid !== "number" || typeof record.n !== "number") {
        return true;
      }
      const key = `${previewId}:${record.pid}`;
      if (record.n <= (requestTraceLoggedThrough.get(key) ?? 0)) return false;
      requestTraceLoggedThrough.set(key, record.n);
      return true;
    });
    const parts = Math.ceil(fresh.length / REQUEST_TRACE_RECORDS_PER_LINE);
    for (let part = 0; part < parts; part++) {
      logPreviewServerEvent("request-trace", {
        attemptId,
        previewId,
        part: part + 1,
        parts,
        records: fresh.slice(
          part * REQUEST_TRACE_RECORDS_PER_LINE,
          (part + 1) * REQUEST_TRACE_RECORDS_PER_LINE,
        ),
      });
    }
    return {
      chars: text.length,
      records: records.length,
      logged: fresh.length,
      invalid,
      readMs,
    };
  }

  /**
   * Writes a start's files into a staging directory of their own, and works
   * out which workspace files the plan no longer has. Nothing in
   * `/workspace` changes here; that is `op: "start"`, under the lock.
   *
   * A full update stages every planned file through the same materializer
   * as ever, pointed at the staging directory; a content-only one stages the
   * changed content files alone.
   */
  private async stageStart(
    session: PreviewServerSession,
    writer: ThemeWorkspaceWriter,
    workspaceFiles: readonly ThemeWorkspaceFile[],
    update: "content-only" | "full",
    changedPaths: ReadonlySet<string>,
    loadBinary: ThemeWorkspaceBinaryLoader | undefined,
  ): Promise<StagedStart> {
    const staging = `${PREVIEW_START_STAGING_PREFIX}${crypto.randomUUID()}`;
    const toStaging = (path: string) => {
      if (path === WORKSPACE_ROOT) return staging;
      if (!path.startsWith(`${WORKSPACE_ROOT}/`)) {
        throw new Error(`PREVIEW_START_PATH_OUTSIDE_WORKSPACE: ${path}`);
      }
      return `${staging}${path.slice(WORKSPACE_ROOT.length)}`;
    };
    // Mapped writes only: without a way to list or delete, the materializer
    // leaves reconciliation to the prune list worked out below.
    const stagingWriter: ThemeWorkspaceWriter = {
      mkdir: (path, options) => writer.mkdir(toStaging(path), options),
      writeFile: (path, content) => writer.writeFile(toStaging(path), content),
    };

    try {
      if (update === "full") {
        let prune: string[] = [];
        if (session.listFiles) {
          const listed = await session.listFiles(WORKSPACE_ROOT, {
            recursive: true,
            includeHidden: true,
          });
          if (!listed.success) {
            // Deliberately fatal, as it was when the start wrote in place:
            // a workspace nobody can describe cannot be reconciled.
            throw new Error(
              "Could not list the existing Theme preview workspace.",
            );
          }
          prune = unplannedWorkspaceFiles(listed.files, workspaceFiles).map(
            workspaceRelative,
          );
        }
        await materializeThemeSandboxWorkspace(stagingWriter, workspaceFiles, {
          loadBinary,
        });
        return {
          staging,
          files: workspaceFiles.map((file) => workspaceRelative(file.path)),
          prune,
        };
      }

      await writer.mkdir(staging, { recursive: true });
      const files: string[] = [];
      for (const file of workspaceFiles) {
        if (!changedPaths.has(file.path)) continue;
        // A content-only change touches the content data files alone,
        // which are text; any other change takes the full write.
        if (isBinaryWorkspaceFile(file)) continue;
        const target = toStaging(file.path);
        await writer.mkdir(target.slice(0, target.lastIndexOf("/")), {
          recursive: true,
        });
        await stagingWriter.writeFile(file.path, file.content);
        files.push(workspaceRelative(file.path));
      }
      return { staging, files, prune: [] };
    } catch (error) {
      // Any failure clears its own staging, and only that (user,
      // 2026-11-24), except a start the preview's stop refused: the stop
      // destroyed the container and its /tmp with it, and a call would only
      // wake it. The same holds once the container failed to start: a call
      // would start a new one (`isContainerStartFailure`).
      if (
        !(
          error instanceof PreviewStartNotCurrentError &&
          error.refusal.stage === NOT_CURRENT_START.stopped.stage
        ) &&
        !isContainerStartFailure(error)
      ) {
        await this.discardStaging(session, staging);
      }
      throw error;
    }
  }

  /** Best effort: `/tmp` is cleared with the container anyway. */
  private async discardStaging(
    session: PreviewServerSession,
    staging: string | null,
  ): Promise<void> {
    if (!staging) return;
    await session.exec(`rm -rf ${staging}`).catch(() => undefined);
  }

  private async startObserved(
    input: StartPreviewServerInput,
    observation: StartObservation,
    limits: Readonly<{
      readyTimeoutMs: number;
      /**
       * Asked before each container step that changes the container
       * (staging writes, toolchain link, fence, expose, lifecycle, stale
       * server stop, content stamp, dev server start). Throws
       * `PreviewStartNotCurrentError` to stop the start there.
       */
      beforeContainerStep?: () => Promise<void>;
      /**
       * This attempt's claim on the workspace (user, 2026-11-24): registered
       * in the fence ledger before the first workspace step, carried by the
       * fence, required for the shared marker, the content stamp and the
       * dev server launch. Absent for an unguarded start.
       */
      claim?: PreviewStartClaim;
      /**
       * The sandbox handle this start already reached for to claim the
       * preview (first attempt only), so it is not acquired a second time.
       * A rejected one fails this attempt as its own acquire would.
       */
      acquired?: Promise<AcquiredPreviewSession>;
    }>,
  ): Promise<StartPreviewServerResult> {
    const beforeContainerStep =
      limits.beforeContainerStep ?? (async () => undefined);
    const claim = limits.claim;
    /**
     * For the fail-closed marker: false once the Durable Object has said
     * another start owns the workspace or the preview was stopped
     * (`refusalLeavesWorkspace`); then nothing shared is attempted.
     */
    const stillCurrent = () =>
      beforeContainerStep().then(
        () => true,
        (error: unknown) =>
          !(
            error instanceof PreviewStartNotCurrentError &&
            refusalLeavesWorkspace(error.refusal)
          ),
      );
    /** The answer of an attempt the fence ledger no longer names as owner. */
    const notOwner = (
      standing: Exclude<PreviewClaimStanding, "owner">,
    ): { stage: string; errorMessage: string } => {
      observation.ledger = standing;
      return standing === "superseded"
        ? NOT_CURRENT_START.superseded
        : NOT_CURRENT_START.unconfirmed;
    };
    const requestStartedAt = Date.now();
    const logs: string[] = [];
    const addLog = boundedPreviewLogAppender(logs, {
      maxLines: this.maxLogLines,
    });

    const prerequisites = resolveStartPrerequisites(input);
    if (!prerequisites.ok) {
      return {
        ok: false,
        stage: prerequisites.stage,
        errorMessage: prerequisites.errorMessage,
        logs,
      };
    }
    const { previewHost, framework } = prerequisites;
    // A framework's own dev server (`astro dev`), when its adapter names one;
    // otherwise Vite with the generated `vite.config.ts`.
    const devServer = framework.preview.devServer;
    // A Worker that names the content snapshot it reads on the address probe
    // serves this preview (Start's own, or a framework's dev server), so a
    // content sync can be written and confirmed here (docs/astro-theme-plan.md
    // 6.5, 6.6), as the local transport does.
    const confirmsContent = input.previewRuntime === "start" || Boolean(devServer);
    // A preview has no build record; it uses the registry's toolchain for its
    // framework, checked against the container's manifest before it starts.
    const toolchain = themeToolchainForFramework(framework.id);

    let session: PreviewServerSession | null = null;
    // This attempt's own staging directory, from when it is written until
    // the fence takes it (the fence removes it, applied or refused). A start
    // stopped in between clears it, and only it (user, 2026-11-24).
    let pendingStaging: string | null = null;
    /**
     * Writes the shared dirty marker, only while this start owns the
     * workspace (user, 2026-11-24). Guarded, the fence ledger decides it
     * under its lock (`op: "mark"`): "another-owner" when it names another
     * claim, "unproven" when it cannot say (or could not be asked), and
     * either way nothing shared was written. Unguarded, the marker is
     * written as before.
     */
    const markUntrusted = async (): Promise<
      "marked" | "another-owner" | "unproven"
    > => {
      // Every marker call's result is logged for its attempt: a failed or
      // refused write is not swallowed (round 3, formal 1c).
      const logMarker = (
        result: "marked" | "another-owner" | "unproven" | "write-failed",
        error?: unknown,
      ) =>
        logPreviewServerEvent("fail-closed-marker", {
          attemptId: observation.attemptId,
          previewId: input.previewId,
          guarded: Boolean(claim),
          result,
          ...(error === undefined
            ? {}
            : {
                error: (error instanceof Error
                  ? error.message
                  : String(error)
                ).slice(0, 200),
              }),
        });
      if (!claim) {
        try {
          await session!.writeFile(
            THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
            newDirtyWorkspaceMarker(),
          );
          logMarker("marked");
        } catch (error) {
          addLog("Could not mark the Live Preview workspace untrusted.");
          // The answer is unchanged (unguarded, as before); the line says
          // the marker was not written, and why.
          logMarker("write-failed", error);
        }
        return "marked";
      }
      try {
        const marked = await runFencedWriteInSandbox(
          session as unknown as FenceSandbox,
          {
            op: "mark",
            claim,
            marker: {
              path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
              content: newDirtyWorkspaceMarker(),
            },
          },
        );
        if (marked.ownership === "owner") {
          logMarker("marked");
          return "marked";
        }
        observation.ledger =
          marked.ownership === "superseded" ? "superseded" : "unknown";
        addLog(
          "The Live Preview workspace is no longer this start's; left unmarked.",
        );
        const standing =
          marked.ownership === "superseded" ? "another-owner" : "unproven";
        logMarker(standing);
        return standing;
      } catch (error) {
        addLog("Could not mark the Live Preview workspace untrusted.");
        logMarker("unproven", error);
        return "unproven";
      }
    };
    try {
      // The handle the claim was asked through, when this attempt was handed
      // one: a start reaches for its container once, whatever the answer.
      const acquired = await (limits.acquired ??
        this.acquireTimed(input.previewId));
      session = acquired.session;
      const sandboxHandleMs = acquired.ms;
      // A start that cannot finish leaves the workspace untrusted rather than
      // destroyed. The sandbox is shared by every tab of this preview, and
      // destroying it took down pages another request had just brought up.
      // The marker goes back to `dirty`, so the next start rebuilds the whole
      // workspace and restarts Vite instead of trusting what this one left,
      // but only while the workspace is still this start's: once another
      // start owns it, this one writes nothing shared and answers
      // superseded ("another-owner").
      const failClosed = async (
        reason: string,
      ): Promise<"marked" | "another-owner" | "unproven" | "left"> => {
        observation.failedClosed = reason;
        logPreviewServerEvent("fail-closed", {
          attemptId: observation.attemptId,
          previewId: input.previewId,
          reason,
        });
        // The Durable Object already says it is another start's, or that the
        // preview was stopped: nothing shared is attempted.
        if (!(await stillCurrent())) return "left";
        return markUntrusted();
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
        mkdir: async (path, options) => {
          await beforeContainerStep();
          return recordFilesystemCall(
            () => session!.mkdir(path, options),
            "mkdir",
          );
        },
        writeFile: async (path, content) => {
          await beforeContainerStep();
          return recordFilesystemCall(
            () => writeSandboxWorkspaceFile(session!, path, content),
            "write",
          );
        },
        ...(session.listFiles
          ? { listFiles: (path, options) => session!.listFiles!(path, options) }
          : {}),
        ...(session.deleteFile
          ? {
              deleteFile: async (path) => {
                await beforeContainerStep();
                return session!.deleteFile!(path);
              },
            }
          : {}),
      };

      const workspaceStartedAt = Date.now();
      const workspacePlanStartedAt = Date.now();
      // Before the first step that touches /workspace: from here on, a
      // newer start that registers its claim refuses every shared write of
      // this one under the fence's lock (user, 2026-11-24). An interruption
      // here is the fence's own, and may be retried.
      const registerClaim = async () => {
        if (!claim) return null;
        await beforeContainerStep();
        observation.step = "fence";
        const registered = await runFencedWriteInSandbox(
          session as unknown as FenceSandbox,
          { op: "claim", claim },
        );
        observation.step = undefined;
        return registered.ownership && registered.ownership !== "owner"
          ? notOwner(registered.ownership)
          : null;
      };

      const prepared = framework.planWorkspace({
        files: input.files,
        entry: input.entry,
        buildId: input.previewId,
        dependencies: input.dependencies,
        approvedDependencies: this.approvedDependencies,
        mode: "preview-server",
        previewContent: input.previewContent,
        previewRuntime: input.previewRuntime,
        toolchainRoot: toolchain.root,
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
      const unregistered = await registerClaim();
      if (unregistered) return { ok: false, ...unregistered, logs };

      // Checks the container's toolchain manifest (read only). The
      // workspace's link to it is made by the fence, by the owner only
      // (user, 2026-11-24): a start that no longer owns the workspace never
      // removes or replaces it.
      await beforeContainerStep();
      const toolchainReady = await prepareSandboxToolchain(
        session,
        toolchain,
        (_level, message) => addLog(message),
        { link: false },
      );
      if (!toolchainReady.ok) {
        return {
          ok: false,
          stage: "preview-toolchain",
          errorMessage: `${toolchainReady.code}: ${toolchainReady.message}`,
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
      // A committed marker is trusted only when the fence ledger vouches for
      // that very commit, with nothing written since (user, 2026-11-24).
      // Otherwise the workspace is laid out again, whatever the marker and
      // the manifest say. A dirty marker is not trusted anyway: the disk is
      // read back below.
      let markerVouched = false;
      if (
        existingWorkspaceFingerprint !== null &&
        !isDirtyWorkspaceMarker(existingWorkspaceFingerprint) &&
        session.readFile
      ) {
        try {
          const value = await recordFilesystemCall(
            () =>
              session!.readFile!(PREVIEW_FENCE_LEDGER_PATH, {
                encoding: "utf-8",
              }),
            "read",
          );
          markerVouched = fenceLedgerVouchesFor(
            typeof value === "string"
              ? value
              : typeof value.content === "string"
                ? value.content
                : null,
            existingWorkspaceFingerprint,
          );
        } catch {
          markerVouched = false;
        }
      }
      const trustedWorkspaceFingerprint = markerVouched
        ? existingWorkspaceFingerprint
        : null;
      const workspaceFingerprintReadMs =
        Date.now() - workspaceFingerprintReadStartedAt;
      const workspaceReused =
        trustedWorkspaceFingerprint === prepared.workspaceFingerprint;
      observation.workspace = {
        reused: workspaceReused,
        fingerprint: prepared.workspaceFingerprint.slice(0, 12),
        previous: shortMarker(existingWorkspaceFingerprint),
        ...(existingWorkspaceFingerprint !== null &&
        !isDirtyWorkspaceMarker(existingWorkspaceFingerprint) &&
        !markerVouched
          ? { unvouched: true }
          : {}),
      };

      // Process state answers a separate question: whether the matching (or
      // newly materialized) files already have a Vite server watching them.
      const processLookupStartedAt = Date.now();
      const running = await session.listProcesses?.().catch(() => []);
      const processLookupMs = Date.now() - processLookupStartedAt;
      const alreadyServing = (running ?? []).find(
        (process) =>
          isPreviewViteCommand(process.command) &&
          (process.status === "running" || process.status === "starting"),
      );

      let workspaceMaterializeMs = 0;
      let workspaceUpdate: "none" | "content-only" | "full" = workspaceReused
        ? "none"
        : "full";
      let stagedStart: StagedStart = { staging: null, files: [], prune: [] };
      let startCommit: {
        marker: string;
        manifest: { path: string; content: string };
      } | null = null;
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
          if (trustedWorkspaceFingerprint !== null && session.readFile) {
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
            trustedWorkspaceFingerprint !== null &&
            previousManifest.fingerprint === trustedWorkspaceFingerprint;
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

        // The files are staged, not written: where they land, and whether
        // they land at all, is decided in the container under the lock every
        // sync takes, together with the version check (below).
        const workspaceMaterializeStartedAt = Date.now();
        if (workspaceUpdate !== "none") {
          // One of the start's own steps: an interruption here may be
          // retried (preview-start-retry.ts).
          observation.step = "stage";
          stagedStart = await this.stageStart(
            session,
            measuredWriter,
            prepared.workspaceFiles,
            workspaceUpdate,
            new Set(change.paths),
            input.loadBinary,
          );
          pendingStaging = stagedStart.staging;
          observation.step = undefined;
        }
        workspaceMaterializeMs = Date.now() - workspaceMaterializeStartedAt;
        startCommit = {
          marker: prepared.workspaceFingerprint,
          manifest: {
            path: THEME_PREVIEW_WORKSPACE_MANIFEST_PATH,
            content: serializeWorkspaceManifest(
              prepared.workspaceFingerprint,
              nextDigests,
            ),
          },
        };
      }
      observation.workspace.update = workspaceUpdate;

      // One step in the container, under the lock every sync takes: judge
      // this start's versions against what has been written, and only then
      // lay out its files, record its versions and — if no other writer has
      // marked the workspace since it read the marker — commit the manifest
      // and the marker. A start read before a newer save is refused whole
      // and leaves the workspace as it was, whichever of the two arrived
      // first. Equal versions pass: the later write wins, as for a sync.
      await beforeContainerStep();
      observation.step = "fence";
      const applied = await runFencedWriteInSandbox(
        session as unknown as FenceSandbox,
        {
          op: "start",
          root: "/workspace",
          staging: stagedStart.staging,
          files: stagedStart.files,
          prune: stagedStart.prune,
          versions: input.fileVersions ?? {},
          generation: input.sourceGeneration ?? null,
          marker: {
            path: THEME_PREVIEW_WORKSPACE_FINGERPRINT_PATH,
            dirty: newDirtyWorkspaceMarker(),
            expected: existingWorkspaceFingerprint,
          },
          commit: startCommit,
          // Registered as the owner in the same locked step that lays the
          // files out; refused whole, writing nothing, once a higher claim
          // is registered.
          ...(claim ? { claim } : {}),
          // The toolchain link, made in that same step (rm + ln before).
          link: {
            path: "node_modules",
            target: `${toolchain.root}/node_modules`,
          },
          // Content syncs reach a preview whose Worker reads the snapshot
          // (6.5), so only there is a newer snapshot kept and the server
          // stamped.
          ...(confirmsContent
            ? {
                content: {
                  path: THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
                  instancePath: PREVIEW_INSTANCE_PATH,
                },
              }
            : {}),
        },
      ).catch(async (error: unknown) => {
        pendingStaging = null;
        // Not after a container that failed to start: its /tmp is gone, and
        // the call would start another container.
        if (!isContainerStartFailure(error)) {
          await this.discardStaging(session!, stagedStart.staging);
        }
        throw error;
      });
      pendingStaging = null;
      observation.step = undefined;
      if (applied.ownership !== undefined && applied.ownership !== "owner") {
        // Another start owns the workspace (or none can be proven): this one
        // wrote nothing, and its staging is gone with the request.
        return { ok: false, ...notOwner(applied.ownership), logs };
      }
      if (applied.staleGeneration) {
        observation.workspace.refused = applied.refused.length;
        return {
          ok: false,
          stage: "preview-start-stale",
          errorMessage: `PREVIEW_START_STALE: the workspace was already laid out from source generation ${applied.staleGeneration.laidOut}; this start was read at ${applied.staleGeneration.generation}.`,
          logs,
        };
      }
      if (applied.refused.length > 0) {
        observation.workspace.refused = applied.refused.length;
        return {
          ok: false,
          stage: "preview-start-stale",
          errorMessage: `PREVIEW_START_STALE: a newer version of ${applied.refused
            .slice(0, 3)
            .join(
              ", ",
            )}${applied.refused.length > 3 ? ", …" : ""} is already laid out.`,
          logs,
        };
      }
      if (!workspaceReused) {
        observation.workspace.committed = applied.committed === true;
        if (!observation.workspace.committed) {
          addLog(
            "Another writer marked the Live Preview workspace; not committing.",
          );
        }
      }
      // Which bridge is on disk is known only for a workspace this start
      // committed, or one whose marker already named this plan. The container's
      // Vite names no instance on its responses, so the instance stays unknown.
      const servingBridge =
        workspaceReused || applied.committed === true
          ? (prepared.previewBridge ?? null)
          : null;
      const serving: PreviewServing | null = servingBridge
        ? { bridge: servingBridge, instance: null }
        : null;
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
        await beforeContainerStep();
        const exposePortStartedAt = Date.now();
        const exposed = await session.exposePort(THEME_PREVIEW_SERVER_PORT, {
          hostname: previewHost,
          name: "live-preview",
        });
        exposePortMs = Date.now() - exposePortStartedAt;
        exposedUrl = exposed.url;
      }
      const previewUrl = withPreviewServerBase(
        exposedUrl,
        framework,
        input.previewRuntime,
      );
      observation.address = {
        reused: Boolean(activePort),
        digest: previewAddressDigest(exposedUrl),
      };

      if (session.setSleepAfter) await beforeContainerStep();
      const configureLifecycleStartedAt = Date.now();
      if (session.setSleepAfter) {
        await session.setSleepAfter(this.sleepAfter);
      }
      const configureLifecycleMs = Date.now() - configureLifecycleStartedAt;

      // The live Sandbox API does not guarantee that background-process
      // output callbacks are delivered while this Worker request is waiting.
      // The process object does provide a process-aware port check, which is
      // also the thing we actually need to know: can this Vite process serve
      // the page? Keep the output marker only for older providers and tests.
      // Null when the process has no port check.
      const waitUntilServing = (
        server: PreviewServerProcess,
      ): Promise<"ready" | "exited"> | null =>
        server.waitForPort
          ? server
              .waitForPort(THEME_PREVIEW_SERVER_PORT, {
                // Readiness is platform-owned and never runs a Theme loader.
                // A Worker-served preview (Start's, or a framework's own dev
                // server) answers the address probe itself.
                path:
                  input.previewRuntime === "start" || devServer
                    ? START_PREVIEW_ADDRESS_PROBE_PATH
                    : THEME_PREVIEW_SERVER_BASE_PATH,
              })
              .then(() => "ready" as const)
              .catch((error: unknown) => {
                addLog(
                  error instanceof Error
                    ? error.message
                    : "Preview server port check failed.",
                );
                return "exited" as const;
              })
          : null;
      const notReadyMessage = (outcome: "exited" | "timeout") =>
        outcome === "timeout"
          ? `PREVIEW_SERVER_TIMEOUT: Vite did not report itself ready within ${limits.readyTimeoutMs}ms.`
          : "PREVIEW_SERVER_EXITED: Vite exited before it was ready to serve.";

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
        // Listed is not serving: another start's server may still be
        // booting (two-tab race, 2026-11-24, where the frame got "Container
        // is not listening"). Wait for the launch path's own port check,
        // within the same limit. A session that cannot hand the process
        // back (older providers) is answered at once, as before.
        const reuseWaitStartedAt = Date.now();
        let reusedWaited = false;
        const listed =
          alreadyServing.id && session.getProcess
            ? await session.getProcess(alreadyServing.id).catch(
                (error: unknown) => {
                  addLog(
                    error instanceof Error
                      ? error.message
                      : "Preview server process lookup failed.",
                  );
                  return null;
                },
              )
            : undefined;
        const portCheck = listed ? waitUntilServing(listed) : null;
        if (listed === null || portCheck) {
          reusedWaited = true;
          const reusedOutcome = portCheck
            ? await withReadyTimeout(portCheck, limits.readyTimeoutMs)
            : ("exited" as const);
          if (reusedOutcome !== "ready") {
            const closed = await failClosed(`vite-${reusedOutcome}`);
            if (closed === "another-owner") {
              return { ok: false, ...NOT_CURRENT_START.superseded, logs };
            }
            // Not this start's process: it is never killed here.
            return {
              ok: false,
              stage: "preview-server-start",
              errorMessage: notReadyMessage(reusedOutcome),
              logs,
            };
          }
        }
        const reusedReadyMs = reusedWaited
          ? Date.now() - reuseWaitStartedAt
          : 0;
        const totalMs = Date.now() - requestStartedAt;
        return {
          ok: true,
          url: previewUrl,
          processId: alreadyServing.id,
          readyMs: reusedReadyMs,
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
            viteReadyMs: reusedReadyMs,
            reusedProcess: true,
          },
          hoistedContentFields: prepared.hoistedContentFields,
          warnings: prepared.previewWarnings,
          logs,
          serving,
        };
      }

      if (alreadyServing) {
        if (!session.killProcess) {
          if ((await failClosed("restart-unavailable")) === "another-owner") {
            return { ok: false, ...NOT_CURRENT_START.superseded, logs };
          }
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
          isPreviewViteCommand(process.command) &&
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
          await beforeContainerStep();
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
            if (
              (await failClosed("stale-vite-did-not-stop")) === "another-owner"
            ) {
              return { ok: false, ...NOT_CURRENT_START.superseded, logs };
            }
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
        ...(this.requestTrace ? { requestTrace: true as const } : {}),
      };
      // Stamped before the server starts, so its Worker names this server
      // and no earlier one on the address probe (docs/astro-theme-plan.md
      // 6.6); kept in /tmp, which a restarted container does not keep. Only
      // a preview whose Worker reads the snapshot takes content syncs to
      // confirm.
      if (confirmsContent) {
        await beforeContainerStep();
        const stamped = await runPreviewContentRequestInSandbox(
          session as unknown as FenceSandbox,
          {
            op: "stamp",
            path: `${prepared.workspaceRoot}/${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}`,
            instancePath: PREVIEW_INSTANCE_PATH,
            instance: crypto.randomUUID(),
            // Stamped only while this claim owns the workspace.
            ...(claim ? { claim } : {}),
          },
        );
        if (stamped.outcome === "not-owner") {
          return { ok: false, ...notOwner("superseded"), logs };
        }
      }
      await beforeContainerStep();
      // A strict port so the server cannot quietly land on another one and
      // leave the exposed URL pointing at nothing (`--strictPort` for
      // Vite; the Astro wrapper config sets `server.strictPort`).
      const devServerCommand = devServer
        ? `${toolchain.root}/node_modules/.bin/astro dev --config ${devServer.configPath} --host 0.0.0.0 --port ${THEME_PREVIEW_SERVER_PORT}`
        : `${toolchain.root}/node_modules/.bin/vite --config ${prepared.workspaceRoot}/vite.config.ts --host 0.0.0.0 --port ${THEME_PREVIEW_SERVER_PORT} --strictPort`;
      // Guarded, the dev server is launched through the serve gate (user,
      // 2026-11-24): one shell runs the fence script, which reads the ledger
      // under the lock, and execs the dev server only if this claim is
      // still the owner. Check and launch are one step in the container: a
      // newer start that registers before the gate refuses this launch, and
      // one that registers after it finds this server running and replaces
      // or reuses it as its own. A refused gate exits, and the exit below
      // answers it.
      const launchCommand = claim
        ? gatedServeCommand(
            await writePreviewServeGate(
              session as unknown as FenceSandbox,
              claim,
            ),
            devServerCommand,
          )
        : devServerCommand;
      const process = await session.startProcess(
        launchCommand,
        {
          // Nothing from Morph's own environment. The preview holds no
          // credential, and its capability is the preview URL alone; a
          // framework's dev server gets only what its adapter declares.
          env: {
            NODE_ENV: "development",
            ...(this.requestTrace ? { [PREVIEW_REQUEST_TRACE_ENV]: "1" } : {}),
            ...devServer?.env,
          },
          ...(devServer ? { cwd: prepared.workspaceRoot } : {}),
          onOutput: (_stream, data) => {
            addLog(data);
            if (data.includes(READY_MARKER)) resolveLogOrExit("ready");
          },
          onExit: () => resolveLogOrExit("exited"),
        },
      );

      // The port check (`waitUntilServing`), or for older providers the
      // output marker.
      observation.vite.processId = process.id ?? null;
      const portReady = waitUntilServing(process);
      const outcome = await withReadyTimeout(
        portReady ? Promise.race([portReady, logOrExit]) : logOrExit,
        limits.readyTimeoutMs,
      );
      if (outcome !== "ready") {
        const closed = await failClosed(`vite-${outcome}`);
        if (closed === "another-owner") {
          // Another start owns the workspace now (or the gate refused this
          // launch): it decides what runs in the container. Its process is
          // left to it, nothing is marked, and the answer says so.
          return { ok: false, ...NOT_CURRENT_START.superseded, logs };
        }
        // This start's own process, by the id it was given: never one that
        // another request started.
        await session.killProcess?.(process.id).catch(() => {});
        return {
          ok: false,
          stage: "preview-server-start",
          errorMessage: notReadyMessage(outcome),
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
        serving,
      };
    } catch (error) {
      // No longer the current start: answered as such. Not a thrown step
      // failure, so never classified. Superseded or stopped, nothing more
      // is done in the container (no fail-closed marker over the newer
      // start's workspace, nothing that wakes a stopped one); refused for
      // its deadline or an unconfirmed check, the workspace is still this
      // start's, and is marked untrusted as after any failed start.
      if (error instanceof PreviewStartNotCurrentError) {
        observation.step = undefined;
        // Its own staging, unless the stop took the container (and its /tmp)
        // away: a call would only wake it.
        if (session && error.refusal.stage !== NOT_CURRENT_START.stopped.stage) {
          await this.discardStaging(session, pendingStaging);
        }
        if (session && !refusalLeavesWorkspace(error.refusal)) {
          observation.failedClosed = "start-not-current";
          logPreviewServerEvent("fail-closed", {
            attemptId: observation.attemptId,
            previewId: input.previewId,
            reason: "start-not-current",
            stage: error.refusal.stage,
          });
          if ((await markUntrusted()) === "another-owner") {
            return { ok: false, ...NOT_CURRENT_START.superseded, logs };
          }
        }
        return { ok: false, ...error.refusal, logs };
      }
      const thrown = {
        message: error instanceof Error ? error.message : String(error),
        step: observation.step ?? null,
      };
      observation.step = undefined;
      // The container failed to start: any call now would start another
      // one, holding nothing of this start (round 3, formal 1c). Its own
      // staging went with the old container's /tmp, and the next start
      // trusts a workspace only where the fence ledger proves a commit, so
      // neither the clean-up nor the marker is needed. The same once the
      // platform refused a container (`CONTAINER_ADMISSION_REFUSED`).
      const goneBecause = containerStartFailure(error);
      const containerGone = goneBecause !== null;
      if (session && !containerGone) {
        await this.discardStaging(session, pendingStaging);
      }
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
        if (containerGone) {
          logPreviewServerEvent("post-failure-container-call-skipped", {
            attemptId: observation.attemptId,
            previewId: input.previewId,
            reason: goneBecause,
            step: thrown.step,
            skipped: ["own-staging-clean-up", "fail-closed-marker"],
          });
        } else if (
          (await stillCurrent()) &&
          (await markUntrusted()) === "another-owner"
        ) {
          // Not this start's workspace any more: its failure is not the
          // preview's, and is never retried.
          return { ok: false, ...NOT_CURRENT_START.superseded, logs };
        }
      }
      // Kept with the step it came from: only the start's own steps may be
      // retried, and only by `start`, which reads it.
      observation.thrown = thrown;
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
          isPreviewViteCommand(process.command) &&
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
    // First, so a start still running (or pausing before its retry) learns
    // it was stopped and does not bring the container back.
    await session.endPreviewStarts?.().catch(() => {});
    await session.unexposePort?.(THEME_PREVIEW_SERVER_PORT).catch(() => {});
    await session.killProcess?.(processId).catch(() => {});
    await session.destroy();
  }
}
