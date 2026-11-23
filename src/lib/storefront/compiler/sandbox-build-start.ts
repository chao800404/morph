/**
 * The start phase of a Sandbox build: getting a container that is ready,
 * before anything of the Theme is written to it or run in it.
 *
 * Only this phase is ever retried. The SDK starts a container on its first
 * operation, so the start is made explicit here: a probe that runs `true` in
 * the container. It has no effect of its own, so running it again is harmless
 * even if a lost response hid that it ran. The workspace is written only after
 * the probe succeeded; from then on nothing is retried, because a failure there
 * may come after an operation that did take effect.
 *
 * A retry is allowed only when all of these hold:
 * - the probe failed with a start failure the SDK reports structurally
 *   (`classifySandboxStartError`); an unrecognised error is not retried. The
 *   probe runs inside the Durable Object and returns those fields as a value
 *   (`SandboxStartProbeResult`), since a thrown error loses them over RPC;
 * - the failed attempt's container was destroyed, and that was confirmed
 *   within a bound, so two attempts never overlap;
 * - the build is still this run's to finish (`stillRunning`), checked after
 *   the wait, so a cancelled or reassigned build is not started again. It is
 *   asked once more after the probe answers, before the session is handed
 *   back, since a build can be cancelled while its container starts;
 * - the next attempt still starts inside the start phase's budget
 *   (`SANDBOX_START_BUDGET_MS`, from the start of the run). Destroys and waits
 *   are bounded by it too.
 *
 * The acquire and the probe are bounded by the same deadline, here and not
 * only by the SDK: a start RPC that never answers would otherwise hold the
 * build in `building` with no error (a local E2E run, 2026-11-23). Reaching
 * the deadline throws `SandboxStartTimeoutError`, which is not a recognised
 * start failure and so is not retried. What answers after it is never used:
 * a session acquired late is destroyed, and a probe answering late finds its
 * session already destroyed and the start already failed.
 *
 * Every attempt is the same build, with the same frozen input and the same
 * Sandbox id; attempts are told apart only by their number in the build log.
 * A failed start leaves no artifact, since artifacts are stored only after a
 * successful run. That is a statement about artifacts only: it says nothing
 * about processes or side effects inside a container whose start was reported
 * as failed.
 */

export type SandboxStartFailureKind = "container-unavailable" | "startup";

/**
 * A start failure the SDK reports in its structured fields, or null. Only the
 * error's `code` and `context` are read, never its message: a message that
 * merely reads like a start failure is not one.
 *
 * - `CONTAINER_UNAVAILABLE` with `context.retryable === true`: the platform
 *   had no capacity to admit the container and asks the caller to try again.
 * - `INTERNAL_ERROR` with `context.phase === "startup"`: the SDK's wrapper for
 *   any other failure while starting the container.
 */
export function classifySandboxStartError(
  error: unknown,
): SandboxStartFailureKind | null {
  if (!error || typeof error !== "object") return null;
  const { code, context } = error as { code?: unknown; context?: unknown };
  const fields =
    context && typeof context === "object"
      ? (context as Record<string, unknown>)
      : null;
  if (code === "CONTAINER_UNAVAILABLE" && fields?.retryable === true) {
    return "container-unavailable";
  }
  if (code === "INTERNAL_ERROR" && fields?.phase === "startup") {
    return "startup";
  }
  return null;
}

/**
 * The probe's answer, as the build Sandbox's Durable Object returns it
 * (`Sandbox.probeStart`, src/server/build-sandbox.ts).
 *
 * A value, not a thrown error, because an error thrown across Durable Object
 * RPC reaches the caller as a plain `Error` with only its message: the SDK's
 * `code` and `context` are gone, so `classifySandboxStartError` could never
 * match a real start failure from the caller's side. Measured in workerd
 * 2026-10-08. Only the fields the classifier reads are copied, all of them
 * primitives, so the value survives the RPC as it was.
 */
export type SandboxStartProbeResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      name: string;
      message: string;
      code: string | null;
      context: Readonly<{
        retryable?: boolean;
        phase?: string;
        reason?: string;
      }>;
    }>;

