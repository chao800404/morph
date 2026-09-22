import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  mergeDocumentWithRouteSections,
  type ThemeUnboundRouteSection,
  type ThemeRouteSection,
} from "@/lib/storefront/compiler/theme-route-sections";

/**
 * Which document stores a section's values.
 *
 * `page` sections belong to the route on the canvas. `shell` sections belong
 * to the layout every route renders inside, so an edit to one is an edit to
 * every page — and writing it into the page being looked at would make that
 * promise false the moment a second page was opened.
 */
export type EditorSectionOwner = "page" | "shell";

export type EditorSectionBinding = Readonly<{
  sectionId: string;
  templateId: string;
  owner: EditorSectionOwner;
}>;

export type EditorTemplateSnapshot = Readonly<{
  id: string;
  document: StorefrontPageDocument;
}>;

/**
 * An unbound candidate plus the document that binding it would write to.
 *
 * The same `owner` the bound sections carry, because the question is the same
 * one: a shell candidate renders on every page, so the bind lands in the layout
 * rather than in the route being looked at. Without this the list showed both
 * kinds identically, and the only way to learn that a click would change every
 * page was to make it.
 */
export type EditorUnboundSection = ThemeUnboundRouteSection &
  Readonly<{ owner: EditorSectionOwner }>;

export type EditorSectionModel = Readonly<{
  /**
   * The document the canvas renders and the panels read.
   *
   * One document because the page really is one page: the shell wraps the
   * route, and an editor that presented them as two lists would have to
   * explain which one a click landed in.
   */
  document: StorefrontPageDocument;
  /** Where each section's values are stored, keyed by section id. */
  bindings: ReadonlyMap<string, EditorSectionBinding>;
  /** Sections every page renders. */
  sharedSectionIds: ReadonlySet<string>;
  /** Component sources behind those sections, for identifying a selection. */
  sharedSourcePaths: ReadonlySet<string>;
  /** Native route sections that are visible but not bound to a Document yet. */
  unboundSections: readonly EditorUnboundSection[];
}>;

const EMPTY_DOCUMENT: StorefrontPageDocument = { version: 1, sections: [] };

/**
 * Structure derived from source, values taken from the document that owns them.
 *
 * `mergeDocumentWithRouteSections` answers this for one document at a time;
 * with no sections to merge it returns the document untouched, which is right
 * for a route that never adopted slots and wrong for a shell that has none —
 * there the answer is "no sections", not "every section stored here".
 */
function sectionsFor(
  template: EditorTemplateSnapshot | undefined,
  derived: readonly ThemeRouteSection[],
  ownsStructure: boolean,
): StorefrontPageDocument["sections"] {
  if (derived.length === 0)
    return ownsStructure ? [] : (template?.document.sections ?? []);
  return mergeDocumentWithRouteSections(
    template?.document ?? EMPTY_DOCUMENT,
    derived,
    { routeOwnsStructure: true },
  ).sections;
}

/**
 * The one answer to "what is on this page, and who stores each part".
 *
 * Every panel used to work this out for itself — the tree, the inspector, the
 * write path, the snapshot the undo stack captures — and each derivation was a
 * chance for two of them to disagree about which document a click writes to.
 */
export function resolveEditorSectionModel(args: {
  pageTemplate: EditorTemplateSnapshot | undefined;
  shellTemplate: EditorTemplateSnapshot | undefined;
  /** Slots the route declares, in source order. */
  pageSections: readonly ThemeRouteSection[];
  pageUnboundSections?: readonly ThemeUnboundRouteSection[];
  /** Whether the route's own slots define its structure. */
  pageOwnsStructure: boolean;
  /** Slots the layout declares, in source order. */
  shellSections: readonly ThemeRouteSection[];
  shellUnboundSections?: readonly ThemeUnboundRouteSection[];
}): EditorSectionModel {
  const shellSections = args.shellTemplate
    ? sectionsFor(args.shellTemplate, args.shellSections, true)
    : [];
  const pageSections = sectionsFor(
    args.pageTemplate,
    args.pageSections,
    args.pageOwnsStructure,
  );

  const bindings = new Map<string, EditorSectionBinding>();
  if (args.shellTemplate) {
    for (const section of shellSections) {
      bindings.set(section.id, {
        sectionId: section.id,
        templateId: args.shellTemplate.id,
        owner: "shell",
      });
    }
  }
  // A page cannot claim a slot the shell already owns: both would render, and
  // the write would land in whichever document was asked last.
  const pageOnly = pageSections.filter((section) => !bindings.has(section.id));
  if (args.pageTemplate) {
    for (const section of pageOnly) {
      bindings.set(section.id, {
        sectionId: section.id,
        templateId: args.pageTemplate.id,
        owner: "page",
      });
    }
  }

  return {
    document: {
      version: 1,
      ...(args.pageTemplate?.document.handle
        ? { handle: args.pageTemplate.document.handle }
        : {}),
      sections: [...shellSections, ...pageOnly],
    },
    bindings,
    sharedSectionIds: new Set(shellSections.map((section) => section.id)),
    sharedSourcePaths: new Set(
      args.shellSections.map((section) => section.componentSourcePath),
    ),
    unboundSections: [
      // Shell first: those sections wrap the page, so they read as the outer
      // structure rather than as something that happens to sort early. The
      // order is also why each entry needs its own `owner` — the two buckets
      // are indistinguishable once they are in one list.
      ...(args.shellUnboundSections ?? []).map((section) => ({
        ...section,
        owner: "shell" as const,
      })),
      ...(args.pageUnboundSections ?? []).map((section) => ({
        ...section,
        owner: "page" as const,
      })),
    ],
  };
}
