import type { InspectorOverride } from "./inspector-modules";

export const SELECTION_KINDS = [
  "root",
  "section",
  "container",
  "layout",
  "component",
  "repeater",
  "heading",
  "paragraph",
  "text",
  "rich-text",
  "label",
  "blockquote",
  "code",
  "link",
  "button",
  "navigation",
  "details",
  "summary",
  "image",
  "picture",
  "icon",
  "svg",
  "video",
  "audio",
  "canvas",
  "iframe",
  "embed",
  "map",
  "form",
  "fieldset",
  "input",
  "textarea",
  "select",
  "option",
  "checkbox",
  "radio",
  "switch",
  "file-input",
  "list",
  "list-item",
  "table",
  "table-section",
  "table-row",
  "table-cell",
  "product",
  "collection",
  "price",
  "cart",
  "divider",
  "spacer",
  "custom",
] as const;

export type SelectionKind = (typeof SELECTION_KINDS)[number];

export function isSelectionKind(value: string): value is SelectionKind {
  return (SELECTION_KINDS as readonly string[]).includes(value);
}

export type SelectionCapabilities = {
  content: boolean;
  typography: boolean;
  media: boolean;
  interactive: boolean;
  form: boolean;
  layout: boolean;
  spacing: boolean;
  background: boolean;
  border: boolean;
  advanced: boolean;
};

export type EditableDescendantField = Readonly<{
  fieldKey: string;
  fieldPath: string | null;
  /**
   * Section the field belongs to.
   *
   * A parent can span several components, and two instances of one component
   * expose the same field names. Without saying which section a field came
   * from, editing one would write to whichever the selection happened to name.
   */
  sectionId: string | null;
}>;

/**
 * Why a selected element offers no content to edit, when the preview can say.
 *
 * Each names something the editor does not support yet, not something the
 * Theme did wrong: the code runs, previews and builds as written. What it
 * stops is a visual write whose destination the editor cannot confirm.
 *
 * - `value-not-from-row`: inside a list's row, the component shows a value
 *   the list set from something other than that row's field — a literal, a
 *   computed value, or a spread of another object.
 * - `row-not-passed`: the row's component is written in a way the editor
 *   cannot yet hand its row to (it takes `props` whole, or is wrapped in
 *   `memo()` or another call), so its fields cannot be tied to the row.
 * - `nested-list`: a list the row's component keeps of its own; a row holds
 *   no list in the content model yet.
 */
export const CONTENT_UNAVAILABLE_REASONS = [
  "value-not-from-row",
  "row-not-passed",
  "nested-list",
] as const;
export type ContentUnavailableReason =
  (typeof CONTENT_UNAVAILABLE_REASONS)[number];

export function isContentUnavailableReason(
  value: unknown,
): value is ContentUnavailableReason {
  return (
    typeof value === "string" &&
    (CONTENT_UNAVAILABLE_REASONS as readonly string[]).includes(value)
  );
}

export type EditorSelectionDescriptor = {
  sectionId: string;
  /**
   * The `id` of the repeated-field row the element belongs to, when it is in
   * one: what confirms the row before a write, since its index can move.
   */
  itemId?: string | null;
  /** Why the element offers no content, when the preview could tell. */
  contentUnavailable?: ContentUnavailableReason | null;
  kind: SelectionKind;
  componentType: string;
  tagName: string | null;
  role: string | null;
  inputType: string | null;
  nodeId: string | null;
  sourceFilePath: string | null;
  /** `file:line:column` of the selected element, when the preview supplied it. */
  sourceLocation?: string | null;
  elementKey: string | null;
  fieldKey: string | null;
  fieldPath: string | null;
  descendantFields?: readonly EditableDescendantField[];
  className: string;
  isSection: boolean;
  computed: Record<string, string> | null;
  parentComputed: Record<string, string> | null;
  sectionComputed: Record<string, string> | null;
  inspectorOverride: InspectorOverride;
};

const TEXT_KINDS = new Set<SelectionKind>([
  "heading",
  "paragraph",
  "text",
  "rich-text",
  "label",
  "blockquote",
  "code",
]);
const MEDIA_KINDS = new Set<SelectionKind>([
  "image",
  "picture",
  "icon",
  "svg",
  "video",
  "audio",
  "canvas",
  "iframe",
  "embed",
  "map",
]);
const FORM_KINDS = new Set<SelectionKind>([
  "form",
  "fieldset",
  "input",
  "textarea",
  "select",
  "option",
  "checkbox",
  "radio",
  "switch",
  "file-input",
]);

