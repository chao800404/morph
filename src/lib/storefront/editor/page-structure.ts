import type { PreviewEditableNode } from "./preview-protocol";

/**
 * Splits a rendered page into the template's sections and everything around
 * them.
 *
 * A page is not only its template. The layout shell, the route module, the
 * header and the footer are all on the canvas and all editable, and the editor
 * has to place them somewhere. They are ordered by where they appear in the
 * rendered page and split around the template's own sections, so a tree built
 * from this reads top to bottom the way the page does.
 */
export type PageRootSplit = {
  /** Roots painted before the template's first section. */
  before: string[];
  /** Roots painted after it. */
  after: string[];
  /**
   * Roots the layout supplies rather than this route.
   *
   * These render on every page that uses the layout, so an edit to one is an
   * edit to all of them — a different act from changing a section that belongs
   * to the page being looked at, and worth saying so.
   */
  shared: Set<string>;
};

export function splitPageRoots({
  editableNodes,
  templateSectionIds,
  routeSourcePath,
}: {
  editableNodes: readonly PreviewEditableNode[];
  /** Section ids the template owns; these are rendered as section rows. */
  templateSectionIds: ReadonlySet<string>;
  /** The module backing the current route, which is this page's alone. */
  routeSourcePath?: string;
}): PageRootSplit {
  const before: string[] = [];
  const after: string[] = [];
  const shared = new Set<string>();
  const seen = new Set<string>();
  let passedTemplateSections = false;

  for (const node of editableNodes) {
    const sectionId = node.sectionId;
    if (!sectionId) continue;
    if (templateSectionIds.has(sectionId)) {
      passedTemplateSections = true;
      continue;
    }
    if (seen.has(sectionId)) continue;
    seen.add(sectionId);
    (passedTemplateSections ? after : before).push(sectionId);
    if (sectionId !== routeSourcePath) shared.add(sectionId);
  }

  return { before, after, shared };
}
