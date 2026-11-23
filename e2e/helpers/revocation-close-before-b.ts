/**
 * M1 acceptance 1c: what a preview socket's close before b means.
 *
 * R happens somewhere in [a, b]: a is taken just before the trigger is sent
 * and b just after its answer arrives. Every socket must be live just before
 * a (H2) and still open at b; a close before b means the case could not
 * measure what it claims, and is a harness error.
 *
 * One exception, for sign-out only. Sign-out revokes and closes the
 * session's preview sockets while it handles the request, so the 4401 close
 * can reach the page before the answer reaches the test (attempt 1 on
 * de714e5: 1 ms before b). That close is the very event being measured, not
 * a broken measurement, and is accepted when ALL of these hold:
 *   1. the same socket was live before a (H2: an echo or a container receipt
 *      within LIVE_BEFORE_MS before a);
 *   2. the sign-out answered ok (2xx);
 *   3. that socket's close has status 4401;
 *   4. the close time is in [a, b).
 * It is recorded as `closedDuringRequest` with the raw close time, a and b.
 * Its close latency is the time within the request, close.t - a (<= b - a),
 * which is exactly what `judge` already computes as longestMs; every other
 * check (the 30 s and 37 s verdicts, HTTP refusals after b, the draft data
 * stop) runs unchanged.
 *
 * A close before a, a close with any other code, a close when the sign-out
 * did not answer ok, a close of a socket not live before a, and any close
 * before b in any other trigger stay harness errors.
 *
 * Pure, so the decision is unit-tested apart from the E2E run.
 */

export const SIGN_OUT_TRIGGER = "sign-out";
/** The preview socket relay's revocation close code. */
export const REVOKED_CLOSE_CODE = 4401;

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

/** Raw timestamps of an accepted close during the sign-out request. */
export interface ClosedDuringRequest {
  trigger: string;
  closedAt: number;
  closeCode: number;
  a: number;
  b: number;
  /** close.t - a: the close latency, within the request. */
  closeSinceAMs: number;
  /** b - close.t: how long before the answer arrived (> 0). */
  closeBeforeBMs: number;
  /** b - a. */
  windowMs: number;
}

export type CloseBeforeBDecision =
  | { outcome: "open-at-b" }
  | { outcome: "closed-during-request"; closedDuringRequest: ClosedDuringRequest }
  | { outcome: "harness-error"; error: string };

const isOk = (status: number | null) =>
  typeof status === "number" && status >= 200 && status < 300;

export function decideCloseBeforeB(
  input: CloseBeforeBInput,
): CloseBeforeBDecision {
  const { trigger, surface, a, b, liveBeforeA, triggerStatus, close } = input;
  if (!close || close.t >= b) return { outcome: "open-at-b" };
  if (
    trigger === SIGN_OUT_TRIGGER &&
    liveBeforeA &&
    isOk(triggerStatus) &&
    close.status === REVOKED_CLOSE_CODE &&
    close.t >= a
  ) {
    return {
      outcome: "closed-during-request",
      closedDuringRequest: {
        trigger,
        closedAt: close.t,
        closeCode: close.status,
        a,
        b,
        closeSinceAMs: close.t - a,
        closeBeforeBMs: b - close.t,
        windowMs: b - a,
      },
    };
  }
  const error = `${surface}: the socket closed before b (b${close.t - b} ms, code ${close.status})`;
  if (trigger !== SIGN_OUT_TRIGGER) return { outcome: "harness-error", error };
  const why = [
    !liveBeforeA && "not live before a",
    !isOk(triggerStatus) && `sign-out answered ${String(triggerStatus)}`,
    close.status !== REVOKED_CLOSE_CODE && `code not ${REVOKED_CLOSE_CODE}`,
    close.t < a && `closed before a (a${close.t - a} ms)`,
  ].filter(Boolean);
  return {
    outcome: "harness-error",
    error: `${error}; not a close during the sign-out request: ${why.join(", ")}`,
  };
}
