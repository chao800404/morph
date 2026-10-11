import {
  selectionKindFromElement,
  type ContentUnavailableReason,
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

/**
 * A restore target whose row path is re-read through the row's `id`.
 *
 * The path names the row by index, and after a reorder that index belongs to
 * another row: restoring by it would move the selection, silently, onto a row
 * the author did not pick. The id stays with the row, so the path is taken
 * from wherever that row is now. A row that is gone leaves the target alone;
 * the identities below decide, as they did before ids were carried.
 */
function followRestoredRow(
  section: HTMLElement,
  target: PreviewSelectionRestoreTarget,
): PreviewSelectionRestoreTarget {
  const match =
    target.itemId && target.fieldPath
      ? /^([^.]+)\.(\d+)(\..+)?$/.exec(target.fieldPath)
      : null;
  if (!match) return target;
  const [, key = "", , rest = ""] = match;
  for (const row of section.querySelectorAll<HTMLElement>(
    `[data-storefront-item-id="${CSS.escape(target.itemId!)}"][data-storefront-field-path]`,
  )) {
    // The row itself (`items.2`), not a field inside it.
    const rowPath = row.dataset.storefrontFieldPath ?? "";
    const index = rowPath.startsWith(`${key}.`)
      ? rowPath.slice(key.length + 1)
      : "";
    if (!/^\d+$/.test(index)) continue;
    return { ...target, fieldPath: `${rowPath}${rest}` };
  }
  return target;
}

export function resolvePreviewSelectionRestoreElement(
  section: HTMLElement,
  target: PreviewSelectionRestoreTarget,
  retainedElement?: HTMLElement | null,
): HTMLElement {
  if (target.isSection) return section;
  target = followRestoredRow(section, target);
  const sourceLocationSelector = target.sourceLocation
    ? `[data-morph-loc="${CSS.escape(target.sourceLocation)}"]`
    : null;
  const selectorWithSourceLocation = (selector: string) =>
    sourceLocationSelector ? `${selector}${sourceLocationSelector}` : null;
  const identitySelectors = [
    // An id the author wrote is the only identity that survives an edit above
    // the element. It leads, and everything below it remains because the id
    // can be changed or deleted between the selection and the restore, and
    // because an `id` put on a component is a prop it may never pass on.
    target.htmlId
      ? selectorWithSourceLocation(`#${CSS.escape(target.htmlId)}`)
      : null,
    target.htmlId ? `#${CSS.escape(target.htmlId)}` : null,
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
  ].filter((selector): selector is string => selector !== null);
  for (const selector of identitySelectors) {
    // A row a component renders has its path twice: on the element the
    // component returns, and on the preview's own wrapper around it, which
    // takes no space and would leave the selection with nothing to outline.
    // A field the editor refused is never restored onto at all.
    let wrapper: HTMLElement | null = null;
    for (const match of section.querySelectorAll<HTMLElement>(selector)) {
      if (
        match.hasAttribute("data-storefront-field") &&
        !previewFieldBinding(match)?.fieldKey
      ) {
        continue;
      }
      if (!match.matches(PREVIEW_ROW_WRAPPER_SELECTOR)) return match;
      wrapper ??= match;
    }
    if (wrapper) return wrapper;
  }

  // A source location is the explicit identity sent by a tree row. Prefer it
  // whenever the freshly rendered document still has that location; otherwise
  // every plain element in the same section would resolve to the previously
  // selected sibling simply because it remains connected to the DOM.
  if (sourceLocationSelector) {
    const match = section.querySelector<HTMLElement>(sourceLocationSelector);
    if (match) return match;
  }

  // Formatting or adding lines in Code mode can make that location stale,
  // while React commonly keeps the same DOM node alive through Fast Refresh.
  // Preserve the concrete identity only after the requested location failed;
  // stable field/node identities above still win whenever the component
  // exposes one.
  if (
    retainedElement?.isConnected &&
    retainedElement !== section &&
    section.contains(retainedElement)
  ) {
    return retainedElement;
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
 * A layout-neutral row boundary injected only for preview bookkeeping.
 *
 * It remains in the DOM so array reordering retains `items.N`, but it is not
 * authored JSX and therefore must never become a second, fake row in the
 * editor tree. Authored `display: contents` elements deliberately do not match.
 */
export const PREVIEW_ROW_WRAPPER_SELECTOR = "[data-morph-preview-row-wrapper]";

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
    element.dataset.morphRoutePath ??
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
  if (element.dataset.morphRoutePath) return true;
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
    `[data-morph-route-path="${escaped}"]`,
    // A component with no authored markers is identified by its source file.
    `[data-morph-source-file="${escaped}"]`,
  ].join(",");
}

/**
 * The content field an element is bound to, or `null` when it names none the
 * editor can prove.
 *
 * Every reading of an element's field goes through here — the tree, a click
 * and the descendants a selection offers — so the three cannot disagree.
 *
 * The one refusal: inside a row a component renders, a field must address
 * that row. The component names its own props, and a prop is the row's only
 * when the list's call site proved it and the compiler said so with a path
 * under the row's. Anything else there — a prop the list set from elsewhere, a
 * list the component keeps of its own — names a field of the component, not
 * of the section, and reading it as the section's would write to a field the
 * section never declared.
 */
export function previewFieldBinding(
  element: HTMLElement,
): { fieldKey: string | null; fieldPath: string | null } | null {
  const fieldKey = element.dataset.storefrontField || null;
  const fieldPath = element.dataset.storefrontFieldPath || null;
  if (!fieldKey && !fieldPath) return null;
  const row = enclosingComponentRow(element);
  if (row) {
    const rowPath = row.dataset.storefrontFieldPath;
    if (
      !rowPath ||
      !fieldPath ||
      (fieldPath !== rowPath && !fieldPath.startsWith(`${rowPath}.`))
    ) {
      return null;
    }
  }
  return { fieldKey, fieldPath };
}

/**
 * The preview's wrapper around a row a component renders, when `element` is
 * inside one in the same section.
 */
function enclosingComponentRow(element: HTMLElement): HTMLElement | null {
  const row = element.parentElement?.closest<HTMLElement>(
    PREVIEW_ROW_WRAPPER_SELECTOR,
  );
  return row &&
    closestPreviewSectionRoot(row) === closestPreviewSectionRoot(element)
    ? row
    : null;
}

/**
 * Whether an element's content is one the editor must not name.
 *
 * A field marker it refused, and inside a component's row any element with no
 * proven field: the names a selection otherwise falls back to (the element's
 * `data-morph-element`, its tag) are guesses at a top-level field, and a row
 * has none.
 */
function isRefusedContent(element: HTMLElement): boolean {
  if (previewFieldBinding(element)?.fieldKey) return false;
  return (
    element.hasAttribute("data-storefront-field") ||
    enclosingComponentRow(element) !== null
  );
}

/**
 * Why an element inside a component's row offers no content, or `null` when
 * it offers some or names none to begin with.
 *
 * Read from what the compiler wrote: an empty field is a prop the list did not
 * set from the row; a field with no path is a component that was not handed
 * its row; a path that is not the row's is a list of the component's own.
 */
export function previewContentUnavailableReason(
  element: HTMLElement,
): ContentUnavailableReason | null {
  if (!element.hasAttribute("data-storefront-field")) return null;
  if (previewFieldBinding(element)?.fieldKey) return null;
  if (!enclosingComponentRow(element)) return null;
  if (element.dataset.storefrontField === "") return "value-not-from-row";
  return element.dataset.storefrontFieldPath ? "nested-list" : "row-not-passed";
}

/**
 * The `id` of the repeated-field row an element belongs to, in its own
 * section: what lets the editor confirm the row before it writes, since the
 * index in its path moves whenever the rows do.
 */
function previewRowItemId(element: HTMLElement): string | null {
  const row = element.closest<HTMLElement>("[data-storefront-item-id]");
  if (
    !row ||
    closestPreviewSectionRoot(row) !== closestPreviewSectionRoot(element)
  ) {
    return null;
  }
  const id = row.dataset.storefrontItemId ?? "";
  if (!id || id.length > 200) return null;
  // An id is an identity only while one row holds it. Two rows sharing one
  // cannot be told apart, so the element is reported as having none, and the
  // editor refuses to write rather than pick one.
  //
  // Counted within one list of one section: two lists may legitimately reuse
  // an id (`normalizeDocumentRowIds` scopes ids per array too), and only a
  // collision inside the same list leaves a row ambiguous.
  const listKey = (row.dataset.storefrontFieldPath ?? "").split(".")[0] ?? "";
  const section = closestPreviewSectionRoot(row) ?? row.ownerDocument;
  const rowPaths = new Set<string>();
  for (const candidate of section.querySelectorAll<HTMLElement>(
    `[data-storefront-item-id="${CSS.escape(id)}"][data-storefront-field-path]`,
  )) {
    const path = candidate.dataset.storefrontFieldPath ?? "";
    if (/^[^.]+\.\d+$/.test(path) && path.startsWith(`${listKey}.`)) {
      rowPaths.add(path);
    }
  }
  return rowPaths.size > 1 ? null : id;
}

/** Whether something inside `element` is a field the editor can prove. */
function hasBoundDescendantField(element: HTMLElement): boolean {
  for (const candidate of element.querySelectorAll<HTMLElement>(
    "[data-storefront-field]",
  )) {
    if (previewFieldBinding(candidate)?.fieldKey) return true;
  }
  return false;
}

function previewEditableNodeLabel(element: HTMLElement): string {
  // `Div#hero-content`, or `Div` when the element was never named: the tag says
  // what it is and the id says which one. Written this way round rather than
  // the id alone so one form covers both, and so a named element still reads
  // as the same kind of thing as its unnamed neighbours.
  //
  // The name is deliberately independent of editor markers and field bindings.
  // Those are implementation identities, not names an author sees in their own
  // HTML — and reading "Heading" on an element nobody named would leave no way
  // to tell which elements have actually been given a name.
  const authoredId = element.id.trim();
  const idSuffix =
    authoredId && authoredId.length <= 200 ? `#${authoredId}` : "";
  const fieldPath = element.dataset.storefrontFieldPath ?? "";
  const rawLabel = element.tagName.toLowerCase();
  const label = rawLabel
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
  const pathSegments = fieldPath.split(".");
  const lastSegment = pathSegments.at(-1);
  const resolvedLabel = label || element.tagName.toLowerCase();
  return `${
    /^\d+$/.test(lastSegment ?? "")
      ? `${resolvedLabel} ${Number(lastSegment) + 1}`
      : resolvedLabel
  }${idSuffix}`.slice(0, 200);
}

export function collectPreviewEditableNodes(root: {
  querySelectorAll<T extends Element = Element>(
    selectors: string,
  ): NodeListOf<T>;
}): PreviewEditableNode[] {
  const nodes: PreviewEditableNode[] = [];
  const nodeIds = new Set<string>();
  // An HTML id is only an identity while it is the document's. The same
  // component rendered twice writes the same id twice without anyone asking
  // for it, and a selection restored by a duplicate would land on whichever
  // twin the browser happened to return. Counted over the whole document
  // rather than per section, which is the scope the uniqueness rule has.
  const htmlIdCounts = new Map<string, number>();
  for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
    const id = element.id.trim();
    if (id) htmlIdCounts.set(id, (htmlIdCounts.get(id) ?? 0) + 1);
  }
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
    ).filter(
      (candidate) =>
        closestPreviewSectionRoot(candidate) === section &&
        !candidate.matches(PREVIEW_ROW_WRAPPER_SELECTOR),
    );
    const morphNodeCounts = new Map<string, number>();
    const fieldKeyCounts = new Map<string, number>();
    const sourceLocationCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const morphNode = candidate.dataset.morphNode;
      const fieldKey = previewFieldBinding(candidate)?.fieldKey;
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
      const binding = previewFieldBinding(candidate);
      const fieldPath = binding?.fieldPath ?? undefined;
      const fieldKey = binding?.fieldKey ?? undefined;
      const elementKey = candidate.dataset.morphElement;
      const itemId = candidate.closest<HTMLElement>("[data-storefront-item-id]")
        ?.dataset.storefrontItemId;
      const htmlId = candidate.id.trim();
      if (
        (nodeId?.length ?? 0) > 200 ||
        (fieldPath?.length ?? 0) > 500 ||
        (fieldKey?.length ?? 0) > 200 ||
        (elementKey?.length ?? 0) > 200 ||
        htmlId.length > 200
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

      const hasUniqueHtmlId = Boolean(htmlId) && htmlIdCounts.get(htmlId) === 1;
      // An id the author wrote, ahead of everything the platform derived: it
      // is the one identity that survives an edit above the element, which a
      // source position does not. A row inside a repeated field keeps its
      // row-scoped identity regardless, because an id repeated once per row is
      // not unique and never reaches here.
      const identity = hasUniqueHtmlId
        ? `id:${htmlId}`
        : itemId
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
        // Only when it is the document's own. A duplicate would restore onto
        // whichever twin the browser returned first.
        htmlId: hasUniqueHtmlId ? htmlId : undefined,
        nodeId: nodeId || undefined,
        fieldPath: fieldPath || undefined,
        ...(itemId ? { itemId } : {}),
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
        htmlId: htmlId || undefined,
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
    const binding = previewFieldBinding(candidate);
    if (!binding?.fieldKey || hasBoundDescendantField(candidate)) continue;
    const fieldKey = binding.fieldKey;
    const fieldPath = binding.fieldPath ?? fieldKey;
    const sectionId = previewSectionIdOf(
      closestPreviewSectionRoot(candidate) ?? candidate,
    );
    const identity = `${sectionId ?? ""}\u0000${fieldKey}\u0000${fieldPath}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    const itemId = previewRowItemId(candidate);
    result.push({
      fieldKey,
      fieldPath,
      sectionId: sectionId ?? null,
      ...(itemId ? { itemId } : {}),
    });
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
  const field = element.closest<HTMLElement>("[data-storefront-field]");
  // A field the editor cannot prove is not passed over for an outer one
  // either: the click is on that element, which is then selected as an
  // element, with no content of its own to edit.
  return field && previewFieldBinding(field)?.fieldKey ? field : null;
}

export type SelectableInfo = {
  element: HTMLElement;
  section: HTMLElement | null;
  /** `file:line:column`, when the element carries a compiled position. */
  sourceLocation?: string | null;
  sectionId: string | null;
  type: string;
  label: string;
  elementKey: string | null;
  fieldKey: string | null;
  field: string | null;
  fieldPath: string | null;
  descendantFields: EditableDescendantField[];
  tagName: string;
  role: string | null;
  inputType: string | null;
  /** The repeated-field row the element is in, by its persistent `id`. */
  itemId: string | null;
  /** Why the element offers no content to edit, when that can be said. */
  contentUnavailable: ContentUnavailableReason | null;
};

type ResolvedElement = Omit<SelectableInfo, "itemId" | "contentUnavailable">;

export const getComponentDisplayName = (type: string): string => {
  switch (type.toLowerCase()) {
    case "hero":
      return "Hero Section";
    case "editorial-intro":
      return "Editorial Intro";
    case "category-showcase":
      return "Category Showcase";
    case "image-with-text":
      return "Image With Text";
    case "principles":
      return "Principles Section";
    case "newsletter":
      return "Newsletter Section";
    case "heading":
      return "Heading";
    case "eyebrow":
      return "Eyebrow";
    case "description":
    case "body":
      return "Body Text";
    case "button":
      return "Button";
    case "image":
      return "Image";
    case "input":
      return "Input Field";
    case "collection-item":
      return "Collection Item";
    case "principle-item":
      return "Principle Card";
    case "title":
      return "Title";
    case "caption":
      return "Caption";
    case "label":
    case "badge":
      return "Label";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
};

export const selectionKindOf = (item: SelectableInfo) =>
  selectionKindFromElement({
    component: item.type,
    morphElement: item.elementKey,
    tagName: item.tagName,
    role: item.role,
    inputType: item.inputType,
    isSection: item.element === item.section,
  });

export const selectionMetadata = (item: SelectableInfo) => {
  const sourceElement = item.element.closest<HTMLElement>(
    "[data-morph-source-file]",
  );
  const kind = selectionKindOf(item);
  return {
    kind,
    sourceFilePath:
      sourceElement?.dataset.morphSourceFile ??
      item.section?.dataset.morphSourceFile ??
      null,
    tagName: item.tagName,
    role: item.role,
    inputType: item.inputType,
    fieldPath: item.fieldPath,
  };
};

/**
 * A Document section is represented by a transparent wrapper. It deliberately
 * has no source-location marker of its own, so resolving it must stop here
 * rather than walking to the route's marked `<main>` ancestor. The latter is
 * the page root and made every tree section click appear to select the page.
 */
function sectionRootSelectable(section: HTMLElement): ResolvedElement {
  const sectionId = previewSectionIdOf(section) ?? null;
  const sectionType =
    section.dataset.storefrontSectionType ??
    section.dataset.morphSection ??
    (section.dataset.morphRoutePath ? "page" : undefined) ??
    "section";
  return {
    element: section,
    section,
    sourceLocation: section.dataset.morphLoc ?? null,
    sectionId,
    type: sectionType,
    label: getComponentDisplayName(sectionType),
    elementKey: null,
    fieldKey: null,
    field: null,
    fieldPath: null,
    descendantFields: collectEditableDescendantFields(section),
    tagName: section.tagName.toLowerCase(),
    role: section.getAttribute("role"),
    inputType: null,
  };
}

export const resolveSelectable = (
  target: EventTarget | null,
): SelectableInfo | null => {
  const item = resolveSelectableElement(target);
  if (!item) return null;
  return {
    ...item,
    itemId: previewRowItemId(item.element),
    contentUnavailable: previewContentUnavailableReason(item.element),
  };
};

const resolveSelectableElement = (
  target: EventTarget | null,
): ResolvedElement | null => {
  if (!(target instanceof HTMLElement)) return null;

  // 0. A content field is more precise than an ancestor AST marker. Some
  // rendered fields (notably action labels) intentionally have no source
  // location of their own, so resolving the ancestor first would make the
  // inspector show the container instead of the actual field.
  const fieldEl = closestPreviewFieldElement(target);
  if (fieldEl) {
    const sectionEl = closestPreviewSectionRoot(fieldEl);
    const descendantFields = collectEditableDescendantFields(fieldEl);
    const binding = previewFieldBinding(fieldEl);
    const fieldKey =
      descendantFields.length > 0 ? null : (binding?.fieldKey ?? null);
    const fieldPath = binding?.fieldPath ?? fieldKey;
    const elementKey = fieldEl.dataset.morphElement ?? null;
    const selectableType =
      fieldEl.dataset.storefrontComponent ??
      elementKey ??
      fieldEl.tagName.toLowerCase();

    return {
      element: fieldEl,
      section: sectionEl,
      sourceLocation: fieldEl.dataset.morphLoc ?? null,
      sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
      type: selectableType,
      label: getComponentDisplayName(selectableType),
      elementKey,
      fieldKey,
      field: fieldKey,
      fieldPath,
      descendantFields,
      tagName: fieldEl.tagName.toLowerCase(),
      role: fieldEl.getAttribute("role"),
      inputType: fieldEl instanceof HTMLInputElement ? fieldEl.type : null,
    };
  }

  // A sidebar section click passes the transparent Document wrapper itself.
  // It has no AST marker, while the route's marked ancestor does; stop at the
  // explicit section root before the generic marker lookup can steal it.
  if (
    (target.dataset.storefrontSectionId ||
      target.dataset.morphSection ||
      target.dataset.morphRoutePath) &&
    isPreviewSectionRoot(target)
  ) {
    return sectionRootSelectable(target);
  }

  // 1. Prefer the nearest AST-backed Morph identity annotation.
  const morphEl = target.closest<HTMLElement>(
    // Compile-time source positions make an element identifiable even when
    // the author wrote no markers, so they select like any other element.
    "[data-morph-node], [data-morph-element], [data-morph-loc]",
  );
  if (morphEl) {
    const sectionEl = closestPreviewSectionRoot(morphEl);
    const nodeId = morphEl.dataset.morphNode ?? null;
    const elementKey = morphEl.dataset.morphElement ?? null;
    const descendantFields = collectEditableDescendantFields(morphEl);
    const binding = previewFieldBinding(morphEl);
    // A field marker the editor refused stays refused: the element-name
    // fallback below is for elements that carry none.
    const refused = isRefusedContent(morphEl);
    const fieldKey =
      descendantFields.length > 0 || refused
        ? null
        : (binding?.fieldKey ??
          (elementKey
            ? elementKey === "action"
              ? "actionLabel"
              : elementKey === "image"
                ? "imageSrc"
                : elementKey
            : null));
    const fieldPath = refused ? null : (binding?.fieldPath ?? fieldKey);
    const selectableType =
      elementKey ?? nodeId ?? morphEl.tagName.toLowerCase();

    return {
      element: morphEl,
      section: sectionEl,
      sourceLocation: morphEl.dataset.morphLoc ?? null,
      sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
      type: selectableType,
      label: getComponentDisplayName(selectableType),
      elementKey,
      fieldKey,
      field: fieldKey,
      fieldPath,
      descendantFields,
      tagName: morphEl.tagName.toLowerCase(),
      role: morphEl.getAttribute("role"),
      inputType: morphEl instanceof HTMLInputElement ? morphEl.type : null,
    };
  }

  // 2. Prioritize explicit component annotation
  const componentEl = target.closest<HTMLElement>(
    "[data-storefront-component]",
  );
  if (componentEl) {
    const sectionEl = closestPreviewSectionRoot(componentEl);
    const compType =
      componentEl.dataset.storefrontComponent ??
      componentEl.tagName.toLowerCase();
    const binding = previewFieldBinding(componentEl);
    const refused = isRefusedContent(componentEl);
    const fieldKey = binding?.fieldKey ?? null;
    const fieldPath = refused ? null : (binding?.fieldPath ?? fieldKey);
    const elementKey =
      componentEl.dataset.morphElement ??
      (compType === "heading" ||
      compType === "eyebrow" ||
      compType === "description" ||
      compType === "action" ||
      compType === "image"
        ? compType
        : null);
    const descendantFields = collectEditableDescendantFields(componentEl);

    return {
      element: componentEl,
      section: sectionEl,
      sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
      type: compType,
      label: getComponentDisplayName(compType),
      elementKey,
      fieldKey,
      field: fieldKey ?? (refused ? null : elementKey),
      fieldPath,
      descendantFields,
      tagName: componentEl.tagName.toLowerCase(),
      role: componentEl.getAttribute("role"),
      inputType:
        componentEl instanceof HTMLInputElement ? componentEl.type : null,
    };
  }

  // 3. Standard interactive & typography sub-elements
  const elementEl = target.closest<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, p, blockquote, code, pre, img, picture, svg, video, audio, canvas, iframe, embed, map, a, button, nav, details, summary, form, fieldset, input, textarea, select, option, ul, ol, li, table, thead, tbody, tfoot, tr, td, th, hr, article",
  );
  if (elementEl) {
    const sectionEl = closestPreviewSectionRoot(elementEl);
    const tag = elementEl.tagName.toLowerCase();
    const compType = tag.startsWith("h")
      ? "heading"
      : tag === "blockquote"
        ? "blockquote"
        : tag === "code" || tag === "pre"
          ? "code"
          : tag === "img"
            ? "image"
            : tag === "picture"
              ? "picture"
              : tag === "svg"
                ? "svg"
                : tag === "video"
                  ? "video"
                  : tag === "audio"
                    ? "audio"
                    : tag === "canvas"
                      ? "canvas"
                      : tag === "iframe"
                        ? "iframe"
                        : tag === "embed"
                          ? "embed"
                          : tag === "nav"
                            ? "navigation"
                            : tag === "form"
                              ? "form"
                              : tag === "fieldset"
                                ? "fieldset"
                                : tag === "textarea"
                                  ? "textarea"
                                  : tag === "select"
                                    ? "select"
                                    : tag === "option"
                                      ? "option"
                                      : tag === "input"
                                        ? elementEl instanceof
                                            HTMLInputElement &&
                                          elementEl.type === "checkbox"
                                          ? "checkbox"
                                          : elementEl instanceof
                                                HTMLInputElement &&
                                              elementEl.type === "radio"
                                            ? "radio"
                                            : "input"
                                        : tag === "ul" || tag === "ol"
                                          ? "list"
                                          : tag === "li"
                                            ? "list-item"
                                            : tag === "table"
                                              ? "table"
                                              : tag === "tr"
                                                ? "table-row"
                                                : tag === "td" || tag === "th"
                                                  ? "table-cell"
                                                  : tag === "hr"
                                                    ? "divider"
                                                    : tag === "a" ||
                                                        tag === "button"
                                                      ? "action"
                                                      : tag === "p"
                                                        ? "description"
                                                        : tag === "article"
                                                          ? "card"
                                                          : tag;

    const binding = previewFieldBinding(elementEl);
    const refused = isRefusedContent(elementEl);
    const fieldKey = refused
      ? null
      : (binding?.fieldKey ??
        (compType === "action"
          ? "actionLabel"
          : compType === "image"
            ? "imageSrc"
            : compType));
    const fieldPath = refused ? null : (binding?.fieldPath ?? fieldKey);
    const descendantFields = collectEditableDescendantFields(elementEl);

    return {
      element: elementEl,
      section: sectionEl,
      sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
      type: compType,
      label: getComponentDisplayName(compType),
      elementKey: compType,
      fieldKey,
      field: fieldKey,
      fieldPath,
      descendantFields,
      tagName: tag,
      role: elementEl.getAttribute("role"),
      inputType: elementEl instanceof HTMLInputElement ? elementEl.type : null,
    };
  }

  // 4. Fallback to outer Section
  const section = target.closest<HTMLElement>("[data-storefront-section-id]");
  if (section) return sectionRootSelectable(section);

  return null;
};
