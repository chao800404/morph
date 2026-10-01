/**
 * Which sign-in verification a request was sent under.
 *
 * A request's answer can arrive long after it was sent — a save waits for its
 * formatter, a slow network holds an answer — and by then the author may have
 * signed in again and had that verified. A refusal of a request sent while
 * signed out says nothing new at that point: it is the state the verification
 * has already moved past. So every request is stamped, when it is actually
 * sent, with how many verifications this tab had begun by then, and the write
 * gate compares that stamp with the verification it is on (see
 * `pauseEditorWrites`).
 *
 * A count rather than a clock: two events in the same millisecond are still
 * ordered, and nothing depends on clocks agreeing.
 */
let verificationsBegun = 0;

/** How many verifications this tab has begun; the stamp for a request sent now. */
export function currentRequestStamp(): number {
  return verificationsBegun;
}

/** Begins a verification, and returns its number. */
export function beginVerificationStamp(): number {
  verificationsBegun += 1;
  return verificationsBegun;
}

const sentUnder = new WeakMap<object, number>();

/**
 * Records, on the error a request failed with, the stamp it was sent under.
 * The first stamp stands: an error rethrown further up is still the same
 * request's.
 */
export function stampRequestError(error: unknown, stamp: number): void {
  if (error && typeof error === "object" && !sentUnder.has(error)) {
    sentUnder.set(error, stamp);
  }
}

/** The stamp a failed request was sent under, when it was recorded. */
export function requestStampOf(error: unknown): number | undefined {
  return error && typeof error === "object" ? sentUnder.get(error) : undefined;
}
