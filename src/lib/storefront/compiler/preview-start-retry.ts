import type {
  PreviewStartRetrySignal,
  PreviewStartRetryStep,
} from "../editor/preview-start-recovery";

/**
 * Which failed preview starts are run once more (preview auto-retry v2, §1).
 *
 * Durable Object RPC keeps only an error's message: the SDK's class name
 * arrives folded in front of it, and its `code` and `context` are gone
 * (`sandbox-build-start.ts`; memory "RPC errors lose fields"). So this reads
 * the message, and reads it narrowly:
 *
 * - the whole sentence, anchored at both ends: "OperationInterruptedError:
 *   Sandbox operation <op> was interrupted while the runtime connection was
 *   closing" (PR #434's CI run 45039253723, start `63ddfd32`). Not a
 *   substring, not a prefix with anything after it;
 * - only when it was thrown by the start's own container steps: staging and
 *   materializing the workspace, or the fence script that lays it out.
 *
 * Everything else is final, each by decision: the container stopping while
 * an operation was pending (seen on the cleanup RPC, not the start path),
 * the sandbox being destroyed (someone stopped it), the platform updating
 * the runtime, a connection that closed unexpectedly, "Container failed to
 * start" (too broad; diagnosis first, user 2026-11-24), every timeout, and
 * any error this does not recognise.
 */
const RUNTIME_CONNECTION_CLOSING =
  /^OperationInterruptedError: Sandbox operation [A-Za-z0-9_.-]+ was interrupted while the runtime connection was closing$/;

export type ThrownStartError = Readonly<{
  message: string;
  /** The start step that was running when it was thrown; null for any other. */
  step: PreviewStartRetryStep | null;
}>;

/** The allow-listed signal a thrown start error carries, or null: not retried. */
export function classifyPreviewStartInterruption(
  thrown: ThrownStartError,
): PreviewStartRetrySignal | null {
  if (thrown.step !== "stage" && thrown.step !== "fence") return null;
  return RUNTIME_CONNECTION_CLOSING.test(thrown.message)
    ? "runtime-connection-closing"
    : null;
}