/** Run inside the Durable Object, where the SDK's error still has its fields. */
export function describeSandboxStartError(
  error: unknown,
): SandboxStartProbeResult {
  const fields =
    error && typeof error === "object"
      ? (error as { code?: unknown; context?: unknown })
      : {};
  const context =
    fields.context && typeof fields.context === "object"
      ? (fields.context as Record<string, unknown>)
      : {};
  return {
    ok: false,
    name: error instanceof Error ? error.name : "Error",
    message: messageOf(error),
    code: typeof fields.code === "string" ? fields.code : null,
    context: {
      ...(typeof context.retryable === "boolean"
        ? { retryable: context.retryable }
        : {}),
      ...(typeof context.phase === "string" ? { phase: context.phase } : {}),
      ...(typeof context.reason === "string" ? { reason: context.reason } : {}),
    },
  };
}

/**
 * The caller's side: a failed probe result as an error carrying the same
 * structured fields, for `startBuildSandbox` to classify and rethrow.
 */
export class SandboxStartProbeError extends Error {
  readonly code: string | null;
  readonly context: Extract<SandboxStartProbeResult, { ok: false }>["context"];

  constructor(result: Extract<SandboxStartProbeResult, { ok: false }>) {
    super(result.message);
    this.name = result.name;
    this.code = result.code;
    this.context = result.context;
  }
}

export const SANDBOX_START_MAX_RETRIES = 2;
/**
 * How long the start phase may take, counted from the start of the run:
 * probes, destroys and waits together. The build commands after it keep their
 * own bound, as they had before the start became a phase, so a slow or retried
 * start never shortens a build that would otherwise have finished.
 */
export const SANDBOX_START_BUDGET_MS = 90_000;
const DESTROY_TIMEOUT_MS = 30_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_JITTER_MS = 1_000;

export type SandboxStartOptions<Session> = Readonly<{
  /** A session for this build's Sandbox id; the container starts on first use. */
  acquire: () => Promise<Session>;
  /** The side-effect-free readiness probe. */
  probe: (session: Session) => Promise<unknown>;
  destroy: (session: Session) => Promise<void>;
  /** Whether the build is still this run's: still `building`. */
  stillRunning?: () => Promise<boolean>;
  /** Epoch ms after which no attempt is started. */
  deadline: number;
  log: (level: "info" | "warn" | "error", message: string) => void;
  maxRetries?: number;
  destroyTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}>;

/** The start step that did not answer in time. */
export type SandboxStartStage = "acquire" | "probe";

/**
 * The start phase reached its deadline inside one attempt's acquire or probe.
 * Its fields are the build's diagnostics: which step, which attempt, how long
 * the start phase had run, how long that step was allowed, and whether the
 * attempt's container was confirmed destroyed (null when no session was ever
 * handed over).
 */
export class SandboxStartTimeoutError extends Error {
  readonly code = "SANDBOX_START_TIMEOUT";
  readonly stage: SandboxStartStage;
  readonly attempt: number;
  readonly elapsedMs: number;
  readonly boundMs: number;
  readonly destroyConfirmed: boolean | null;

  constructor(
    fields: Readonly<{
      stage: SandboxStartStage;
      attempt: number;
      elapsedMs: number;
      boundMs: number;
      destroyConfirmed: boolean | null;
    }>,
  ) {
    super(
      `SANDBOX_START_TIMEOUT: the container's ${fields.stage} did not answer within ${fields.boundMs} ms (attempt ${fields.attempt}, ${fields.elapsedMs} ms into the start phase); a timeout is not retried.`,
    );
    this.name = "SandboxStartTimeoutError";
    this.stage = fields.stage;
    this.attempt = fields.attempt;
    this.elapsedMs = fields.elapsedMs;
    this.boundMs = fields.boundMs;
    this.destroyConfirmed = fields.destroyConfirmed;
  }
}

/** `within`'s own rejection, told apart from the work's. */
class BoundExceeded extends Error {}

