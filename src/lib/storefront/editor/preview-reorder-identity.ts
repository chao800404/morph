import { parseArrayItemFieldPath } from "./array-item-field-path";
import { sourceLocationKey } from "@/lib/storefront/ast/source-location-key";

/**
 * What a dragged element is, and what it may be dropped onto.
 *
 * Three different things look like dragging in a preview and each is written
 * back somewhere else: a section moves in the route's section list, an array
 * item moves within its field, and anything else moves among its JSX siblings
 * by rewriting the source. Deciding which one a drag is has to be the same
 * decision in every preview, because dropping the same card in the same place
 * cannot mean two different edits.
 */

export type ReorderKind = "section" | "array" | "source";

export type ReorderIdentity = Readonly<{
  kind: ReorderKind;
  nodeId: string | null;
  fieldPath: string | null;
  arrayPath: string | null;
  parent: HTMLElement;
  sectionId: string;
  sourceFilePath: string;
}>;

/** What a gesture in progress knows about the element being dragged. */
export type ReorderGestureIdentity = Readonly<{
  kind: ReorderKind;
  parent: HTMLElement;
  sectionId: string;
  sourceFilePath: string;
  arrayPath: string | null;
}>;

export const sourceFilePathFor = (element: HTMLElement) =>
  element.closest<HTMLElement>("[data-morph-source-file]")?.dataset
    .morphSourceFile ??
  element.closest<HTMLElement>("[data-storefront-section-id]")?.dataset
    .morphSourceFile ??
  null;

/**
 * `line:column` of an element, when nothing else in the same source file
 * renders from that position. A JSX element inside `map()` renders once per
 * item and shares one position, which is precisely the ambiguity that must
 * not be reordered through source.
 */
const uniqueSourceLocationKey = (element: HTMLElement) => {
  const sourceLocation = element.dataset.morphLoc;
  if (!sourceLocation) return null;
  const key = sourceLocationKey(sourceLocation);
  if (!key) return null;
  const scope =
    element.closest<HTMLElement>("[data-storefront-section-id]") ?? document;
  const matches = scope.querySelectorAll<HTMLElement>(
    `[data-morph-loc="${CSS.escape(sourceLocation)}"]`,
  );
  return matches.length === 1 ? key : null;
};

const isUniqueMorphNode = (element: HTMLElement, nodeId: string) => {
  const sourcePath = sourceFilePathFor(element);
  if (!sourcePath) return false;
  const scope =
    element.closest<HTMLElement>("[data-storefront-section-id]") ?? document;
  return (
    Array.from(
      scope.querySelectorAll<HTMLElement>(
        `[data-morph-node="${CSS.escape(nodeId)}"]`,
      ),
    ).filter((candidate) => sourceFilePathFor(candidate) === sourcePath)
      .length === 1
  );
};

export const reorderIdentity = (element: HTMLElement) => {
  const nodeId = element.dataset.morphNode;
  const fieldPath = element.dataset.storefrontFieldPath;
  const arrayItem = fieldPath ? parseArrayItemFieldPath(fieldPath) : null;
  const parent = element.parentElement;
  const section = element.closest<HTMLElement>("[data-storefront-section-id]");
  const sectionId = section?.dataset.storefrontSectionId;
  const sourceFilePath = sourceFilePathFor(element);
  if (!parent || !sectionId || !sourceFilePath) return null;
  // A section root belongs to the route's section list, not to the JSX
  // siblings inside one component, so it reorders through the same path the
  // sidebar uses rather than through a source-file rewrite.
  if (element === section) {
    return {
      kind: "section" as const,
      nodeId: sectionId,
      fieldPath: null,
      arrayPath: null,
      parent,
      sectionId,
      sourceFilePath,
    };
  }
  if (arrayItem && fieldPath) {
    return {
      kind: "array" as const,
      nodeId: null,
      fieldPath,
      arrayPath: arrayItem.arrayPath,
      parent,
      sectionId,
      sourceFilePath,
    };
  }
  // An unmarked element is reordered by its source position instead. The
  // transformer accepts either, so a component with no authored markers is
  // still draggable — but the position must resolve to one element in this
  // file, exactly as a marker must.
  const targetKey =
    nodeId && isUniqueMorphNode(element, nodeId)
      ? nodeId
      : uniqueSourceLocationKey(element);
  if (!targetKey) return null;
  return {
    kind: "source" as const,
    nodeId: targetKey,
    fieldPath: null,
    arrayPath: null,
    parent,
    sectionId,
    sourceFilePath,
  };
};

export const isCompatibleReorderTarget = (
  identity: ReorderIdentity,
  gesture: ReorderGestureIdentity,
) =>
  identity.kind === gesture.kind &&
  identity.parent === gesture.parent &&
  // Two sections are exchangeable precisely because they are different
  // sections; everything else has to stay within one section and one file.
  (identity.kind === "section"
    ? identity.sectionId !== gesture.sectionId
    : identity.sectionId === gesture.sectionId &&
      identity.sourceFilePath === gesture.sourceFilePath) &&
  (identity.kind !== "array" || identity.arrayPath === gesture.arrayPath);
/**
 * The edit one drop means, or `null` when the drop says nothing coherent.
 *
 * Returning a message rather than posting one keeps the rule testable without
 * a document, a channel, or an editor on the other end of it.
 */
export function reorderCommitFor(
  gesture: ReorderGestureIdentity & {
    sectionId: string;
    draggedFieldPath: string | null;
    draggedNodeId: string | null;
  },
  target: ReorderIdentity,
):
  | {
      type: "morph:storefront-preview-commit-array-item-reorder";
      sectionId: string;
      draggedFieldPath: string;
      targetFieldPath: string;
    }
  | {
      type: "morph:storefront-preview-commit-section-reorder";
      draggedSectionId: string;
      targetSectionId: string;
    }
  | {
      type: "morph:storefront-preview-commit-sibling-reorder";
      sectionId: string;
      sourceFilePath: string;
      draggedNodeId: string;
      targetNodeId: string;
    }
  | null {
  if (
    gesture.kind === "array" &&
    gesture.draggedFieldPath &&
    target.fieldPath
  ) {
    return {
      type: "morph:storefront-preview-commit-array-item-reorder",
      sectionId: gesture.sectionId,
      draggedFieldPath: gesture.draggedFieldPath,
      targetFieldPath: target.fieldPath,
    };
  }
  if (gesture.kind === "section" && target.kind === "section") {
    return {
      type: "morph:storefront-preview-commit-section-reorder",
      draggedSectionId: gesture.sectionId,
      targetSectionId: target.sectionId,
    };
  }
  if (gesture.draggedNodeId && target.kind === "source" && target.nodeId) {
    return {
      type: "morph:storefront-preview-commit-sibling-reorder",
      sectionId: gesture.sectionId,
      sourceFilePath: gesture.sourceFilePath,
      draggedNodeId: gesture.draggedNodeId,
      targetNodeId: target.nodeId,
    };
  }
  return null;
}
