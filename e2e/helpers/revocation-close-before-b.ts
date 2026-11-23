/**
 * M1 acceptance 1c: what a preview socket's close before b means.
 *
 * R happens somewhere in [a, b]: a is taken just before the trigger is sent
 * and b just after its answer arrives. Every socket must be live just before
 * a (H2) and still open at b; a close before b means the case could not
 * measure what it claims, and is a harness error.
 *
 * Pure, so the decision is unit-tested apart from the E2E run.
 */

export interface CloseBeforeBInput {
  trigger: string;
  surface: string;
  /** Taken just before the trigger was sent. */
  a: number;
  /** Taken just after the trigger's answer arrived. */
  b: number;
  /** H2: an echo or a container receipt within LIVE_BEFORE_MS before a. */
  liveBeforeA: boolean;
  /** The trigger's HTTP answer status, where it has one (sign-out). */
  triggerStatus: number | null;
  /** The page's first close event for this socket, if any. */
  close: { t: number; status: number } | null;
}

export type CloseBeforeBDecision =
  | { outcome: "open-at-b" }
  | { outcome: "harness-error"; error: string };

export function decideCloseBeforeB(
  input: CloseBeforeBInput,
): CloseBeforeBDecision {
  const { surface, b, close } = input;
  if (!close || close.t >= b) return { outcome: "open-at-b" };
  return {
    outcome: "harness-error",
    error: `${surface}: the socket closed before b (b${close.t - b} ms, code ${close.status})`,
  };
}
