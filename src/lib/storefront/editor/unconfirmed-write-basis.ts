/**
 * The copy each unanswered content write was composed on, kept with that
 * write (Task 41 R4-1, R5).
 *
 * A write whose answer was lost is decided later by a read-back; when it is
 * found landed, the lists it changed are named as a saved change, compared
 * with the copy it was made on. That copy belongs to the write: it is held
 * under the write's own frozen entry (`owner`), carried across its resends,
 * and let go however the write ends. A newer write of the same key (a field
 * reset sent while an older write of the section is still unanswered) holds
 * its own copy; an older write's end never removes it, and a newer write
 * never reads an older write's copy.
 */

export type UnconfirmedBasis = Readonly<{
  /** The frozen entry of the write the copy belongs to. */
  owner: object;
  basis: Readonly<Record<string, unknown>>;
}>;

/** By pending-content key. */
export type UnconfirmedBases = Map<string, UnconfirmedBasis>;

/** How an unanswered write ended, or that it is held again for a read-back. */
export type UnconfirmedEnd =
  "landed" | "moved" | "refused" | "discarded" | "held-again";

/**
 * Held when a write goes unanswered. A first send holds the copy it was
 * composed on; a resend (`resendOf`, the frozen entry it resends) keeps the
 * first send's copy, now under the resend's entry, whatever copy it sees.
 */
export function captureBasis(
  bases: UnconfirmedBases,
  key: string,
  owner: object,
  basis: Readonly<Record<string, unknown>>,
  resendOf?: object,
): void {
  if (resendOf !== undefined) {
    const held = bases.get(key);
    if (held?.owner === resendOf) bases.set(key, { owner, basis: held.basis });
    return;
  }
  bases.set(key, { owner, basis });
}

/** The copy this write was composed on, if it holds one. */
export function basisFor(
  bases: UnconfirmedBases,
  key: string,
  owner: object,
): Readonly<Record<string, unknown>> | undefined {
  const held = bases.get(key);
  return held?.owner === owner ? held.basis : undefined;
}

/**
 * A write's end, for its copy: landed hands the copy to the record once and
 * lets it go; moved, refused or discarded let it go; held again keeps it.
 * Only the write's own copy is touched.
 */
export function endBasis(
  bases: UnconfirmedBases,
  key: string,
  owner: object,
  end: UnconfirmedEnd,
): Readonly<Record<string, unknown>> | undefined {
  const basis = basisFor(bases, key, owner);
  if (basis === undefined || end === "held-again") return undefined;
  bases.delete(key);
  return end === "landed" ? basis : undefined;
}

/**
 * A discard of the section's draft: a copy left by a write that is no
 * longer held goes; one of the write still held (`held`) stays.
 */
export function releaseUnheldBasis(
  bases: UnconfirmedBases,
  key: string,
  held: object | undefined,
): void {
  const entry = bases.get(key);
  if (entry && entry.owner !== held) bases.delete(key);
}
