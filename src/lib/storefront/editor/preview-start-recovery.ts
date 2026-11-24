/**
 * A Live Preview start that recovered: its first attempt was interrupted by
 * the sandbox, and the automatic retry (preview auto-retry v2,
 * handoff/2026-11-23/preview-autoretry-design-v2.md) answered instead.
 *
 * One module for the shape the server sends, how it is read, and how M1
 * acceptance reads it, so the server and the acceptance harness cannot
 * drift apart. The editor ignores it: the author sees a slower start.
 *
 * Acceptance never counts a recovered start as passed (design §5, memory
 * B1): the product recovered, and the evidence still says a container died.
 */

/**
 * The interruptions a start is retried on. Exactly one, by decision
 * (2026-11-23/24): the SDK's "Sandbox operation <op> was interrupted while
 * the runtime connection was closing". Adding one is a decision, not a fix.
 */
export const PREVIEW_START_RETRY_SIGNALS = ["runtime-connection-closing"] as const;
export type PreviewStartRetrySignal =
  (typeof PREVIEW_START_RETRY_SIGNALS)[number];

/** The start's own container steps a retry may follow. */
export const PREVIEW_START_RETRY_STEPS = ["stage", "fence"] as const;
export type PreviewStartRetryStep = (typeof PREVIEW_START_RETRY_STEPS)[number];

/** What a recovered start's answer says, in the browser: no error message. */
export type PreviewStartRecovery = Readonly<{
  stage: string;
  reason: "sandbox-interrupted";
  signal: PreviewStartRetrySignal;
  step: PreviewStartRetryStep;
  attempts: number;
  /** The server log line (`storefront.preview.start`) of the first attempt. */
  traceId: string;
}>;

export type PreviewStartRecoveryReading =
  | Readonly<{ recovered: false }>
  | Readonly<{
      recovered: true;
      recoveredFrom: PreviewStartRecovery;
      problem: null;
    }>
  | Readonly<{ recovered: true; recoveredFrom: null; problem: string }>;

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => typeof value === "string" && values.includes(value as T);

/**
 * Reads `recoveredFrom` off a start answer's data. Absent (or null) is a
 * clean start. Anything else present is a recovered start, readable or not:
 * a value this cannot read never turns a recovered start into a clean one.
 */
export function readPreviewStartRecovery(
  data: unknown,
): PreviewStartRecoveryReading {
  const value =
    data && typeof data === "object"
      ? (data as { recoveredFrom?: unknown }).recoveredFrom
      : undefined;
  if (value === undefined || value === null) return { recovered: false };
  if (typeof value !== "object") {
    return {
      recovered: true,
      recoveredFrom: null,
      problem: `recoveredFrom is a ${typeof value}`,
    };
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  if (!isOneOf(PREVIEW_START_RETRY_SIGNALS, record.signal)) {
    problems.push(
      record.signal === undefined
        ? "recoveredFrom.signal is missing"
        : "recoveredFrom.signal is not an allow-listed signal",
    );
  }
  if (record.reason !== "sandbox-interrupted") {
    problems.push("recoveredFrom.reason is not sandbox-interrupted");
  }
  if (!isOneOf(PREVIEW_START_RETRY_STEPS, record.step)) {
    problems.push("recoveredFrom.step is not a start step");
  }
  if (typeof record.stage !== "string") {
    problems.push("recoveredFrom.stage is missing");
  }
  if (typeof record.attempts !== "number") {
    problems.push("recoveredFrom.attempts is missing");
  }
  if (typeof record.traceId !== "string") {
    problems.push("recoveredFrom.traceId is missing");
  }
  if (problems.length > 0) {
    return { recovered: true, recoveredFrom: null, problem: problems.join("; ") };
  }
  return {
    recovered: true,
    recoveredFrom: {
      stage: record.stage as string,
      reason: "sandbox-interrupted",
      signal: record.signal as PreviewStartRetrySignal,
      step: record.step as PreviewStartRetryStep,
      attempts: record.attempts as number,
      traceId: record.traceId as string,
    },
    problem: null,
  };
}

/**
 * How M1 acceptance labels one observed start answer. Only
 * "ok/cloudflare-sandbox/start" passes. A recovered start never does, and
 * its label carries the trace id, the step and the class, and points at the
 * container diagnostics, so the failing run says where to look.
 */
export function previewStartAcceptanceLabel(start: {
  test: string;
  success: boolean | null;
  undecodable: string | null;
  kind: string | null;
  previewRuntime: string | null;
  /** Absent on a row recorded before the field existed: not recovered. */
  recovered?: boolean;
  recoveredFrom?: PreviewStartRecovery | null;
  recoveryProblem?: string | null;
}): string {
  if (start.success === null) {
    return `undecodable (${start.undecodable}) in ${start.test}`;
  }
  if (start.recovered === true) {
    const from = start.recoveredFrom;
    const detail = from
      ? `traceId ${from.traceId}, step ${from.step}, class ${from.reason}/${from.signal}, attempts ${from.attempts}`
      : `unreadable recoveredFrom: ${start.recoveryProblem ?? "unknown"}`;
    return `recovered (${detail}; a container was interrupted: see container-exit.ndjson when the run kept container diagnostics) in ${start.test}`;
  }
  return `${start.success ? "ok" : "failed"}/${start.kind}/${start.previewRuntime}`;
}
