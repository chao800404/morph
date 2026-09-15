import { parse } from "@babel/parser";
import { injectPreviewBindings } from "./inject-preview-bindings";
import { MORPH_SOURCE_LOCATION_ATTRIBUTE } from "@/lib/storefront/compiler/theme-source-location-plugin";

/**
 * Removes the hand-written markers the compiler has learned to derive.
 *
 * The rule a Theme author is given is that they never write a `data-*` to make
 * something editable. Generated files were brought in line by replacing them
 * wholesale, which works only while their bytes still match what Morph wrote —
 * and the workspaces that most need the cleanup are exactly the ones an author
 * has since edited, so a byte-exact replacement lets go of them for good.
 *
 * This removes the attributes instead of the file, which means it has to earn
 * the right to touch source nobody generated. It does that by proving the
 * removal changes nothing: the compiler runs over the file before and after,
 * and a marker is only dropped when every element still ends up with the same
 * field, the same path and the same identity it had. A marker the compiler
 * cannot reproduce stays exactly where the author put it.
 */

/**
 * Markers the compiler can produce on its own.
 *
 * `data-morph-element` and `data-morph-section` are absent on purpose: they
 * carry a name the author chose, which no analysis can recover from the
 * expression beside it. Being removable is a property of identity markers, not
 * of the `data-morph-*` prefix.
 */
export const DERIVABLE_MARKER_ATTRIBUTES: readonly string[] = [
  "data-morph-node",
  "data-storefront-field",
  "data-storefront-field-path",
  "data-storefront-item-id",
];

const DERIVABLE = new Set(DERIVABLE_MARKER_ATTRIBUTES);
const JSX_FILE = /\.(tsx|jsx)$/;

/** What the compiler says about one element, ignoring where it sits. */
type ElementMarkers = Readonly<{
  field: string | null;
  fieldPath: string | null;
  itemId: string | null;
  /** Whether the element named itself by hand before the strip. */
  hadNode: boolean;
  /** Whether the compiler gave it a position the editor can address it by. */
  addressable: boolean;
}>;

function attributeSource(attribute: any, source: string): string | null {
  const value = attribute.value;
  if (value == null) return "";
  if (value.type === "StringLiteral") return value.value;
  if (typeof value.start === "number" && typeof value.end === "number") {
    return source.slice(value.start, value.end);
  }
  return null;
}

/**
 * Every element the compiler emitted, in source order.
 *
 * Order is the identity here, and it holds because the two files being
 * compared differ only by attributes that were deleted: no element is added,
 * removed or reordered, so the nth element of one is the nth of the other.
 */
function readEmittedMarkers(source: string, path: string): ElementMarkers[] {
  let ast: any;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return [];
  }

  const elements: ElementMarkers[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node.type === "JSXElement") {
      let field: string | null = null;
      let fieldPath: string | null = null;
      let itemId: string | null = null;
      let hadNode = false;
      let addressable = false;
      for (const attribute of node.openingElement?.attributes ?? []) {
        if (
          attribute?.type !== "JSXAttribute" ||
          attribute.name?.type !== "JSXIdentifier"
        ) {
          continue;
        }
        const name = attribute.name.name;
        if (name === "data-storefront-field") {
          field = attributeSource(attribute, source);
        } else if (name === "data-storefront-field-path") {
          fieldPath = attributeSource(attribute, source);
        } else if (name === "data-storefront-item-id") {
          itemId = attributeSource(attribute, source);
        } else if (name === "data-morph-node") {
          hadNode = true;
        } else if (name === MORPH_SOURCE_LOCATION_ATTRIBUTE) {
          addressable = true;
        }
      }
      elements.push({ field, fieldPath, itemId, hadNode, addressable });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "leadingComments") continue;
      visit(value);
    }
  };
  visit(ast.program);
  void path;
  return elements;
}

function sameMarkers(a: ElementMarkers[], b: ElementMarkers[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index]!;
    return (
      left.field === right.field &&
      left.fieldPath === right.fieldPath &&
      left.itemId === right.itemId
    );
  });
}

function compile(content: string, path: string): string | null {
  const result = injectPreviewBindings([{ path, content }]);
  if (result.skipped.some((entry) => entry.path === path)) return null;
  return result.files.find((file) => file.path === path)?.content ?? null;
}

export type DerivableMarkerStrip = Readonly<{
  content: string;
  /** How many attributes were removed, for verification. */
  removed: number;
}>;

/**
 * The same file with every reproducible marker gone, or `null` to leave it be.
 *
 * `null` covers everything that is not provably safe — a file that does not
 * parse, one the compiler declines, one that would lose a binding, and one
 * that had nothing to remove in the first place. The caller writes only what
 * it is handed, so every one of those outcomes is the file staying as it is.
 */
export function stripDerivableMarkers(file: {
  path: string;
  content: string;
}): DerivableMarkerStrip | null {
  if (!JSX_FILE.test(file.path)) return null;
  if (
    !DERIVABLE_MARKER_ATTRIBUTES.some((name) => file.content.includes(name))
  ) {
    return null;
  }

  let ast: any;
  try {
    ast = parse(file.content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return null;
  }

  // Collected as byte ranges and cut from the back, so an earlier removal
  // never moves the offsets of one that has not been applied yet.
  const cuts: Array<{ start: number; end: number }> = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node.type === "JSXOpeningElement") {
      for (const attribute of node.attributes ?? []) {
        if (
          attribute?.type !== "JSXAttribute" ||
          attribute.name?.type !== "JSXIdentifier" ||
          !DERIVABLE.has(attribute.name.name) ||
          typeof attribute.start !== "number" ||
          typeof attribute.end !== "number"
        ) {
          continue;
        }
        cuts.push({ start: attribute.start, end: attribute.end });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "leadingComments") continue;
      visit(value);
    }
  };
  visit(ast.program);
  if (cuts.length === 0) return null;

  let next = file.content;
  for (const cut of [...cuts].sort((a, b) => b.start - a.start)) {
    // The whitespace in front of the attribute belongs to it: leaving it turns
    // `<p data-x="y"\n  className` into a line of trailing spaces.
    let start = cut.start;
    while (start > 0 && /[ \t]/.test(next[start - 1]!)) start -= 1;
    const before = next.slice(0, start);
    const after = next.slice(cut.end);
    // An attribute alone on its line takes the line with it.
    next =
      before.endsWith("\n") && after.startsWith("\n")
        ? before + after.slice(1)
        : before + after;
  }

  const beforeCompiled = compile(file.content, file.path);
  const afterCompiled = compile(next, file.path);
  if (beforeCompiled === null || afterCompiled === null) return null;

  const beforeMarkers = readEmittedMarkers(beforeCompiled, file.path);
  const afterMarkers = readEmittedMarkers(afterCompiled, file.path);
  if (beforeMarkers.length === 0) return null;
  if (!sameMarkers(beforeMarkers, afterMarkers)) return null;
  // An element named by hand must still be reachable by position, or the
  // Inspector would be able to select it and not able to edit it. Only those:
  // the compiler addresses host elements, and a component element never had a
  // position to lose. Read from before the strip, because that is the copy the
  // name still exists in; the two line up element for element.
  const stillAddressable = beforeMarkers.every(
    (element, index) =>
      !element.hadNode || (afterMarkers[index]?.addressable ?? false),
  );
  if (!stillAddressable) return null;

  return { content: next, removed: cuts.length };
}
