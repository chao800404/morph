import { parse } from "@babel/parser";
import { inferBoundPropName } from "./theme-field-binding";
import { parseColocatedContentFields } from "./theme-content-fields-source";
import { MORPH_SOURCE_LOCATION_ATTRIBUTE } from "@/lib/storefront/compiler/theme-source-location-plugin";

/**
 * Writes the editor's identity attributes into a Theme before a real React
 * preview renders it.
 *
 * The interpreter derives these while it evaluates: it is running the `.map()`
 * itself, so it knows which row it is on and which field an expression reads.
 * Real React runs the loop instead, and by the time anything reaches the DOM
 * that knowledge is gone. Naming it at compile time is what lets the editor
 * keep pointing at content while the preview stops pretending to be React.
 *
 * The Theme author still writes none of this, which is the rule this exists to
 * keep: the attributes are derived from the same expressions the interpreter
 * reads, by the same analysis, and a build emits none of them.
 *
 * Attributes are spliced in at the end of the tag name rather than the file
 * being regenerated. Everything the author wrote is therefore untouched —
 * their formatting, their comments, their JSX — and the only difference is the
 * text that had to be added.
 */

const FIELD_ATTRIBUTE = "data-storefront-field";
const FIELD_PATH_ATTRIBUTE = "data-storefront-field-path";
const ITEM_ID_ATTRIBUTE = "data-storefront-item-id";
const SECTION_ID_ATTRIBUTE = "data-storefront-section-id";
const SOURCE_FILE_ATTRIBUTE = "data-morph-source-file";

/**
 * Utilities that space children by counting them, and so notice a wrapper.
 *
 * `display: contents` takes the wrapper out of layout but not out of the
 * tree, so a rule written as `> * + *` starts matching the wrapper instead of
 * the section inside it and the spacing disappears. Worth saying out loud
 * where sections are arranged, because the symptom — gaps gone, nothing else
 * different — gives no hint of the cause.
 */
const CHILD_COUNTING_UTILITIES = /\b(space-[xy]-|divide-[xy])/;

/** Attributes whose bound expression identifies the element's content. */
const CONTENT_BEARING_ATTRIBUTES = ["src", "href", "to"];

export type PreviewBindingFile = Readonly<{ path: string; content: string }>;

export type PreviewBindingsResult = Readonly<{
  files: ReadonlyArray<{ path: string; content: string }>;
  /** How many elements each file gained identity for, for verification. */
  annotated: Readonly<Record<string, number>>;
  /** Slot ids given a section wrapper, per file. */
  sections: Readonly<Record<string, readonly string[]>>;
  skipped: ReadonlyArray<{ path: string; reason: string }>;
  /** Things that still work but will surprise the author. */
  warnings: ReadonlyArray<{ path: string; message: string }>;
}>;

type Insertion = { at: number; text: string };

/** One `.map()` callback's row and index variable names. */
type RowScope = Readonly<{ item: string | null; index: string | null }>;

const JSX_FILE = /\.(tsx|jsx)$/;

function isHostElement(name: any): boolean {
  // Lowercase names are DOM elements. A capitalised name is another component,
  // which annotates its own output where its own fields are in scope.
  return (
    name?.type === "JSXIdentifier" && /^[a-z][a-z0-9-]*$/.test(name.name ?? "")
  );
}

/**
 * Whether the author already wrote this attribute themselves.
 *
 * A hand-written marker exists precisely where the analysis cannot see — a
 * value routed through a local variable, say — so every injection checks
 * first. Overwriting one would undo the only thing making that element
 * editable.
 */
function hasAttribute(openingElement: any, attributeName: string): boolean {
  return (openingElement.attributes ?? []).some(
    (attribute: any) =>
      attribute?.type === "JSXAttribute" &&
      attribute.name?.type === "JSXIdentifier" &&
      attribute.name.name === attributeName,
  );
}

/**
 * The field one element shows, read the way the interpreter reads it: a lone
 * expression child first, then the attributes that carry content.
 */
