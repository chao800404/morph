/**
 * Domain-only description of the controls that can be exposed by the style
 * inspector.  This module intentionally has no React or persistence
 * dependencies; the editor shell can use the result to compose its UI.
 */

export const INSPECTOR_MODULE_IDS = [
  "content",
  "media",
  "typography",
  "layout",
  "spacing",
  "sizing",
  "position",
  "appearance",
  "fill",
  "border",
  "effects",
  "interaction",
  "source-style",
] as const;

export type InspectorModuleId = (typeof INSPECTOR_MODULE_IDS)[number];

export type InspectorOverride = unknown;

export type InspectorSelectionContext = {
  readonly kind?: string;
  readonly selectionKind?: string;
  readonly isSection?: boolean;
  readonly tagName?: string;
  readonly role?: string;
  readonly inputType?: string;
  readonly computedStyle?: Readonly<Record<string, string | undefined>>;
  readonly parentComputedStyle?: Readonly<Record<string, string | undefined>>;
  readonly sourceEditability?: {
    readonly className?: boolean;
    readonly style?: boolean;
    readonly dynamic?: boolean;
  };
  readonly contentFieldBinding?: string | boolean | null;
  readonly override?: InspectorOverride;
};

const MODULE_SET = new Set<string>(INSPECTOR_MODULE_IDS);

function isModuleId(value: unknown): value is InspectorModuleId {
  return typeof value === "string" && MODULE_SET.has(value);
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function styleValue(
  styles: Readonly<Record<string, string | undefined>> | undefined,
  key: string,
): string {
  return normalized(styles?.[key]);
}

function hasContentBinding(binding: InspectorSelectionContext["contentFieldBinding"]): boolean {
  return typeof binding === "string" ? binding.trim().length > 0 : binding === true;
}

function moduleList(value: unknown): InspectorModuleId[] {
  if (typeof value === "string") {
    const normalizedValue = value.trim();
    if (!normalizedValue) return [];
    if (normalizedValue.startsWith("[")) {
      try {
        return moduleList(JSON.parse(normalizedValue));
      } catch {
        return [];
      }
    }
    return normalizedValue.split(/[\s,]+/).filter(isModuleId);
  }
  return Array.isArray(value) ? value.filter(isModuleId) : [];
}

function overrideRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Resolve modules in stable UI order. Explicit overrides use include/exclude
 * semantics: includes add allowlisted modules, excludes remove them. A plain
 * array is treated as an include list, which is useful for deliberately
 * constrained block profiles.
 */
export function resolveInspectorModules(
  context: InspectorSelectionContext,
): InspectorModuleId[] {
  const tag = normalized(context.tagName);
  const role = normalized(context.role);
  const kind = normalized(context.selectionKind ?? context.kind);
   const style = context.computedStyle;
  const parentStyle = context.parentComputedStyle;
  const display = styleValue(style, "display");
  const parentDisplay = styleValue(parentStyle, "display");
  const isMedia = ["img", "image", "video", "audio", "svg", "picture", "iframe"].includes(tag) ||
    ["image", "media"].includes(kind) || role === "img";
  const isText = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label", "blockquote", "code", "pre", "text"].includes(tag) ||
    ["heading", "text", "paragraph", "rich-text", "label", "blockquote", "code"].includes(kind);
  const isInteractive = ["a", "button", "input", "select", "textarea", "option"].includes(tag) ||
    ["button", "link", "input", "form-control"].includes(kind) ||
    ["button", "link", "textbox", "checkbox", "radio", "switch"].includes(role);
  const isContainer = context.isSection === true ||
    ["div", "section", "main", "article", "header", "footer", "nav", "form", "container", "section"].includes(tag) ||
    ["container", "section", "block"].includes(kind);
  const isFlexOrGridParent = ["flex", "inline-flex", "grid", "inline-grid"].includes(parentDisplay);
  const source = context.sourceEditability;
  const dynamicSource = source?.dynamic === true;

  const modules: InspectorModuleId[] = [];
  const add = (...ids: InspectorModuleId[]) => {
    for (const id of ids) if (!modules.includes(id)) modules.push(id);
  };

  if (context.isSection === true || hasContentBinding(context.contentFieldBinding) || isText || isInteractive) add("content");
  if (isMedia) add("media");
  if (context.isSection === true || isText) add("typography");
  if (isContainer || isFlexOrGridParent || display === "flex" || display === "grid") add("layout");
  add("sizing", "spacing");
  add("position");
  add("appearance");
  if (
    isMedia ||
    isContainer ||
    isText ||
    styleValue(style, "backgroundColor") !== "" ||
    styleValue(style, "backgroundImage") !== ""
  ) {
    add("fill");
  }
  add("border", "effects");
  if (isInteractive) add("interaction");
  // No `accessibility` module, deliberately, and this is where it used to be
  // added — for `img`, the form controls and `role="img"`.
  //
  // Its controls would write JSX attributes: `aria-label`, `role`. That is a
  // third kind of write, next to the class list and the content fields, and
  // nothing in the AST layer performs it — `patchTailwindClasses`,
  // `patchElementClassName`, `patchComponentDefaultProp` and
  // `patchThemeLinkElement` are the whole set, and the last is a single-purpose
  // writer that finds its target by fieldKey. Building a second one shaped by
  // `aria-label` alone would repeat that.
  //
  // The vocabulary does not list it either. An id the resolver can never add is
  // a word for a control that does not exist, and a module that resolves and
  // renders nothing is the same claim one layer down: both describe a
  // capability the author does not have. Authors are not without it — Code mode
  // edits these attributes today — so what is missing is Inspector coverage,
  // not the ability.
  //
  // The path this needs is generic attribute authoring, and the list that
  // should shape it is longer than a11y: `loading`, `width`, `height` and
  // `decoding` on images, `type`, `placeholder`, `required`, `name` and
  // `autocomplete` on form controls, `target` and `rel` on links. It writes
  // customer source, so it also needs source-location targeting, refusal on
  // dynamic values, and the CAS and `sourceGeneration` protections. That is its
  // own round. When it lands, `accessibility` returns as a thin card — with
  // `alt` excluded, since that is a content field `commitImageAlt` already
  // owns.
  if (source?.className === true || source?.style === true) {
    if (!dynamicSource) add("source-style");
  }

  if (context.override !== undefined) {
    const override = context.override;
    if (Array.isArray(override) || typeof override === "string") {
      return [...new Set(moduleList(override))];
    }
    const record = overrideRecord(override);
    for (const value of moduleList(record?.include)) add(value);
    for (const value of moduleList(record?.exclude)) {
      const index = modules.indexOf(value);
      if (index >= 0) modules.splice(index, 1);
    }
  }

  return modules;
}
