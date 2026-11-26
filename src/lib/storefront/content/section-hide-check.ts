import {
  classifyHideCapability,
  createHideCapabilityAnalyzer,
  type HideCapabilityScope,
  type HideRefusalReason,
} from "@/lib/storefront/ast/theme-hide-capability";
import { THEME_HIDE_GUARD_VERSION } from "@/lib/storefront/ast/theme-hide-guard-version";
import type { B1SourceFile } from "@/lib/storefront/ast/theme-content-provenance";
import {
  PUBLISH_HIDDEN_SECTION_UNSUPPORTED,
  PUBLISH_HIDE_REBUILD_REQUIRED,
  SECTION_HIDE_UNSUPPORTED,
} from "@/lib/storefront/theme-write-errors";

export { PUBLISH_HIDDEN_SECTION_UNSUPPORTED, PUBLISH_HIDE_REBUILD_REQUIRED };

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

/**
 * The error a refused hide is raised as: `CODE: reason-code: message`, the
 * section-source refusal form a server function reads back with
 * `parseSectionSourceRefusal` and answers as `errors: { reason: [...] }`.
 */
export function sectionHideRefusal(
  reason: HideRefusalReason,
  message: string,
): Error {
  return new Error(`${SECTION_HIDE_UNSUPPORTED}: ${reason}: ${message}`);
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

/**
 * Publish side (M3 P4): every hidden section in the publication being
 * sealed, judged against the build's own source revision and the guard the
 * build carries, never against the workspace.
 *
 * - A hidden section the revision cannot hide is listed with its reason, and
 *   the publish is refused: it would show defaults or break the page.
 * - A hidden section the revision can hide, in a build made before the guard
 *   (or with another guard version), needs a rebuild: that artifact would
 *   still render it. Publishing never rebuilds on its own for this; the
 *   author is told and asks for it.
 * - A section the Starter's own `!isSectionHidden(...)` guard already hides
 *   needs no Morph guard, so an older build is fine for it.
 * - A hidden section the revision's source does not render at all is not
 *   shown either way and is left alone, as the editor leaves it.
 *
 * Release rollback and a failed publish's restore never come here: a
 * historical release keeps its own artifact and content.
 */
export type PublishHiddenSectionsDocument = Readonly<{
  /** How the author knows the document: "the page /about", "the layout". */
  label: string;
  templateType: string;
  templateRoutePath: string | null;
  document: DocumentVisibility;
}>;

export type PublishHiddenSectionProblem = Readonly<{
  label: string;
  sectionId: string;
  reason: HideRefusalReason | "rebuild-required";
  message: string;
  /**
   * Set when the item was refused without its source being judged
   * (`partitionPublishHiddenItems`): a CMS Page, or a Theme that is not
   * Start. Each has its own way out in the refusal.
   */
  refusedAs?: "page" | "framework";
}>;

export function findPublishHiddenSectionProblems(args: {
  files: readonly Readonly<{ path: string; content: string | null }>[];
  /** `buildHideGuardVersion` of the build being published. */
  buildGuardVersion: string | null;
  documents: readonly PublishHiddenSectionsDocument[];
  /**
   * Where the revision renders one section, on every route that serves its
   * template (`templateHideCallSites`): a call site; `null` for a legacy
   * shell; `"not-rendered"` for a route that does not render it; or why the
   * source cannot confirm it. No entry at all: no route serves the
   * template, so nothing can show the section.
   */
  resolveCallSites: (args: {
    templateType: string;
    templateRoutePath: string | null;
    sectionId: string;
  }) => ReadonlyArray<
    string | null | "not-rendered" | Readonly<{ unconfirmed: string }>
  >;
}): {
  unsupported: PublishHiddenSectionProblem[];
  rebuild: PublishHiddenSectionProblem[];
} {
  const unsupported: PublishHiddenSectionProblem[] = [];
  const rebuild: PublishHiddenSectionProblem[] = [];
  const hidden = args.documents.flatMap((entry) =>
    (entry.document?.sections ?? [])
      .filter((section) => section.enabled === false)
      .map((section) => ({ entry, sectionId: section.id })),
  );
  if (hidden.length === 0) return { unsupported, rebuild };
  const files = args.files.filter(
    (file): file is B1SourceFile => typeof file.content === "string",
  );
  const analyzer = createHideCapabilityAnalyzer(files);
  const guardCurrent = args.buildGuardVersion === THEME_HIDE_GUARD_VERSION;
  for (const { entry, sectionId } of hidden) {
    // Every route that serves the template renders the section; the first
    // one that cannot hide it decides.
    let refusal: PublishHiddenSectionProblem | null = null;
    let needsGuard = false;
    for (const callSitePath of args.resolveCallSites({
      templateType: entry.templateType,
      templateRoutePath: entry.templateRoutePath,
      sectionId,
    })) {
      if (callSitePath === "not-rendered") continue;
      if (callSitePath !== null && typeof callSitePath === "object") {
        refusal = {
          label: entry.label,
          sectionId,
          reason: "source-unconfirmed",
          message: callSitePath.unconfirmed,
        };
        break;
      }
      const capability = analyzer.classify({
        callSitePath,
        slot: sectionId,
        scope: entry.templateType === "layout" ? "layout" : "route",
      });
      if (capability.kind === "unsupported") {
        refusal = {
          label: entry.label,
          sectionId,
          reason: capability.reason,
          message: capability.message,
        };
        break;
      }
      if (capability.sites.some((site) => site.position !== "guarded")) {
        needsGuard = true;
      }
    }
    if (refusal) {
      unsupported.push(refusal);
    } else if (!guardCurrent && needsGuard) {
      rebuild.push({
        label: entry.label,
        sectionId,
        reason: "rebuild-required",
        message:
          "This build was made before Morph could hide this section, so it would still show.",
      });
    }
  }
  return { unsupported, rebuild };
}

/**
 * One item of the publication being sealed that carries a hidden section:
 * a Theme template, or a CMS Page.
 */
export type PublishHiddenItem = Readonly<{
  itemType: "template" | "page";
  /** How the author knows it: "the index page", `the Page "About" (/pages/about)`. */
  label: string;
  document: DocumentVisibility;
}>;

/** How the publish refusal names a recorded framework. */
function frameworkDisplayName(framework: string): string {
  return framework === "astro" ? "Astro" : framework;
}

/**
 * Publish side, before any source is read: the hidden sections of the
 * publication that `findPublishHiddenSectionProblems` cannot judge, refused
 * here so that no hidden section reaches a release unjudged (M3 Hide step 1).
 *
 * - On a Theme whose recorded framework is not Start (D3), every hidden
 *   section is refused, Pages included: the classifier reads Start source
 *   only, and nothing proves another framework omits a hidden section
 *   (Astro is M3b).
 * - On Start, a CMS Page's hidden section is refused (D4): Pages render
 *   through a dynamic route Morph cannot follow to a call site, which is why
 *   the Page write already refuses a new hide.
 *
 * Every other item with a hidden section is returned in `sourceChecked`, for
 * the source check. Items with nothing hidden are neither refused nor
 * returned, so they never change a publish.
 */
export function partitionPublishHiddenItems<T extends PublishHiddenItem>(args: {
  /** The Theme's recorded framework; NULL is Start (`designWritesUnavailableReason`). */
  framework: string | null | undefined;
  items: readonly T[];
}): { refused: PublishHiddenSectionProblem[]; sourceChecked: T[] } {
  const refused: PublishHiddenSectionProblem[] = [];
  const sourceChecked: T[] = [];
  const framework = args.framework ?? "tanstack-start";
  const start = framework === "tanstack-start";
  for (const item of args.items) {
    const hidden = (item.document?.sections ?? []).filter(
      (section) => section.enabled === false,
    );
    if (hidden.length === 0) continue;
    if (start && item.itemType === "template") {
      sourceChecked.push(item);
      continue;
    }
    for (const section of hidden) {
      refused.push(
        start
          ? {
              label: item.label,
              sectionId: section.id,
              reason: "no-call-site",
              message: PAGE_SECTION_HIDE_UNSUPPORTED_MESSAGE,
              refusedAs: "page",
            }
          : {
              label: item.label,
              sectionId: section.id,
              reason: "framework-not-supported",
              message: `Morph cannot hide sections on ${frameworkDisplayName(framework)} Themes yet`,
              refusedAs: "framework",
            },
      );
    }
  }
  return { refused, sourceChecked };
}

/** The refusal `publishTemplate` raises, or nothing when the publish may go. */
export function assertPublishHiddenSections(
  problems: ReturnType<typeof findPublishHiddenSectionProblems>,
): void {
  const list = (items: readonly PublishHiddenSectionProblem[]) =>
    items
      .map((item) => `"${item.sectionId}" on ${item.label} (${item.reason})`)
      .join("; ");
  if (problems.unsupported.length > 0) {
    // Each kind of refusal has its own way out, so each is said on its own.
    const framework = problems.unsupported.filter(
      (item) => item.refusedAs === "framework",
    );
    const pages = problems.unsupported.filter(
      (item) => item.refusedAs === "page",
    );
    const source = problems.unsupported.filter(
      (item) => item.refusedAs === undefined,
    );
    const sentences: string[] = [];
    if (framework.length > 0) {
      sentences.push(
        `${framework[0]!.message}, so the live site would still show these hidden sections with their default content: ${list(framework)}. Clear their hidden flag so they are shown again, then publish.`,
      );
    }
    if (pages.length > 0) {
      sentences.push(
        `Morph cannot hide a section of a Page yet, so the live site would still show these hidden sections with their default content: ${list(pages)}. Show them again on the Page, publish the Page, then publish the Theme again.`,
      );
    }
    if (source.length > 0) {
      sentences.push(
        `These hidden sections cannot be hidden by this Theme's code yet, so the live site would still show them or break: ${list(source)}. Show them again in Design, or change the code so Morph can hide them, then publish.`,
      );
    }
    throw new Error(
      `${PUBLISH_HIDDEN_SECTION_UNSUPPORTED}: ${sentences.join(" ")} The live site is unchanged.`,
    );
  }
  if (problems.rebuild.length > 0) {
    throw new Error(
      `${PUBLISH_HIDE_REBUILD_REQUIRED}: This build was made before Morph could hide sections, so it would still show ${list(problems.rebuild)}. Rebuild and publish to hide them; the live site is unchanged.`,
    );
  }
}
