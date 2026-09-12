import {
  selectionKindFromElement,
  type EditableDescendantField,
} from "./selection-taxonomy";
import type {
  PreviewEditableNode,
  PreviewSelectionRestoreTarget,
  PreviewStyleSnapshot,
} from "./preview-protocol";

/**
 * How the editor finds content in a rendered preview.
 *
 * Pure DOM reading, deliberately: it asks a document what is on it and never
 * asks how that document was produced. That is what lets the same code answer
 * for the compatibility renderer, which annotates as it evaluates, and for a
 * real React preview, where the annotations were written in at compile time.
 * Two implementations would mean the editor could find a different element in
 * each, which is worse than finding none.
 */

export function selectionStyleSnapshot(
  computed: CSSStyleDeclaration,
): PreviewStyleSnapshot {
  return {
    fontSize: computed.fontSize,
    lineHeight: computed.lineHeight,
    fontFamily: computed.fontFamily,
    fontWeight: computed.fontWeight,
    textAlign: computed.textAlign,
    paddingTop: computed.paddingTop,
    paddingBottom: computed.paddingBottom,
    paddingLeft: computed.paddingLeft,
    paddingRight: computed.paddingRight,
    marginTop: computed.marginTop,
    marginBottom: computed.marginBottom,
    marginLeft: computed.marginLeft,
    marginRight: computed.marginRight,
    color: computed.color,
    backgroundColor: computed.backgroundColor,
    backgroundImage: computed.backgroundImage,
    borderRadius: computed.borderRadius,
    borderTopLeftRadius: computed.borderTopLeftRadius,
    borderTopRightRadius: computed.borderTopRightRadius,
    borderBottomRightRadius: computed.borderBottomRightRadius,
    borderBottomLeftRadius: computed.borderBottomLeftRadius,
    borderTopWidth: computed.borderTopWidth,
    borderTopStyle: computed.borderTopStyle,
    borderTopColor: computed.borderTopColor,
    display: computed.display,
    flexDirection: computed.flexDirection,
    gap: computed.gap,
    width: computed.width,
    height: computed.height,
    minWidth: computed.minWidth,
    maxWidth: computed.maxWidth,
    minHeight: computed.minHeight,
    maxHeight: computed.maxHeight,
    boxSizing: computed.boxSizing,
    position: computed.position,
    top: computed.top,
    left: computed.left,
    zIndex: computed.zIndex,
    opacity: computed.opacity,
    overflow: computed.overflow,
    transform: computed.transform,
    alignItems: computed.alignItems,
    justifyContent: computed.justifyContent,
  };
}

export function resolvePreviewSelectionRestoreElement(
  section: HTMLElement,
  target: PreviewSelectionRestoreTarget,
): HTMLElement {
  if (target.isSection) return section;
  const sourceLocationSelector = target.sourceLocation
    ? `[data-morph-loc="${CSS.escape(target.sourceLocation)}"]`
    : null;
  const selectorWithSourceLocation = (selector: string) =>
    sourceLocationSelector ? `${selector}${sourceLocationSelector}` : null;
  const selectors = [
    // A source location can be stale while the preview is being replaced. Use
    // it to disambiguate an authored identity first, but never let it override
    // a field/node identity and select an adjacent wrapper instead.
    target.nodeId && target.fieldPath
      ? selectorWithSourceLocation(
          `[data-morph-node="${CSS.escape(target.nodeId)}"][data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`,
        )
      : null,
    target.fieldPath
      ? selectorWithSourceLocation(
          `[data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`,
        )
      : null,
    target.nodeId
      ? selectorWithSourceLocation(
          `[data-morph-node="${CSS.escape(target.nodeId)}"]`,
        )
      : null,
    target.elementKey
      ? selectorWithSourceLocation(
          `[data-morph-element="${CSS.escape(target.elementKey)}"]`,
        )
      : null,
    target.fieldKey
      ? selectorWithSourceLocation(
          `[data-storefront-field="${CSS.escape(target.fieldKey)}"]`,
        )
      : null,
    target.nodeId && target.fieldPath
      ? `[data-morph-node="${CSS.escape(target.nodeId)}"][data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`
      : null,
    target.fieldPath
      ? `[data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`
      : null,
    target.nodeId ? `[data-morph-node="${CSS.escape(target.nodeId)}"]` : null,
    target.elementKey
      ? `[data-morph-element="${CSS.escape(target.elementKey)}"]`
      : null,
    target.fieldKey
      ? `[data-storefront-field="${CSS.escape(target.fieldKey)}"]`
      : null,
    sourceLocationSelector,
  ].filter((selector): selector is string => selector !== null);
  for (const selector of selectors) {
    const match = section.querySelector<HTMLElement>(selector);
    if (match) return match;
  }
  return section;
}

