import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";

/**
 * "Show again" (M3 stage 1): the one change it makes to a stored draft.
 *
 * Only `enabled: false` → `enabled: true` on the one section named, and
 * nothing else. The stored document is edited as stored, not as parsed:
 * parsing would fill defaults, trim strings, drop keys the schema does not
 * declare and give rows their in-memory ids (`normalizeDocumentRowIds`), and
 * every one of those would reach the draft as a change the author never
 * made. The section keeps its props, its ref, its name and its place; the
 * other sections are the same objects, untouched.
 *
 * A section that only exists as a route's virtual slot was never stored, so
 * it was never hidden either: only stored sections are looked at.
 *
 * - `not-found`: no stored section has that id, or more than one does (one
 *   named section, never a guess at which).
 * - `already-shown`: the section is stored and not hidden. Nothing to write.
 * - `shown`: the document to write.
 */
export type ShowSectionAgainOutcome =
  | Readonly<{ kind: "not-found"; reason: "missing" | "ambiguous" }>
  | Readonly<{ kind: "already-shown" }>
  | Readonly<{ kind: "shown"; document: StorefrontPageDocument }>;

export function showSectionAgainInDocument(
  stored: unknown,
  sectionId: string,
): ShowSectionAgainOutcome {
  const document =
    typeof stored === "string" ? (JSON.parse(stored) as unknown) : stored;
  const sections =
    document && typeof document === "object" && !Array.isArray(document)
      ? (document as { sections?: unknown }).sections
      : undefined;
  if (!Array.isArray(sections)) return { kind: "not-found", reason: "missing" };
  const matches = sections.flatMap((section, index) =>
    section &&
    typeof section === "object" &&
    (section as { id?: unknown }).id === sectionId
      ? [index]
      : [],
  );
  if (matches.length === 0) return { kind: "not-found", reason: "missing" };
  if (matches.length > 1) return { kind: "not-found", reason: "ambiguous" };
  const index = matches[0]!;
  const target = sections[index] as Record<string, unknown>;
  if (target.enabled !== false) return { kind: "already-shown" };

  // A fresh copy of the stored value, so nothing the caller still holds is
  // changed; the spread keeps the section's keys in their stored order.
  const next = structuredClone(document) as {
    sections: Record<string, unknown>[];
  };
  next.sections[index] = { ...next.sections[index], enabled: true };
  // The result must still be a document every reader accepts. A stored draft
  // that is not one is refused (as every reader refuses it), not repaired.
  storefrontPageDocumentSchema.parse(next);
  return { kind: "shown", document: next as unknown as StorefrontPageDocument };
}
