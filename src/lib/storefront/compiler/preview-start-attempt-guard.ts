/**
 * Which Live Preview start is the current one, kept by the preview's own
 * Durable Object (`PreviewSandbox`) — preview auto-retry v2, §3.
 *
 * A start that the author stopped, that a newer start request for the same
 * preview superseded, or that ran out of its server-side deadline must never
 * be sent again, and its late success must never be answered as ready. The
 * editor cannot decide that: its `retry: false` and lifecycle reducer do not
 * reach a start already running on the server. So every start claims the
 * preview here, the retry asks before it is sent (and takes "current" over
 * from the attempt it retries), and every success asks before it is answered.
 *
 * Kept in the Durable Object's storage rather than its memory, so an evicted
 * object still answers the same. The Durable Object's input gate keeps each
 * read-then-write here from interleaving with another request's.
 */

export type PreviewStartAttemptStatus =
  | "current"
  | "superseded"
  | "stopped"
  | "expired";

/** The Durable Object storage this needs. */
export type PreviewStartAttemptStorage = Readonly<{
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}>;

export const PREVIEW_START_ATTEMPT_STORAGE_KEY = "morph:preview-start";

type PreviewStartAttemptRecord = Readonly<{
  attemptId: string | null;
  deadlineAt: number | null;
  stopped: boolean;
}>;

const NONE: PreviewStartAttemptRecord = {
  attemptId: null,
  deadlineAt: null,
  stopped: false,
};

/** An unreadable record names no current start. */
function parseRecord(value: unknown): PreviewStartAttemptRecord {
  if (!value || typeof value !== "object") return NONE;
  const record = value as Record<string, unknown>;
  if (record.stopped === true) {
    return { attemptId: null, deadlineAt: null, stopped: true };
  }
  if (
    typeof record.attemptId !== "string" ||
    typeof record.deadlineAt !== "number" ||
    !Number.isFinite(record.deadlineAt)
  ) {
    return NONE;
  }
  return {
    attemptId: record.attemptId,
    deadlineAt: record.deadlineAt,
    stopped: false,
  };
}

/** A new start request: it is the current one from now on. */
export async function claimPreviewStartAttempt(
  storage: PreviewStartAttemptStorage,
  input: Readonly<{ attemptId: string; deadlineAt: number }>,
): Promise<void> {
  await storage.put(PREVIEW_START_ATTEMPT_STORAGE_KEY, {
    attemptId: input.attemptId,
    deadlineAt: input.deadlineAt,
    stopped: false,
  } satisfies PreviewStartAttemptRecord);
}

/**
 * Whether `attemptId` is still the current start. With `next`, and only
 * when it is current and within its deadline, `next` becomes the current
 * start in its place, under the same deadline: the retry of the same
 * request, never a new budget.
 */
export async function checkPreviewStartAttempt(
  storage: PreviewStartAttemptStorage,
  input: Readonly<{ attemptId: string; next?: string }>,
  now: number,
): Promise<PreviewStartAttemptStatus> {
  const record = parseRecord(
    await storage.get(PREVIEW_START_ATTEMPT_STORAGE_KEY),
  );
  if (record.stopped) return "stopped";
  if (record.attemptId === null || record.attemptId !== input.attemptId) {
    return "superseded";
  }
  if (record.deadlineAt === null || now >= record.deadlineAt) return "expired";
  if (input.next && input.next !== record.attemptId) {
    await storage.put(PREVIEW_START_ATTEMPT_STORAGE_KEY, {
      ...record,
      attemptId: input.next,
    } satisfies PreviewStartAttemptRecord);
  }
  return "current";
}

/** The preview was stopped: no start is current until a new one claims it. */
export async function endPreviewStartAttempts(
  storage: PreviewStartAttemptStorage,
): Promise<void> {
  await storage.put(PREVIEW_START_ATTEMPT_STORAGE_KEY, {
    attemptId: null,
    deadlineAt: null,
    stopped: true,
  } satisfies PreviewStartAttemptRecord);
}