export const PREVIEW_EDITABLE_NODE_SELECTOR = [
  "[data-morph-node]",
  "[data-storefront-field-path]",
  "[data-storefront-field]",
  // Compile-time source positions make any authored element selectable, so a
  // component works in the editor without hand-written identity markers.
  "[data-morph-loc]",
].join(",");

/**
 * Elements that act as a selectable section root.
 *
 * `data-storefront-section-id` is injected when a component resolves to a
 * Document section. `data-morph-section` is authored in the component's own
 * source, so a component added purely in code is selectable without being
 * registered in the manifest or given a Document section first.
 */
export const PREVIEW_SECTION_ROOT_SELECTOR =
  // Over-selects on purpose: every candidate is still filtered by
  // `isPreviewSectionRoot`, which decides whether it really starts a section.
  "[data-storefront-section-id],[data-morph-section],[data-morph-component]";

/** Section identity, preferring the Document binding when both are present. */
export function previewSectionIdOf(element: HTMLElement): string | undefined {
  return (
    element.dataset.storefrontSectionId ??
    element.dataset.morphSection ??
    // Falls back to the component's own source file, so a component with no
    // authored markers still has a stable section identity.
    element.dataset.morphSourceFile ??
    undefined
  );
}

/**
 * Whether an element acts as a section root.
 *
 * A Document-bound section always is. An authored `data-morph-section` only
 * counts outside a Document section: treating a nested one as its own root
 * would cut its children out of the enclosing section and leave them
 * unselectable.
 */
export function isPreviewSectionRoot(element: HTMLElement): boolean {
  if (element.dataset.storefrontSectionId) return true;
  if (element.dataset.morphSection) {
    return !element.parentElement?.closest("[data-storefront-section-id]");
  }
  // The preview renderer marks the root element of every component it renders,
  // which is exactly where one component's markup ends and another's begins.
  // Deriving this from source-file changes instead would also match a route's
  // own markup, and that outer element would then absorb every component
  // nested inside it.
  if (!element.dataset.morphComponent) return false;
  return !element.parentElement?.closest("[data-storefront-section-id]");
}

