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
}>;

export type EditorSelectionDescriptor = {
  sectionId: string;
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
  contentValue?: string | null;
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
  const clone = (input: unknown): unknown =>
    Array.isArray(input)
      ? [...input]
      : input && typeof input === "object"
        ? { ...(input as Record<string, unknown>) }
        : {};
  const root = clone(value) as Record<string, unknown> & unknown[];
  let cursor: Record<string, unknown> & unknown[] = root;
  segments.forEach((segment, index) => {
    const key = /^\d+$/.test(segment) ? Number(segment) : segment;
    if (index === segments.length - 1) {
      cursor[key] = next;
      return;
    }
    const child = clone(cursor[key]);
    cursor[key] = child;
    cursor = child as Record<string, unknown> & unknown[];
  });
  return root as T;
}
