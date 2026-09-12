import { parse } from "@babel/parser";

/**
 * Removes the editor's own attributes from the Theme a build compiles.
 *
 * They earn their place in the editor: a hand-written marker is what makes a
 * field editable when the binding is too indirect to read, and the compiler
 * adds more so a preview can be pointed at. None of it means anything to a
 * shopper. Shipped, it is bytes nobody uses and a description of the Theme's
 * own source published on every page.
 *
 * The Theme's stored source keeps them, because that is where they are doing
 * the job. Only the copy a build compiles is stripped — the mirror image of
 * the preview, which is the only copy that gets them added.
 *
 * Attributes are blanked rather than cut out, so every line, column and byte
 * offset still matches the file the author saved and a diagnostic that points
 * into the build points at the right place.
 */

/**
 * Attributes that exist for the editor and for nothing else.
 *
 * Deliberately a list rather than a `data-morph-*` pattern: a Theme author is
 * free to invent their own data attributes, and a build silently dropping one
 * of theirs would be a far worse bug than shipping a few of ours.
 */
export const EDITOR_ONLY_ATTRIBUTES: readonly string[] = [
  "data-morph-element",
  "data-morph-inspector",
  "data-morph-loc",
  "data-morph-node",
  "data-morph-section",
  "data-morph-source-file",
  "data-storefront-field",
  "data-storefront-field-path",
  "data-storefront-item-id",
];

const EDITOR_ONLY = new Set(EDITOR_ONLY_ATTRIBUTES);
const JSX_FILE = /\.(tsx|jsx)$/;

export type StripEditorMarkersResult = Readonly<{
  files: ReadonlyArray<{ path: string; content: string }>;
  /** How many attributes each file lost, for verification. */
  stripped: Readonly<Record<string, number>>;
}>;

export function stripEditorMarkers(
  files: readonly { path: string; content: string }[],
): StripEditorMarkersResult {
  const stripped: Record<string, number> = {};

  const out = files.map((file) => {
    if (!JSX_FILE.test(file.path)) return file;
    if (!EDITOR_ONLY_ATTRIBUTES.some((name) => file.content.includes(name))) {
      return file;
    }

    let ast: any;
    try {
      ast = parse(file.content, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });
    } catch {
      // The author's own error, and theirs to see from the build. Guessing at
      // what they meant would only change which error they get.
      return file;
    }

    const spans: Array<{ start: number; end: number }> = [];
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (typeof node.type !== "string") return;
      if (
        node.type === "JSXAttribute" &&
        node.name?.type === "JSXIdentifier" &&
        EDITOR_ONLY.has(node.name.name) &&
        node.start != null &&
        node.end != null
      ) {
        spans.push({ start: node.start, end: node.end });
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "loc" || key === "leadingComments") continue;
        visit(value);
      }
    };
    visit(ast.program.body);
    if (spans.length === 0) return file;

    let content = file.content;
    for (const span of spans.sort((a, b) => b.start - a.start)) {
      content =
        content.slice(0, span.start) +
        " ".repeat(span.end - span.start) +
        content.slice(span.end);
    }
    stripped[file.path] = spans.length;
    return { path: file.path, content };
  });

  return { files: out, stripped };
}