function fieldForElement(node: any, rowItem: string | null): string | null {
  const meaningful = (node.children ?? []).filter(
    (child: any) =>
      !(child?.type === "JSXText" && String(child.value ?? "").trim() === ""),
  );
  if (
    meaningful.length === 1 &&
    meaningful[0]?.type === "JSXExpressionContainer"
  ) {
    const fromChild = inferBoundPropName(meaningful[0].expression, rowItem);
    if (fromChild) return fromChild;
  }

  for (const attribute of node.openingElement?.attributes ?? []) {
    if (
      attribute?.type !== "JSXAttribute" ||
      attribute.name?.type !== "JSXIdentifier" ||
      !CONTENT_BEARING_ATTRIBUTES.includes(attribute.name.name) ||
      attribute.value?.type !== "JSXExpressionContainer"
    ) {
      continue;
    }
    const fromAttribute = inferBoundPropName(
      attribute.value.expression,
      rowItem,
    );
    if (fromAttribute) return fromAttribute;
  }
  return null;
}

/**
 * The JSX element a `.map()` callback returns, which is the row itself.
 *
 * A row is what reordering moves, and it is addressed by a path ending at its
 * index — `items.2`, not `items.2.title`, which names a value inside it.
 */
function readRowElement(callback: any): any {
  const body = callback?.body;
  if (body?.type === "JSXElement") return body;
  if (body?.type !== "BlockStatement") return null;
  for (const statement of body.body ?? []) {
    if (
      statement.type === "ReturnStatement" &&
      statement.argument?.type === "JSXElement"
    ) {
      return statement.argument;
    }
  }
  return null;
}

/** `items.map((item, index) => …)` — the array path and the two binding names. */
function readMapCall(
  node: any,
): { arrayPath: string; rowElement: any; scope: RowScope } | null {
  if (
    node.type !== "CallExpression" &&
    node.type !== "OptionalCallExpression"
  ) {
    return null;
  }
  const callee = node.callee;
  if (
    (callee?.type !== "MemberExpression" &&
      callee?.type !== "OptionalMemberExpression") ||
    callee.computed ||
    callee.property?.name !== "map"
  ) {
    return null;
  }

  // Only a readable receiver names a path. `getItems().map(...)` is a value
  // this cannot address, so its rows stay unannotated rather than mislabelled.
  const steps: string[] = [];
  let receiver: any = callee.object;
  while (
    receiver?.type === "MemberExpression" ||
    receiver?.type === "OptionalMemberExpression"
  ) {
    if (receiver.computed || receiver.property?.type !== "Identifier") {
      return null;
    }
    steps.unshift(receiver.property.name);
    receiver = receiver.object;
  }
  if (receiver?.type !== "Identifier") return null;
  steps.unshift(receiver.name);

  const callback = node.arguments?.[0];
  if (
    callback?.type !== "ArrowFunctionExpression" &&
    callback?.type !== "FunctionExpression"
  ) {
    return null;
  }
  const [itemParam, indexParam] = callback.params ?? [];
  return {
    arrayPath: steps.join("."),
    rowElement: readRowElement(callback),
    scope: {
      item: itemParam?.type === "Identifier" ? itemParam.name : null,
      index: indexParam?.type === "Identifier" ? indexParam.name : null,
    },
  };
}

/**
 * Reads the field names a module declares, so nothing is marked editable that
 * the component never offered.
 *
 * The interpreter can check the values a component actually received; a
 * compiler cannot, and guessing would put fields in the Inspector that write
 * nowhere. The declaration is the one statement of intent available before
 * anything runs, and it is already required to be a static literal.
 */
function declaredFields(source: string): {
  top: ReadonlySet<string>;
  rows: ReadonlyMap<string, ReadonlySet<string>>;
} | null {
  const parsed = parseColocatedContentFields(source);
  if (parsed.declaration !== "valid" || !parsed.fields) return null;

  const top = new Set(Object.keys(parsed.fields));
  const rows = new Map<string, ReadonlySet<string>>();
  for (const [key, definition] of Object.entries(parsed.fields)) {
    const nested = (definition as { fields?: Record<string, unknown> }).fields;
    if (nested && typeof nested === "object") {
      rows.set(key, new Set(Object.keys(nested)));
    }
  }
  return { top, rows };
}

