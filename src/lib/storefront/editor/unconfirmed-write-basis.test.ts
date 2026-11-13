import { describe, expect, it } from "vitest";
import {
  basisFor,
  captureBasis,
  endBasis,
  releaseUnheldBasis,
  type UnconfirmedBases,
} from "./unconfirmed-write-basis";

/**
 * Task 41 R5: the copy an unanswered write was composed on, kept with the
 * write itself (its frozen entry), so a later read-back compares the lists
 * it changed with the copy it was made on, and nothing of another write's
 * copy is read or removed.
 */
describe("the copy an unanswered write was composed on", () => {
  const key = "template-1:hero";
  const first = { sent: "first" };
  const resent = { sent: "first, resent" };
  const newer = { sent: "newer" };
  const madeOn = { items: [{ id: "a" }] };
  const later = { items: [{ id: "a" }, { id: "b" }] };
  const fresh = (): UnconfirmedBases => new Map();

  it("is captured by a first send", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    expect(basisFor(bases, key, first)).toBe(madeOn);
  });

  it("is kept by a resend, whatever copy the resend sees", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    captureBasis(bases, key, resent, later, first);
    expect(basisFor(bases, key, resent)).toBe(madeOn);
    expect(basisFor(bases, key, first), "held by the resend now").toBe(
      undefined,
    );
  });

  it("is given to the write's landed record once, then let go", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    expect(endBasis(bases, key, first, "landed")).toBe(madeOn);
    expect(bases.has(key)).toBe(false);
  });

  it.each(["moved", "refused", "discarded"] as const)(
    "is let go when the write ends %s",
    (end) => {
      const bases = fresh();
      captureBasis(bases, key, first, madeOn);
      expect(endBasis(bases, key, first, end)).toBe(undefined);
      expect(bases.has(key)).toBe(false);
    },
  );

  it("is kept while the write is held again for a read-back", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    expect(endBasis(bases, key, first, "held-again")).toBe(undefined);
    expect(basisFor(bases, key, first)).toBe(madeOn);
  });

  it("of a newer write of the same key is never removed by an older write's end", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    // A newer write of the same key (a field reset) captures its own.
    captureBasis(bases, key, newer, later);
    for (const end of ["moved", "refused", "discarded", "landed"] as const) {
      expect(endBasis(bases, key, first, end)).toBe(undefined);
    }
    expect(basisFor(bases, key, newer)).toBe(later);
  });

  it("of an older write is never read as a newer write's", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    expect(basisFor(bases, key, newer)).toBe(undefined);
    captureBasis(bases, key, newer, later);
    expect(basisFor(bases, key, newer)).toBe(later);
  });

  it("is let go by a discard only when no write of the key is held", () => {
    const bases = fresh();
    captureBasis(bases, key, first, madeOn);
    releaseUnheldBasis(bases, key, first);
    expect(basisFor(bases, key, first), "still held: kept").toBe(madeOn);
    releaseUnheldBasis(bases, key, undefined);
    expect(bases.has(key)).toBe(false);
  });
});
