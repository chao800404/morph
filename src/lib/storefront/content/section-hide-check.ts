import {
  classifyHideCapability,
  createHideCapabilityAnalyzer,
  hideRefusalMessage,
  type HideCapabilityScope,
  type HideRefusalReason,
} from "@/lib/storefront/ast/theme-hide-capability";
import { THEME_HIDE_GUARD_VERSION } from "@/lib/storefront/ast/theme-hide-guard-version";
import type { B1SourceFile } from "@/lib/storefront/ast/theme-content-provenance";
import {
  PUBLISH_HIDDEN_SECTIONS_DETAIL_LIMIT,
  type PublishHiddenSectionDetail,
  type PublishHiddenSectionsDetails,
} from "@/lib/storefront/publish-hidden-sections-details";
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
 * - A hidden section no route is positively found to render (a route that
 *   does not name it, or no route serving the template) is refused: the
 *   route lookup reads only the route's own JSX, so an imported module may
 *   still render it (M3 Hide step 1, until the whole-Theme proof).
 *
 * Release rollback and a failed publish's restore never come here: a
 * historical release keeps its own artifact and content.
 */
/**
 * Which document of the publication a hidden section belongs to, carried
 * from the sealed publication item so a refusal can name it as data (M3
 * stage 1: the editor offers "Show again" on exactly that draft).
 */
export type PublishHiddenTarget = Readonly<{
  itemType: "template" | "page";
  /** The publication item's content id: the template id, or the Page id. */
  contentId: string;
  /** The template type the item was sealed under; `"page"` for a CMS Page. */
  templateType: string;
}>;

/**
 * What the author must publish once the section is shown again. A CMS Page
 * travels with a Theme publish at its published revision, so a Show again on
 * its draft goes live only after the Page itself is published; a template's
 * draft is what a Theme publish seals.
 */
export function mustPublishFor(
  itemType: PublishHiddenTarget["itemType"],
): "page" | "theme" {
  return itemType === "page" ? "page" : "theme";
}

export type PublishHiddenSectionsDocument = PublishHiddenTarget &
  Readonly<{
    /** How the author knows the document: "the page /about", "the layout". */
    label: string;
    templateRoutePath: string | null;
    document: DocumentVisibility;
  }>;

