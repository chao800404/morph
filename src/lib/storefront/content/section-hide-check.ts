import {
  classifyHideCapability,
  type HideCapabilityScope,
  type HideRefusalReason,
} from "@/lib/storefront/ast/theme-hide-capability";
import type { B1SourceFile } from "@/lib/storefront/ast/theme-content-provenance";
import { SECTION_HIDE_UNSUPPORTED } from "@/lib/storefront/theme-write-errors";

/**
 * The write-side half of M3 Hide: a section becomes hidden only where the
 * source proves Morph can then omit every place that reads it.
 *
 * Shared by every Document write that can hide a section, so they refuse the
 * same way with the same code. Only the transition to hidden is judged:
 * showing a section, keeping a hidden one hidden, and every other write are
 * never refused by it, and nothing that restores stored content (revision
 * restore, a failed publish's restore, a release rollback) calls it.
 */

type SectionVisibility = Readonly<{ id: string; enabled?: boolean }>;
type DocumentVisibility = Readonly<{
  sections?: readonly SectionVisibility[];
}> | null;

/** Sections `after` hides that `before` showed (or did not have). */
export function sectionsNewlyHidden(
  before: DocumentVisibility,
  after: DocumentVisibility,
): string[] {
  const hiddenBefore = new Set(
    (before?.sections ?? [])
      .filter((section) => section.enabled === false)
      .map((section) => section.id),
  );
  return (after?.sections ?? [])
    .filter(
      (section) => section.enabled === false && !hiddenBefore.has(section.id),
    )
    .map((section) => section.id);
}

/** The error a refused hide is raised as: `CODE:reason: message`. */
export function sectionHideRefusal(
  reason: HideRefusalReason,
  message: string,
): Error {
  return new Error(`${SECTION_HIDE_UNSUPPORTED}:${reason}: ${message}`);
}

/** Reads a refusal back out of an error message, for the server function. */
export function readSectionHideRefusal(
  message: string,
): Readonly<{ reason: string; message: string }> | null {
  const at = message.indexOf(`${SECTION_HIDE_UNSUPPORTED}:`);
  if (at < 0) return null;
  const rest = message.slice(at + SECTION_HIDE_UNSUPPORTED.length + 1);
  const colon = rest.indexOf(": ");
  if (colon < 0) return { reason: rest, message: "" };
  return { reason: rest.slice(0, colon), message: rest.slice(colon + 2) };
}

/**
 * Throws unless Morph can hide `slot` in this exact source snapshot. The
 * caller passes the files it read for the write and repeats its own
 * source-generation precondition when it writes, so the verdict belongs to
 * the generation that is written.
 */
export function assertSectionHideSupported(args: {
  files: readonly Readonly<{ path: string; content: string | null }>[];
  /** The route or layout file that renders the section, or null when none does. */
  callSitePath: string | null;
  slot: string;
  scope: HideCapabilityScope;
}): void {
  const capability = classifyHideCapability({
    files: args.files.filter(
      (file): file is B1SourceFile => typeof file.content === "string",
    ),
    callSitePath: args.callSitePath,
    slot: args.slot,
    scope: args.scope,
  });
  if (capability.kind === "unsupported") {
    const where = capability.at
      ? ` (${capability.at.file}${capability.at.line > 0 ? `:${capability.at.line}` : ""})`
      : "";
    throw sectionHideRefusal(
      capability.reason,
      `${capability.message}${where}`,
    );
  }
}

/**
 * A CMS Page's sections are rendered by a dynamic route Morph cannot follow
 * to one call site in the first version, so a Page section cannot be hidden
 * yet. Show stays allowed.
 */
export const PAGE_SECTION_HIDE_UNSUPPORTED_MESSAGE =
  "Morph cannot hide a section of a Page yet: Pages are rendered by a dynamic route, and Morph cannot confirm where it renders the section.";