export function selectionKindFromElement(input: {
  component?: string | null;
  morphElement?: string | null;
  tagName?: string | null;
  role?: string | null;
  inputType?: string | null;
  isSection?: boolean;
}): SelectionKind {
  const explicit = (input.morphElement ?? input.component ?? "").toLowerCase();
  if (input.isSection) return "section";
  if ((SELECTION_KINDS as readonly string[]).includes(explicit))
    return explicit as SelectionKind;
  const tag = (input.tagName ?? "").toLowerCase();
  const role = (input.role ?? "").toLowerCase();
  const type = (input.inputType ?? "").toLowerCase();
  if (
    tag === "h1" ||
    tag === "h2" ||
    tag === "h3" ||
    tag === "h4" ||
    tag === "h5" ||
    tag === "h6" ||
    role === "heading"
  )
    return "heading";
  if (tag === "p") return "paragraph";
  if (tag === "blockquote") return "blockquote";
  if (tag === "code" || tag === "pre") return "code";
  if (tag === "a" || role === "link") return "link";
  if (tag === "button" || role === "button") return "button";
  if (tag === "nav" || role === "navigation") return "navigation";
  if (tag === "details" || role === "group") return "details";
  if (tag === "summary") return "summary";
  if (tag === "img" || role === "img") return "image";
  if (tag === "picture") return "picture";
  if (tag === "svg") return "svg";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "canvas") return "canvas";
  if (tag === "iframe") return "iframe";
  if (tag === "embed") return "embed";
  if (tag === "object") return "embed";
  if (tag === "map" || role === "img") return "map";
  if (tag === "form") return "form";
  if (tag === "fieldset") return "fieldset";
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (tag === "option") return "option";
  if (tag === "input")
    return type === "checkbox"
      ? "checkbox"
      : type === "radio"
        ? "radio"
        : type === "file"
          ? "file-input"
          : "input";
  if (role === "checkbox") return "checkbox";
  if (role === "radio") return "radio";
  if (role === "switch") return "switch";
  if (role === "textbox") return tag === "textarea" ? "textarea" : "input";
  if (role === "listbox") return "select";
  if (role === "option") return "option";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "li") return "list-item";
  if (tag === "table") return "table";
  if (tag === "thead" || tag === "tbody" || tag === "tfoot")
    return "table-section";
  if (tag === "tr") return "table-row";
  if (tag === "td" || tag === "th") return "table-cell";
  if (tag === "hr") return "divider";
  return explicit === "" ? "custom" : "component";
}

export function capabilitiesForSelection(
  kind: SelectionKind,
  isSection = false,
): SelectionCapabilities {
  const text = TEXT_KINDS.has(kind);
  const media = MEDIA_KINDS.has(kind);
  const form = FORM_KINDS.has(kind);
  const interactive = [
    "link",
    "button",
    "navigation",
    "details",
    "summary",
    "cart",
  ].includes(kind);
  return {
    content:
      isSection ||
      text ||
      media ||
      interactive ||
      form ||
      ["product", "collection", "price", "repeater", "list-item"].includes(
        kind,
      ),
    typography:
      isSection ||
      text ||
      [
        "link",
        "button",
        "label",
        "input",
        "textarea",
        "select",
        "option",
      ].includes(kind),
    media,
    interactive,
    form,
    layout:
      isSection ||
      [
        "root",
        "container",
        "layout",
        "component",
        "repeater",
        "list",
        "table",
        "table-section",
      ].includes(kind),
    spacing: true,
    background: true,
    border: true,
    advanced: true,
  };
}

export function getFieldPathValue(
  value: unknown,
  path: string | null | undefined,
): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    return typeof current === "object"
      ? (current as Record<string | number, unknown>)[key]
      : undefined;
  }, value);
}

export function setFieldPathValue<T>(value: T, path: string, next: unknown): T {
  const segments = path.split(".");
  if (!segments.length || !path) return next as T;
  const isIndex = (segment: string | undefined) =>
    segment !== undefined && /^\d+$/.test(segment);
  /**
   * Copies a container, creating one when nothing is there yet.
   *
   * The segment that follows decides the shape of what is created: a numeric
   * one addresses a list. Creating an object for it produced `{"0": {…}}`,
   * which reads back as a record keyed by "0" rather than a list — the server
   * then refused the write as not matching the declared field, and the only
   * way to hit it was editing a repeated field that had no stored value yet.
   */
  const clone = (input: unknown, nextSegment?: string): unknown =>
    Array.isArray(input)
      ? [...input]
      : input && typeof input === "object"
        ? { ...(input as Record<string, unknown>) }
        : isIndex(nextSegment)
          ? []
          : {};
  const root = clone(value, segments[0]) as Record<string, unknown> & unknown[];
  let cursor: Record<string, unknown> & unknown[] = root;
  segments.forEach((segment, index) => {
    const key = isIndex(segment) ? Number(segment) : segment;
    if (index === segments.length - 1) {
      cursor[key] = next;
      return;
    }
    const child = clone(cursor[key], segments[index + 1]);
    cursor[key] = child;
    cursor = child as Record<string, unknown> & unknown[];
  });
  return root as T;
}
