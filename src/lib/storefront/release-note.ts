import type { Metadata } from "@/db/json";

/** Longest publish note stored on a release. */
export const MAX_RELEASE_NOTE_LENGTH = 120;

/** Key the note occupies inside a release's free-form metadata. */
const RELEASE_NOTE_KEY = "note";

/**
 * What a person wrote about why they published.
 *
 * A release is otherwise identified by an id fragment and a timestamp, which
 * says nothing about what changed — so choosing one to roll back to means
 * previewing them one by one. The note is the only part of a release a person
 * can recognise later, which is why it is kept even though nothing reads it at
 * runtime.
 *
 * Optional on purpose: making it required produces "update" and "fix", which
 * is the same non-information with more friction.
 */
export function normalizeReleaseNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_RELEASE_NOTE_LENGTH);
}

/** Reads the note from a release's metadata, if it carries one. */
export function readReleaseNote(
  metadata: Metadata | null | undefined,
): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  return normalizeReleaseNote(
    (metadata as Record<string, unknown>)[RELEASE_NOTE_KEY],
  );
}

/**
 * Returns metadata with the note set, or removed when there is no note.
 *
 * Existing keys are preserved: the column is shared free-form metadata, so
 * writing a note must not discard whatever else a release carries.
 */
export function withReleaseNote(
  metadata: Metadata | null | undefined,
  note: string | undefined,
): Metadata | null {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const normalized = normalizeReleaseNote(note);
  if (normalized) {
    base[RELEASE_NOTE_KEY] = normalized;
  } else {
    delete base[RELEASE_NOTE_KEY];
  }
  return Object.keys(base).length > 0 ? (base as Metadata) : null;
}