export function closestPreviewSectionRoot(
  element: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (isPreviewSectionRoot(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function previewSectionSelector(sectionId: string): string {
  const escaped = CSS.escape(sectionId);
  return [
    `[data-storefront-section-id="${escaped}"]`,
    `[data-morph-section="${escaped}"]`,
    // A component with no authored markers is identified by its source file.
    `[data-morph-source-file="${escaped}"]`,
  ].join(",");
}

function previewEditableNodeLabel(element: HTMLElement): string {
  const fieldPath = element.dataset.storefrontFieldPath ?? "";
  const rawLabel =
    element.dataset.morphElement ??
    element.dataset.storefrontComponent ??
    element.dataset.storefrontField ??
    element.dataset.morphNode ??
    element.tagName.toLowerCase();
  const label = rawLabel
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
  const pathSegments = fieldPath.split(".");
  const lastSegment = pathSegments.at(-1);
  const resolvedLabel = label || element.tagName.toLowerCase();
  return (
    /^\d+$/.test(lastSegment ?? "")
      ? `${resolvedLabel} ${Number(lastSegment) + 1}`
      : resolvedLabel
  ).slice(0, 200);
}

export function collectPreviewEditableNodes(root: {
  querySelectorAll<T extends Element = Element>(
    selectors: string,
  ): NodeListOf<T>;
}): PreviewEditableNode[] {
  const nodes: PreviewEditableNode[] = [];
  const nodeIds = new Set<string>();
  const sections = root.querySelectorAll<HTMLElement>(
    PREVIEW_SECTION_ROOT_SELECTOR,
  );

  for (const section of sections) {
    if (!isPreviewSectionRoot(section)) continue;
    // Components nest by nature, so a nested component root stays its own
    // section and simply owns fewer elements. Only Document sections are
    // flattened, because a Document section inside another would double-count
    // the same content.
    if (
      section.dataset.storefrontSectionId &&
      section.parentElement?.closest("[data-storefront-section-id]")
    ) {
      continue;
    }
    const sectionId = previewSectionIdOf(section);
    if (!sectionId || sectionId.length > 100) continue;
    const candidates = Array.from(
      section.querySelectorAll<HTMLElement>(PREVIEW_EDITABLE_NODE_SELECTOR),
    ).filter((candidate) => closestPreviewSectionRoot(candidate) === section);
    const morphNodeCounts = new Map<string, number>();
    const fieldKeyCounts = new Map<string, number>();
    const sourceLocationCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const morphNode = candidate.dataset.morphNode;
      const fieldKey = candidate.dataset.storefrontField;
      const sourceLocation = candidate.dataset.morphLoc;
      if (sourceLocation) {
        sourceLocationCounts.set(
          sourceLocation,
          (sourceLocationCounts.get(sourceLocation) ?? 0) + 1,
        );
      }
      if (morphNode) {
        morphNodeCounts.set(
          morphNode,
          (morphNodeCounts.get(morphNode) ?? 0) + 1,
        );
      }
      if (fieldKey) {
        fieldKeyCounts.set(fieldKey, (fieldKeyCounts.get(fieldKey) ?? 0) + 1);
      }
    }

    const elementNodeIds = new Map<HTMLElement, string>();
    for (const candidate of candidates) {
      if (nodes.length >= 500) return nodes;
      const nodeId = candidate.dataset.morphNode;
      const fieldPath = candidate.dataset.storefrontFieldPath;
      const fieldKey = candidate.dataset.storefrontField;
      const elementKey = candidate.dataset.morphElement;
      const itemId = candidate.closest<HTMLElement>("[data-storefront-item-id]")
        ?.dataset.storefrontItemId;
      if (
        (nodeId?.length ?? 0) > 200 ||
        (fieldPath?.length ?? 0) > 500 ||
        (fieldKey?.length ?? 0) > 200 ||
        (elementKey?.length ?? 0) > 200
      ) {
        continue;
      }
      const sourceLocation = candidate.dataset.morphLoc;
      const hasUniqueNodeId =
        Boolean(nodeId) && morphNodeCounts.get(nodeId ?? "") === 1;
      const hasUniqueFieldKey =
        Boolean(fieldKey) && fieldKeyCounts.get(fieldKey ?? "") === 1;
      const hasUniqueSourceLocation =
        Boolean(sourceLocation) &&
        sourceLocationCounts.get(sourceLocation ?? "") === 1;
      if (
        !fieldPath &&
        !hasUniqueNodeId &&
        !hasUniqueFieldKey &&
        !hasUniqueSourceLocation
      ) {
        continue;
      }

      const identity = itemId
        ? `item:${itemId}:${nodeId ? `node:${nodeId}` : `field:${fieldKey ?? fieldPath}`}`
        : fieldPath
          ? `path:${fieldPath}${nodeId ? `:node:${nodeId}` : ""}`
          : nodeId
            ? `node:${nodeId}`
            : fieldKey
              ? `field:${fieldKey}`
              : `loc:${sourceLocation}`;
      const id = `${sectionId}:${identity}`;
      if (id.length > 500 || nodeIds.has(id)) continue;

      let parentElement = candidate.parentElement;
      let parentId: string | null = null;
      while (parentElement && parentElement !== section) {
        const matchedParentId = elementNodeIds.get(parentElement);
        if (matchedParentId) {
          parentId = matchedParentId;
          break;
        }
        parentElement = parentElement.parentElement;
      }

      const target: PreviewSelectionRestoreTarget = {
        sectionId,
        sourceLocation: sourceLocation || undefined,
        nodeId: nodeId || undefined,
        fieldPath: fieldPath || undefined,
        elementKey: elementKey || undefined,
        fieldKey: fieldKey || undefined,
        isSection: false,
      };
      const kind = selectionKindFromElement({
        component: candidate.dataset.storefrontComponent,
        morphElement: elementKey,
        tagName: candidate.tagName,
        role: candidate.getAttribute("role"),
        inputType: candidate.getAttribute("type"),
      });
      nodes.push({
        id,
        parentId,
        sectionId,
        label: previewEditableNodeLabel(candidate),
        kind,
        tagName: candidate.tagName.toLowerCase().slice(0, 32),
        // Reported, not used as the label: only an element with one can carry a
        // style bound to a single instance, and that is worth being able to see.
        stableId: nodeId || elementKey || undefined,
        target,
      });
      nodeIds.add(id);
      elementNodeIds.set(candidate, id);
    }
  }

  return nodes;
}

export function collectEditableDescendantFields(
  element: HTMLElement,
): EditableDescendantField[] {
  const result: EditableDescendantField[] = [];
  const identities = new Set<string>();
  const candidates = element.querySelectorAll<HTMLElement>(
    "[data-storefront-field]",
  );

  for (const candidate of candidates) {
    if (candidate.querySelector("[data-storefront-field]")) continue;
    const fieldKey = candidate.dataset.storefrontField;
    if (!fieldKey) continue;
    const fieldPath = candidate.dataset.storefrontFieldPath ?? fieldKey;
    const sectionId = previewSectionIdOf(
      closestPreviewSectionRoot(candidate) ?? candidate,
    );
    const identity = `${sectionId ?? ""}\u0000${fieldKey}\u0000${fieldPath}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    result.push({ fieldKey, fieldPath, sectionId: sectionId ?? null });
  }

  return result;
}

/**
 * Field annotations are the most precise identity available for a content
 * control. Keep this small helper public so selection behavior can be tested
 * without mounting the whole preview route.
 */
export function closestPreviewFieldElement(
  element: HTMLElement,
): HTMLElement | null {
  return element.closest<HTMLElement>("[data-storefront-field]");
}