async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new BoundExceeded(`did not finish within ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A session whose container answered the probe. Throws the last start error,
 * or the reason no further attempt was made, and in either case leaves no
 * container of its own running that it knows of: a session that failed to
 * start is destroyed before this returns or throws.
 */
export async function startBuildSandbox<Session>(
  options: SandboxStartOptions<Session>,
): Promise<Session> {
  const maxRetries = options.maxRetries ?? SANDBOX_START_MAX_RETRIES;
  const destroyTimeoutMs = options.destroyTimeoutMs ?? DESTROY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const random = options.random ?? Math.random;
  const attempts = maxRetries + 1;
  /** A destroy waits no longer than its own bound, nor past the deadline. */
  const destroyBound = () =>
    Math.max(1, Math.min(destroyTimeoutMs, options.deadline - now()));
  /** An acquire or probe waits no longer than the deadline. */
  const stepBound = () => Math.max(1, options.deadline - now());
  const startedAt = now();
  const timedOut = (
    stage: SandboxStartStage,
    attempt: number,
    boundMs: number,
    destroyConfirmed: boolean | null,
  ) => {
    const error = new SandboxStartTimeoutError({
      stage,
      attempt,
      elapsedMs: now() - startedAt,
      boundMs,
      destroyConfirmed,
    });
    options.log("error", error.message);
    return error;
  };

  for (let attempt = 1; ; attempt += 1) {
    options.log(
      "info",
      `Starting the Sandbox container (attempt ${attempt} of at most ${attempts})...`,
    );
    const acquireBound = stepBound();
    const acquiring = options.acquire();
    let session: Session;
    try {
      session = await within(acquiring, acquireBound);
    } catch (error) {
      if (!(error instanceof BoundExceeded)) throw error;
      // A session handed over after the start failed is nobody's: destroy it
      // when it comes, and never use it.
      acquiring.then(
        (late) => {
          within(options.destroy(late), destroyTimeoutMs).catch(() => {});
        },
        () => {},
      );
      throw timedOut("acquire", attempt, acquireBound, null);
    }
    let ready = false;
    const probeBound = stepBound();
    try {
      await within(options.probe(session), probeBound);
      ready = true;
    } catch (error) {
      if (error instanceof BoundExceeded) {
        // The deadline has passed, so this destroy keeps its own bound
        // rather than the deadline's: the start fails either way, and whether
        // its container is gone belongs in the diagnostics. A probe answering
        // after this is never awaited again.
        let destroyConfirmed = true;
        try {
          await within(options.destroy(session), destroyTimeoutMs);
        } catch (destroyError) {
          destroyConfirmed = false;
          options.log(
            "error",
            `The container of attempt ${attempt} could not be confirmed destroyed: ${messageOf(destroyError)}`,
          );
        }
        throw timedOut("probe", attempt, probeBound, destroyConfirmed);
      }
      const kind = classifySandboxStartError(error);
      // Destroyed before anything else, retry or not: a session that failed
      // to start is not handed back to anyone who would clean it up.
      let destroyed = true;
      try {
        await within(options.destroy(session), destroyBound());
      } catch (destroyError) {
        destroyed = false;
        options.log(
          "error",
          `The container of attempt ${attempt} could not be confirmed destroyed: ${messageOf(destroyError)}`,
        );
      }
      if (!kind) {
        options.log(
          "error",
          `Attempt ${attempt} failed with an error that is not a recognised start failure; not retrying: ${messageOf(error)}`,
        );
        throw error;
      }
      options.log(
        "warn",
        `Attempt ${attempt} failed to start the container (${kind}): ${messageOf(error)}`,
      );
      if (!destroyed) {
        throw new Error(
          `SANDBOX_START_FAILED: the container did not start, and its attempt could not be confirmed destroyed, so no new attempt was made: ${messageOf(error)}`,
          { cause: error },
        );
      }
      if (attempt >= attempts) throw error;

      const delay =
        BACKOFF_BASE_MS * attempt + Math.floor(random() * BACKOFF_JITTER_MS);
      if (now() + delay >= options.deadline) {
        throw new Error(
          `SANDBOX_START_FAILED: the container did not start, and the build's deadline leaves no time for another attempt: ${messageOf(error)}`,
          { cause: error },
        );
      }
      await sleep(delay);
      if (options.stillRunning && !(await options.stillRunning())) {
        throw new Error(
          "SANDBOX_START_ABANDONED: the build is no longer running (cancelled or taken over), so the container was not started again.",
          { cause: error },
        );
      }
      if (now() >= options.deadline) {
        throw new Error(
          `SANDBOX_START_FAILED: the build's deadline passed while waiting to start the container again: ${messageOf(error)}`,
          { cause: error },
        );
      }
    }
    if (ready) {
      // Asked again before anything is written: the build may have been
      // cancelled or taken over while its container was starting.
      if (options.stillRunning && !(await options.stillRunning())) {
        try {
          await within(options.destroy(session), destroyBound());
        } catch (destroyError) {
          options.log(
            "error",
            `The container of attempt ${attempt} could not be confirmed destroyed: ${messageOf(destroyError)}`,
          );
        }
        throw new Error(
          "SANDBOX_START_ABANDONED: the build is no longer running (cancelled or taken over), so nothing was written to its container.",
        );
      }
      return session;
    }
  }
}