/**
 * The content slot a component is rendered for, read at the call site.
 *
 * A component cannot say which section it is — the same one can be placed
 * twice on a page — so the only place the answer exists is where its content
 * is handed to it: `<Hero {...content("starter-hero")} />`.
 */
function readSectionSlotId(openingElement: any): string | null {
  for (const attribute of openingElement?.attributes ?? []) {
    if (attribute?.type !== "JSXSpreadAttribute") continue;
    const call = attribute.argument;
    if (
      call?.type !== "CallExpression" ||
      call.callee?.type !== "Identifier" ||
      call.callee.name !== "content" ||
      call.arguments?.length !== 1 ||
      call.arguments[0]?.type !== "StringLiteral"
    ) {
      continue;
    }
    const slotId = call.arguments[0].value;
    return typeof slotId === "string" && slotId.length > 0 ? slotId : null;
  }
  return null;
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

export function injectPreviewBindings(
  files: readonly PreviewBindingFile[],
): PreviewBindingsResult {
  const annotated: Record<string, number> = {};
  const sections: Record<string, readonly string[]> = {};
  const skipped: Array<{ path: string; reason: string }> = [];
  const warnings: Array<{ path: string; message: string }> = [];

  const out = files.map((file) => {
    if (!JSX_FILE.test(file.path)) return file;

    let ast: any;
    try {
      ast = parse(file.content, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });
    } catch {
      // The author's own error to see and fix. Annotating a guess at what they
      // meant would only change which error they get.
      skipped.push({ path: file.path, reason: "Source could not be parsed." });
      return file;
    }

    const declared = declaredFields(file.content);
    const insertions: Insertion[] = [];
    const slotIds: string[] = [];
    let count = 0;

    const visit = (
      node: any,
      arrayPath: string | null,
      scope: RowScope,
      insideJsx = false,
    ) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child, arrayPath, scope, insideJsx);
        return;
      }
      if (typeof node.type !== "string") return;

      const mapCall = readMapCall(node);
      if (mapCall) {
        const row = mapCall.rowElement;
        const rowIndex = mapCall.scope.index;
        if (row && rowIndex && row.start != null && row.end != null) {
          const path = `${mapCall.arrayPath}.\${${rowIndex}}`;
          const attributes =
            ` ${FIELD_ATTRIBUTE}="${escapeAttribute(mapCall.arrayPath)}"` +
            ` ${FIELD_PATH_ATTRIBUTE}={\`${path}\`}` +
            (mapCall.scope.item
              ? ` ${ITEM_ID_ATTRIBUTE}={${mapCall.scope.item}?.id}`
              : "");
          if (isHostElement(row.openingElement?.name)) {
            if (!hasAttribute(row.openingElement, FIELD_PATH_ATTRIBUTE)) {
              insertions.push({
                at: row.openingElement.name.end,
                text: attributes,
              });
            }
          } else {
            // The row is a component, and an attribute put on one becomes a
            // prop it is free to ignore — it would never reach the page. Same
            // answer as a section: wrap it in something taken out of layout.
            insertions.push({
              at: row.start,
              text: `<div${attributes} style={{ display: "contents" }}>`,
            });
            insertions.push({ at: row.end, text: "</div>" });
          }
        }
        // Rows of an array field are addressed by the array they came from,
        // so the callback body is walked with that path in hand.
        for (const [key, value] of Object.entries(node)) {
          if (key === "loc" || key === "leadingComments") continue;
          visit(value, mapCall.arrayPath, mapCall.scope, insideJsx);
        }
        return;
      }

      if (node.type === "JSXElement") {
        const opening = node.openingElement;

        // A section is wrapped rather than marked, because the mark belongs on
        // a component's element and an attribute put there becomes a prop the
        // component is free to ignore — it would never reach the page. The
        // wrapper is taken out of layout so the page looks the same.
        const slotId = readSectionSlotId(opening);
        if (slotId && node.start != null && node.end != null) {
          slotIds.push(slotId);
          insertions.push({
            at: node.start,
            text: `<div ${SECTION_ID_ATTRIBUTE}="${escapeAttribute(slotId)}" style={{ display: "contents" }}>`,
          });
          insertions.push({ at: node.end, text: "</div>" });
        }

        if (isHostElement(opening?.name)) {
          const parts: string[] = [];
          // Which file a reorder among these siblings would rewrite. The
          // outermost element of a file is where that answer changes, so it
          // is the one place worth stating it — everything below finds it by
          // looking up, exactly as the interpreter's own marking is found.
          if (!insideJsx && !hasAttribute(opening, SOURCE_FILE_ATTRIBUTE)) {
            parts.push(
              ` ${SOURCE_FILE_ATTRIBUTE}="${escapeAttribute(file.path)}"`,
            );
          }
          const position = opening.name.loc?.start;
          if (
            position &&
            !hasAttribute(opening, MORPH_SOURCE_LOCATION_ATTRIBUTE)
          ) {
            parts.push(
              ` ${MORPH_SOURCE_LOCATION_ATTRIBUTE}="${escapeAttribute(
                `${file.path}:${position.line}:${position.column + 1}`,
              )}"`,
            );
          }

          const field = fieldForElement(node, arrayPath ? scope.item : null);
          const allowed = declared
            ? arrayPath
              ? (declared.rows.get(arrayPath)?.has(field ?? "") ?? false)
              : declared.top.has(field ?? "")
            : false;

          if (field && allowed && !hasAttribute(opening, FIELD_ATTRIBUTE)) {
            parts.push(` ${FIELD_ATTRIBUTE}="${escapeAttribute(field)}"`);
          }
          if (
            field &&
            allowed &&
            arrayPath &&
            scope.index &&
            !hasAttribute(opening, FIELD_PATH_ATTRIBUTE)
          ) {
            // A template expression, not a literal: the index is only known
            // once React runs the loop this element came out of.
            parts.push(
              ` ${FIELD_PATH_ATTRIBUTE}={\`${arrayPath}.\${${scope.index}}.${field}\`}`,
            );
          }
          if (
            arrayPath &&
            scope.item &&
            !hasAttribute(opening, ITEM_ID_ATTRIBUTE)
          ) {
            // Identity that survives a reorder, which the index cannot.
            parts.push(` ${ITEM_ID_ATTRIBUTE}={${scope.item}?.id}`);
          }

          if (parts.length > 0) {
            insertions.push({ at: opening.name.end, text: parts.join("") });
            count += 1;
          }
        }
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === "loc" || key === "leadingComments") continue;
        visit(value, arrayPath, scope, insideJsx || node.type === "JSXElement");
      }
    };

    visit(ast.program.body, null, { item: null, index: null });

    if (slotIds.length > 0 && CHILD_COUNTING_UTILITIES.test(file.content)) {
      warnings.push({
        path: file.path,
        message:
          "Sections here are spaced by a utility that counts children (space-y, space-x or divide). The Live Preview wraps each section, which such a rule notices, so the gaps will be missing in the preview but present in the build. Give each section its own padding instead — which also keeps the spacing correct when one is hidden or reordered.",
      });
    }

    sections[file.path] = slotIds;
    if (insertions.length === 0) return file;

    // Applied last-first so an earlier offset is never shifted by a later one.
    insertions.sort((a, b) => b.at - a.at);
    let content = file.content;
    for (const insertion of insertions) {
      content =
        content.slice(0, insertion.at) +
        insertion.text +
        content.slice(insertion.at);
    }
    annotated[file.path] = count;
    return { path: file.path, content };
  });

  return { files: out, annotated, sections, skipped, warnings };
}
