/**
 * Orders the Content inspector's fields.
 *
 * The panel used to render two hardcoded buckets — every declared field,
 * then the specialised ones — so a section label could never appear above the
 * array it introduces, no matter what the component did.
 *
 * Two better sources exist, and they answer different questions:
 *
 * - **The `contentFields` declaration.** When a component declares its fields,
 *   the author has already written them in an order. That is an intent, and it
 *   wins: the author may want the panel grouped differently from the way the
 *   markup happens to nest, and they control it by moving a line.
 * - **Document order.** When nothing is declared, the preview still knows the
 *   truth — the editable node tree that draws the left panel is in document
 *   order and each node carries the field it is bound to.
 *
 * Declaration order is preserved end-to-end (verified through the resolver's
 * Zod parse), so authors reorder the panel by reordering their declaration.
 */

/** The part of a preview editable node this needs. */
export interface ContentFieldOrderNode {
  readonly sectionId: string;
  readonly target?: {
    readonly fieldKey?: string;
    readonly fieldPath?: string;
  };
}

/**
 * Position of each content field within one section, in document order.
 *
 * The first appearance wins: a field bound to several elements belongs where it
 * is first read, and the panel shows one control for it either way.
 *
 * A field bound inside an array row is recorded under the array's own key, so
 * the group of row controls sorts to where the rows are, not to wherever the
 * first row's `title` happens to sit.
 */
export function buildContentFieldOrder(
  nodes: readonly ContentFieldOrderNode[] | undefined,
  sectionId: string | null | undefined,
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  if (!nodes || !sectionId) return order;

  let position = 0;
  for (const node of nodes) {
    if (node.sectionId !== sectionId) continue;
    const key = groupKeyForNode(node);
    if (!key || order.has(key)) continue;
    order.set(key, position);
    position += 1;
  }
  return order;
}

/**
 * The field key a node contributes its position to.
 *
 * `fieldPath` is the authority when present: `items.0.title` means this element
 * is inside the `items` array, and the panel renders one group for `items`
 * rather than a control per row field.
 */
function groupKeyForNode(node: ContentFieldOrderNode): string | null {
  const path = node.target?.fieldPath;
  if (path) {
    const root = path.split(".")[0];
    if (root) return root;
  }
  return node.target?.fieldKey ?? null;
}

/**
 * Combines the two sources into one position per field key.
 *
 * A declaration is an explicit statement of intent, so it forms the spine.
 * Fields the declaration does not mention — the platform's specialised
 * `heading`/`body`/image controls, which a component can render without
 * declaring — keep their document order and follow the declared ones, because
 * inserting them between declared fields would break the order the author
 * chose.
 *
 * With no declaration this is document order alone; with neither it is empty,
 * which leaves the panel exactly as it was.
 */
export function resolveContentFieldOrder({
  declaredKeys,
  documentOrder,
}: {
  declaredKeys: readonly string[];
  documentOrder: ReadonlyMap<string, number>;
}): ReadonlyMap<string, number> {
  if (declaredKeys.length === 0) return documentOrder;

  const order = new Map<string, number>();
  declaredKeys.forEach((key, index) => {
    if (!order.has(key)) order.set(key, index);
  });

  const undeclared = [...documentOrder.entries()]
    .filter(([key]) => !order.has(key))
    .sort((a, b) => a[1] - b[1]);

  undeclared.forEach(([key], index) => {
    order.set(key, declaredKeys.length + index);
  });

  return order;
}

/**
 * Sorts keyed blocks into the resolved order.
 *
 * A block whose field appears in neither source keeps its position relative to
 * the other unplaced blocks and follows the placed ones. Falling back to the
 * existing order matters: an empty map has to leave the panel exactly as it
 * was, so a preview that has not loaded yet cannot reshuffle the inspector.
 */
export function orderContentBlocks<T extends { readonly key: string }>(
  blocks: readonly T[],
  order: ReadonlyMap<string, number>,
): T[] {
  if (order.size === 0) return [...blocks];

  return blocks
    .map((block, index) => ({
      block,
      index,
      position: order.get(block.key),
    }))
    .sort((a, b) => {
      if (a.position === undefined && b.position === undefined) {
        return a.index - b.index;
      }
      if (a.position === undefined) return 1;
      if (b.position === undefined) return -1;
      if (a.position !== b.position) return a.position - b.position;
      return a.index - b.index;
    })
    .map((entry) => entry.block);
}