export type PublishHiddenSectionProblem = PublishHiddenTarget &
  Readonly<{
  label: string;
  sectionId: string;
  reason: HideRefusalReason | "rebuild-required";
  message: string;
  /**
   * Set when the refusal has its own way out: a CMS Page, or a Theme that
   * is not Start, refused without its source being judged
   * (`partitionPublishHiddenItems`); or a Start section no route is found
   * to render, which Design therefore does not list.
   */
  refusedAs?: "page" | "framework" | "unlisted";
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
    const callSites = args.resolveCallSites({
      templateType: entry.templateType,
      templateRoutePath: entry.templateRoutePath,
      sectionId,
    });
    // M3 Hide step 1: only a positive verdict publishes. A route that does
    // not name the section may still render it through an imported module
    // (the route lookup reads the route's own JSX only), and a template no
    // route is found to serve is not proven unrendered either; until the
    // whole-Theme proof (step 2) can show that nothing reads the slot, both
    // are refused rather than left alone.
    if (callSites.length === 0 || callSites.includes("not-rendered")) {
      refusal = {
        ...problemTarget(entry),
        sectionId,
        reason: "no-call-site",
        message: hideRefusalMessage("no-call-site"),
        refusedAs: "unlisted",
      };
    }
    for (const callSitePath of refusal ? [] : callSites) {
      if (callSitePath === "not-rendered") continue;
      if (callSitePath !== null && typeof callSitePath === "object") {
        refusal = {
          ...problemTarget(entry),
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
          ...problemTarget(entry),
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
        ...problemTarget(entry),
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
export type PublishHiddenItem = PublishHiddenTarget &
  Readonly<{
    /** How the author knows it: "the index page", `the Page "About" (/pages/about)`. */
    label: string;
    document: DocumentVisibility;
  }>;

/** The part of an item or document a problem names it by. */
function problemTarget(
  entry: PublishHiddenTarget & Readonly<{ label: string }>,
): PublishHiddenTarget & Readonly<{ label: string }> {
  return {
    itemType: entry.itemType,
    contentId: entry.contentId,
    templateType: entry.templateType,
    label: entry.label,
  };
}

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
              ...problemTarget(item),
              sectionId: section.id,
              reason: "no-call-site",
              message: PAGE_SECTION_HIDE_UNSUPPORTED_MESSAGE,
              refusedAs: "page",
            }
          : {
              ...problemTarget(item),
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

/**
 * The publish refusal for hidden sections, with the problems as data
 * (`details`) beside the message every caller already reads. The message is
 * unchanged, so a caller that reads only the message (or an RPC hop that
 * keeps only it) answers as before.
 */
export class PublishHiddenSectionsError extends Error {
  readonly details: PublishHiddenSectionsDetails;
  constructor(message: string, details: PublishHiddenSectionsDetails) {
    super(message);
    this.name = "PublishHiddenSectionsError";
    this.details = details;
  }
}

/**
 * The refusal's problems as `ServerFailure.details`: names only, never
 * section content, and at most `PUBLISH_HIDDEN_SECTIONS_DETAIL_LIMIT` of
 * them, with `truncated` saying when there were more.
 */
export function publishHiddenSectionsDetails(
  problems: readonly PublishHiddenSectionProblem[],
): PublishHiddenSectionsDetails {
  const listed: PublishHiddenSectionDetail[] = [];
  for (const problem of problems.slice(
    0,
    PUBLISH_HIDDEN_SECTIONS_DETAIL_LIMIT,
  )) {
    // Rebuild problems have their own refusal and never come here.
    if (problem.reason === "rebuild-required") continue;
    listed.push({
      itemType: problem.itemType,
      contentId: problem.contentId,
      templateType: problem.templateType,
      sectionId: problem.sectionId,
      reason: problem.reason,
      refusedAs: problem.refusedAs ?? "source",
      mustPublish: mustPublishFor(problem.itemType),
      label: problem.label,
    });
  }
  return {
    kind: "publish-hidden-sections",
    problems: listed,
    truncated: problems.length > PUBLISH_HIDDEN_SECTIONS_DETAIL_LIMIT,
  };
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
    const unlisted = problems.unsupported.filter(
      (item) => item.refusedAs === "unlisted",
    );
    const source = problems.unsupported.filter(
      (item) => item.refusedAs === undefined,
    );
    const sentences: string[] = [];
    if (framework.length > 0) {
      sentences.push(
        `${framework[0]!.message}, so it cannot confirm these hidden sections would be left out of the live site and will not publish them: ${list(framework)}. They cannot be shown again from the editor yet; contact support to show them again.`,
      );
    }
    if (pages.length > 0) {
      sentences.push(
        `Morph cannot hide a section of a Page yet, so it cannot confirm these hidden sections would be left out of the live site and will not publish them: ${list(pages)}. The Page editor cannot show a hidden section: if an earlier version of the Page shows it, restore that version as a draft from the Page's revisions, save the Page with Publish page on, then publish the Theme again; otherwise contact support.`,
      );
    }
    if (unlisted.length > 0) {
      sentences.push(
        `Morph cannot find where this Theme's code renders these hidden sections, so it cannot confirm they would be left out of the live site and will not publish them: ${list(unlisted)}. Design does not list a section the page's code does not render directly, so it cannot be shown again there: change the code so the page renders it directly, show it again in Design, then publish, or contact support.`,
      );
    }
    if (source.length > 0) {
      sentences.push(
        `Morph cannot confirm that this Theme's code leaves these hidden sections out of the live site, so it will not publish them: ${list(source)}. Show them again in Design, or change the code so Morph can hide them, then publish.`,
      );
    }
    throw new PublishHiddenSectionsError(
      `${PUBLISH_HIDDEN_SECTION_UNSUPPORTED}: ${sentences.join(" ")} The live site is unchanged.`,
      publishHiddenSectionsDetails(problems.unsupported),
    );
  }
  if (problems.rebuild.length > 0) {
    throw new Error(
      `${PUBLISH_HIDE_REBUILD_REQUIRED}: This build was made before Morph could hide sections, so it would still show ${list(problems.rebuild)}. Rebuild and publish to hide them; the live site is unchanged.`,
    );
  }
}
