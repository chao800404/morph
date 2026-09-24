import {
  isSelectionKind,
  type EditableDescendantField,
  type SelectionKind,
} from "./selection-taxonomy";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { JsonValue } from "@/db/json";
import {
  isPreviewSpacingOverlayMode,
  type PreviewSpacingOverlayMode,
} from "./spacing-overlay";

export type { PreviewSpacingOverlayMode } from "./spacing-overlay";

export type PreviewSectionProps =
  StorefrontPageDocument["sections"][number]["props"];

export type PreviewCatalogResponseBody = JsonValue;

const MAX_PREVIEW_CATALOG_RESPONSE_CHARS = 16 * 1024 * 1024;

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return (
      value.length <= 1_000 &&
      value.every((item) => isJsonValue(item, depth + 1))
    );
  }
  if (!isRecord(value) || Object.keys(value).length > 1_000) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isBoundedCatalogResponseBody(
  value: unknown,
): value is PreviewCatalogResponseBody {
  if (!isJsonValue(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_PREVIEW_CATALOG_RESPONSE_CHARS;
  } catch {
    return false;
  }
}

export function parsePreviewSectionProps(
  value: unknown,
): PreviewSectionProps | null {
  if (!isRecord(value) || !isJsonValue(value)) return null;
  return value;
}

/**
 * Applies one live content edit to the previewed document.
 *
 * Reports whether the section was found rather than only returning a document.
 * A `map` that matches nothing is indistinguishable from one that matched and
 * changed nothing, so an edit addressed to a section the preview does not hold
 * was dropped in silence — the canvas kept the old content while the panel
 * showed the new, and nothing anywhere said so.
 */
export function applyPreviewSectionProps<
  TDocument extends {
    sections: readonly {
      id: string;
      enabled?: boolean;
      props?: Record<string, unknown> | null;
    }[];
  },
>(
  document: TDocument,
  update: {
    sectionId: string;
    props?: PreviewSectionProps;
    enabled?: boolean;
  },
): { document: TDocument; matched: boolean } {
  let matched = false;
  const sections = document.sections.map((section) => {
    if (section.id !== update.sectionId) return section;
    matched = true;
    return {
      ...section,
      enabled:
        typeof update.enabled === "boolean" ? update.enabled : section.enabled,
      props: { ...(section.props ?? {}), ...(update.props ?? {}) },
    };
  });
  return matched
    ? { document: { ...document, sections }, matched }
    : { document, matched };
}

export type PreviewThemeFile = {
  path: string;
  content: string;
};

export type PreviewMessageChannel = Readonly<{
  targetOrigin: string;
  previewSession: string;
}>;

export type PreviewMessageEventSecurity = Readonly<{
  expectedOrigin: string;
  expectedSource: MessageEventSource | null;
  previewSession: string;
}>;

export type PreviewStyleSnapshot = Readonly<{
  fontSize: string;
  lineHeight: string;
  fontFamily: string;
  fontWeight: string;
  textAlign: string;
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
  color: string;
  backgroundColor: string;
  backgroundImage: string;
  borderRadius: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  borderTopWidth: string;
  borderTopStyle: string;
  borderTopColor: string;
  display: string;
  flexDirection: string;
  gap: string;
  width: string;
  height: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  boxSizing: string;
  position: string;
  top: string;
  left: string;
  zIndex: string;
  opacity: string;
  overflow: string;
  transform: string;
  alignItems: string;
  justifyContent: string;
}>;

export type PreviewSelectionRestoreTarget = Readonly<{
  sectionId: string;
  /** Compile-time source position, present when the build annotated it. */
  sourceLocation?: string;
  /**
   * An authored HTML id, and only when it is unique in the document.
   *
   * Preferred over a source position because it survives edits above the
   * element, which a position does not. Never the only identity carried: an
   * author is free to change or delete the id, and the same `id` written on a
   * component is a prop it may not pass on — so the position stays alongside
   * it as what the editor falls back to.
   */
  htmlId?: string;
  nodeId?: string;
  fieldPath?: string;
  elementKey?: string;
  fieldKey?: string;
  isSection?: boolean;
}>;

export type PreviewEditableNode = Readonly<{
  id: string;
  parentId: string | null;
  sectionId: string;
  label: string;
  kind: SelectionKind;
  tagName: string | null;
  /** Authored HTML id, when the element has one. Display metadata only. */
  htmlId?: string;
  /**
   * Identity that survives edits to the file, when the element has one.
   *
   * Only such an element can carry a style bound to one instance, so which
   * elements have one is worth showing — but not as the label. A
   * platform-written identity reads as `el-a3f9c2b4d1e0`, which names nothing;
   * putting it where "Heading" goes would make the tree unreadable.
   */
  stableId?: string;
  target: PreviewSelectionRestoreTarget;
}>;

export type EditorToPreviewMessage =
  | {
      /**
       * Liveness probe for a preview that was ready once but may have lost its
       * sandbox port. The response is deliberately a separate message rather
       * than reusing `ready`, so readiness remains tied to document startup.
       */
      type: "morph:storefront-preview-ping";
      heartbeatId: number;
    }
  | {
      type: "morph:storefront-preview-request-size";
      /** Monotonically increasing request identity used to reject stale layout. */
      measurementRevision: number;
    }
  | { type: "morph:storefront-preview-request-structure" }
  | {
      type: "morph:storefront-preview-request-selection-style";
      styleRevision?: number;
    }
  | {
      type: "morph:storefront-preview-set-selection-mode";
      enabled: boolean;
      restoreTarget?: PreviewSelectionRestoreTarget;
      /** Monotonically increasing editor intent, used to reject stale replies. */
      selectionRevision?: number;
    }
  | {
      type: "morph:storefront-preview-set-spacing-overlay";
      mode: PreviewSpacingOverlayMode;
    }
  | { type: "morph:storefront-preview-set-viewport-height"; height: number }
  | {
      type: "morph:storefront-preview-set-route";
      templateId: string;
      /** null keeps the template renderer active when no source route is selected. */
      routePath: string | null;
    }
  | {
      type: "morph:storefront-preview-set-section";
      sectionId: string | null;
      /** Preserve the editor's current selection while the route context changes. */
      restoreTarget?: PreviewSelectionRestoreTarget;
      /** Monotonically increasing selection intent used to reject stale replies. */
      selectionRevision?: number;
    }
  | {
      type: "morph:storefront-preview-set-selection-field-path";
      sectionId: string;
      fieldPath: string;
    }
  | { type: "morph:storefront-preview-set-section-order"; sectionIds: string[] }
  | {
      type: "morph:storefront-preview-update-section-props";
      sectionId: string;
      props?: PreviewSectionProps;
      enabled?: boolean;
    }
  | {
      type: "morph:storefront-preview-update-theme-files";
      files: PreviewThemeFile[];
      styleRevision: number;
      sourceGeneration?: number;
      /**
       * Style-only updates compile CSS without replacing the rendered Theme
       * tree. The selected element already carries the final value inline.
       */
      renderDocument?: boolean;
    }
  | {
      /** The sandbox finished writing this source revision. */
      type: "morph:storefront-preview-theme-files-written";
      styleRevision: number;
    }
  | {
      /** Authenticated public catalog DTO returned for a preview loader. */
      type: "morph:storefront-preview-catalog-response";
      requestId: number;
      ok: boolean;
      status: number;
      body: JsonValue;
    }
  | {
      type: "morph:storefront-preview-update-selection-style";
      styles: Record<string, string>;
      targetElement: string;
      /**
       * `file:line:column` of the element being restyled.
       *
       * `targetElement` is the AST patch key, which for an unmarked element is
       * only `line:column` and matches no DOM attribute. The full position is
       * what lets the preview find the element for live feedback.
       */
      sourceLocation?: string | null;
    }
  | { type: "morph:storefront-preview-reset-selection-style-preview" }
  | {
      type: "morph:storefront-preview-update-selection-field";
      fieldKey: string;
      fieldPath: string | null;
      value: string;
    };

export type PreviewSelectionMessage = {
  type: "morph:storefront-preview-select-section";
  sectionId: string;
  componentType: string;
  kind: SelectionKind;
  nodeId?: string;
  sourceFilePath: string | null;
  /** `file:line:column`, present when the preview could annotate the element. */
  sourceLocation?: string | null;
  elementKey: string | null;
  fieldKey: string | null;
  field: string | null;
  fieldPath: string | null;
  contentValue?: string | null;
  /** Monotonically increasing editor intent, used to reject stale replies. */
  selectionRevision?: number;
  descendantFields: readonly EditableDescendantField[];
  tagName: string;
  role: string | null;
  inputType: string | null;
  styleRevision: number;
  className: string;
  isSection: boolean;
  inspectorOverride: string | null;
  computedStyle: PreviewStyleSnapshot | null;
  parentComputedStyle: PreviewStyleSnapshot | null;
  sectionComputedStyle: PreviewStyleSnapshot | null;
  /**
   * Where the element sits in the preview document, in its own CSS pixels.
   *
   * The editor cannot measure it: the preview is a cross-origin frame, and it
   * is rendered at full height inside a canvas that pans by transform rather
   * than scrolling, so there is no scroll position to read either. Reported so
   * a selection made in the tree can be brought into view.
   */
  documentRect?: { top: number; height: number } | null;
};

/** A resource the preview page asked for and did not get. */
export type PreviewResourceFailure = Readonly<{ path: string; status: number }>;

export type PreviewToEditorMessage =
  | { type: "morph:storefront-preview-ready" }
  | {
      /**
       * Why a preview page may never announce itself.
       *
       * Sent by a classic script that runs before either module graph, because
       * a module that fails to load stops its whole graph — including the
       * bridge that would otherwise say so — and the editor is left waiting
       * out its timeout with nothing to show for it. Observation only.
       */
      type: "morph:storefront-preview-diagnostic";
      kind: "script-failed" | "load-summary";
      /** Resources that answered with an error status, as Resource Timing saw them. */
      failures: readonly PreviewResourceFailure[];
      /** Page scripts whose module graph failed to load. */
      failedScripts: readonly string[];
      /** Time since the page's first script ran. */
      elapsedMs: number;
    }
  | {
      type: "morph:storefront-preview-pong";
      heartbeatId: number;
    }
  | {
      /**
       * An undo shortcut pressed while focus was inside the preview.
       *
       * The canvas is an iframe, so a key pressed there never reaches the
       * editor's own listener. Someone who has just clicked an element to
       * select it has focus in the iframe, which is exactly when they are most
       * likely to press undo — so without forwarding, the shortcut appears to
       * work only sometimes.
       */
      type: "morph:storefront-preview-history-shortcut";
      direction: "undo" | "redo";
    }
  | {
      type: "morph:storefront-preview-size";
      height: number;
      /** Echoes the request whose route/source layout was measured. */
      measurementRevision: number;
    }
  | {
      type: "morph:storefront-preview-structure";
      nodes: readonly PreviewEditableNode[];
      /**
       * The route pattern the page was rendering when it reported, as its
       * router matched it (`/aboutus`, `/products/$slug`).
       *
       * A preview starts on `/` and navigates to the route the editor asked
       * for, reporting along the way; without this the editor filed the home
       * page's nodes under whichever route was selected. Absent from a page
       * with no router to ask, which is then taken at its word as before.
       */
      routePath?: string;
    }
  | {
      type: "morph:storefront-preview-theme-files-applied";
      styleRevision: number;
    }
  | {
      type: "morph:storefront-preview-theme-files-failed";
      styleRevision: number;
    }
  | {
      /** Read-only catalog request delegated to the authenticated editor. */
      type: "morph:storefront-preview-catalog-request";
      requestId: number;
      page: number;
      handle?: string;
    }
  | PreviewSelectionMessage
  | {
      /**
       * The gap left by a component whose file was deleted, clicked.
       *
       * Deleting is allowed and recoverable, but the way back lived in a panel
       * the author had to know to open. The gap is where they are already
       * looking, so it carries the route to its own undo.
       */
      type: "morph:storefront-preview-open-file-history";
      path: string;
    }
  | {
      type: "morph:storefront-preview-commit-inline-text";
      sectionId: string;
      fieldKey: string;
      fieldPath: string;
      value: string;
    }
  | {
      type: "morph:storefront-preview-commit-sibling-reorder";
      sectionId: string;
      sourceFilePath: string;
      draggedNodeId: string;
      targetNodeId: string;
    }
  | {
      /**
       * Two sections exchanged by dragging one onto the other on the canvas.
       *
       * Sections are ordered by the route source, not by the element tree, so
       * this carries identities rather than a source position and is applied
       * through the same rewrite the sidebar's drag uses.
       */
      type: "morph:storefront-preview-commit-section-reorder";
      draggedSectionId: string;
      targetSectionId: string;
    }
  | {
      type: "morph:storefront-preview-commit-array-item-reorder";
      sectionId: string;
      draggedFieldPath: string;
      targetFieldPath: string;
    }
  | {
      /**
       * Where the pointer is during a reorder drag, so the canvas can follow it.
       *
       * A native drag suppresses wheel events, so the canvas cannot be scrolled
       * by hand while one is in flight and only the sections already on screen
       * could be dropped on. The preview reports the pointer in its own
       * coordinates and the editor decides, because only the editor knows where
       * its visible region currently sits.
       */
      type: "morph:storefront-preview-drag-autoscroll";
      phase: "move" | "end";
      clientX: number;
      clientY: number;
    }
  | { type: "morph:storefront-preview-reset-canvas" }
  | {
      type: "morph:storefront-preview-wheel";
      deltaY: number;
      deltaMode: number;
      ctrlKey: boolean;
      clientX: number;
      clientY: number;
    }
  | {
      type: "morph:storefront-preview-pointer";
      phase: "down" | "up" | "cancel" | "move";
      pointerId: number;
      screenX: number;
      screenY: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

const PREVIEW_SESSION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPreviewSession(value: unknown): value is string {
  return isBoundedString(value, 100) && PREVIEW_SESSION_PATTERN.test(value);
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) => key.length <= 100 && isBoundedString(item, 20_000),
    )
  );
}

function isPreviewThemeFile(value: unknown): value is PreviewThemeFile {
  return (
    isRecord(value) &&
    isBoundedString(value.path, 500) &&
    isBoundedString(value.content, 2_000_000)
  );
}

function isNullableBoundedString(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null || isBoundedString(value, maxLength);
}

function isNullableHtmlTagName(value: unknown): value is string | null {
  return (
    value === null ||
    (isBoundedString(value, 32) && /^[a-z][a-z0-9-]*$/.test(value))
  );
}

function parseEditableDescendantFields(
  value: unknown,
): EditableDescendantField[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: EditableDescendantField[] = [];
  const identities = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isBoundedString(item.fieldKey, 200) ||
      !isNullableBoundedString(item.fieldPath, 500) ||
      (item.sectionId !== undefined &&
        !isNullableBoundedString(item.sectionId, 100))
    ) {
      return null;
    }
    // Optional on the wire: a preview that has not reloaded yet sends bindings
    // without it, and rejecting the whole message would break selection
    // entirely rather than degrade one attribution.
    const sectionId =
      typeof item.sectionId === "string" ? item.sectionId : null;
    // Two sections may legitimately expose the same field name, so the section
    // is part of what makes a binding distinct.
    const identity = `${sectionId ?? ""}\u0000${item.fieldKey}\u0000${item.fieldPath ?? ""}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    result.push({
      fieldKey: item.fieldKey,
      fieldPath: item.fieldPath,
      sectionId,
    });
  }
  return result;
}

function parsePreviewSelectionRestoreTarget(
  value: unknown,
): PreviewSelectionRestoreTarget | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isBoundedString(value.sectionId, 100)) return null;
  // A compile-time source position is an identity in its own right: it is the
  // only one a component with no authored markers has. Leaving it out rejected
  // every such node, and because one bad node fails the whole message, a single
  // marker-free element made the entire structure unusable — the panel kept
  // showing whatever it had last accepted.
  const identityKeys = [
    "htmlId",
    "nodeId",
    "fieldPath",
    "elementKey",
    "fieldKey",
    "sourceLocation",
  ] as const;
  if (
    !identityKeys.some((key) => value[key] !== undefined) &&
    value.isSection !== true
  ) {
    return null;
  }
  if (
    (value.htmlId !== undefined && !isBoundedString(value.htmlId, 200)) ||
    (value.nodeId !== undefined && !isBoundedString(value.nodeId, 200)) ||
    (value.fieldPath !== undefined && !isBoundedString(value.fieldPath, 500)) ||
    (value.elementKey !== undefined &&
      !isBoundedString(value.elementKey, 200)) ||
    (value.fieldKey !== undefined && !isBoundedString(value.fieldKey, 200)) ||
    (value.sourceLocation !== undefined &&
      !isBoundedString(value.sourceLocation, 500)) ||
    (value.isSection !== undefined && typeof value.isSection !== "boolean")
  ) {
    return null;
  }
  return {
    sectionId: value.sectionId,
    // Carried through, not just accepted: dropping it here would leave a
    // marker-free element with nothing to restore its selection by.
    sourceLocation: value.sourceLocation,
    htmlId: value.htmlId,
    nodeId: value.nodeId,
    fieldPath: value.fieldPath,
    elementKey: value.elementKey,
    fieldKey: value.fieldKey,
    isSection: value.isSection,
  };
}

function parsePreviewEditableNodes(
  value: unknown,
): PreviewEditableNode[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const result: PreviewEditableNode[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    if (
      !isRecord(item) ||
      !isBoundedString(item.id, 500) ||
      !isNullableBoundedString(item.parentId, 500) ||
      !isBoundedString(item.sectionId, 100) ||
      !isBoundedString(item.label, 200) ||
      !isBoundedString(item.kind, 100) ||
      !isSelectionKind(item.kind) ||
      !isNullableHtmlTagName(item.tagName) ||
      (item.htmlId !== undefined &&
        (!isBoundedString(item.htmlId, 200) || item.htmlId.length === 0)) ||
      (item.stableId !== undefined && !isBoundedString(item.stableId, 200)) ||
      ids.has(item.id)
    ) {
      return null;
    }
    const target = parsePreviewSelectionRestoreTarget(item.target);
    if (
      !target ||
      target.sectionId !== item.sectionId ||
      target.isSection === true ||
      item.parentId === item.id
    ) {
      return null;
    }
    ids.add(item.id);
    result.push({
      id: item.id,
      parentId: item.parentId,
      sectionId: item.sectionId,
      label: item.label,
      kind: item.kind,
      tagName: item.tagName,
      htmlId: item.htmlId,
      stableId: item.stableId,
      target,
    });
  }

  const nodesById = new Map(result.map((node) => [node.id, node]));
  for (const node of result) {
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      const parent = nodesById.get(parentId);
      if (
        !parent ||
        parent.sectionId !== node.sectionId ||
        visited.has(parentId)
      ) {
        return null;
      }
      visited.add(parentId);
      parentId = parent.parentId;
    }
  }

  return result;
}

const PREVIEW_STYLE_SNAPSHOT_KEYS = [
  "fontSize",
  "lineHeight",
  "fontFamily",
  "fontWeight",
  "textAlign",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "display",
  "flexDirection",
  "gap",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "boxSizing",
  "position",
  "top",
  "left",
  "zIndex",
  "opacity",
  "overflow",
  "transform",
  "alignItems",
  "justifyContent",
] as const satisfies readonly (keyof PreviewStyleSnapshot)[];

function isStyleSnapshot(value: unknown): value is PreviewStyleSnapshot {
  return (
    isStringRecord(value) &&
    PREVIEW_STYLE_SNAPSHOT_KEYS.every((key) => typeof value[key] === "string")
  );
}

export function parseEditorToPreviewMessage(
  value: unknown,
): EditorToPreviewMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "morph:storefront-preview-ping":
      return isSafeRevision(value.heartbeatId)
        ? { type: value.type, heartbeatId: value.heartbeatId }
        : null;
    case "morph:storefront-preview-request-size":
      return isSafeRevision(value.measurementRevision)
        ? {
            type: value.type,
            measurementRevision: value.measurementRevision,
          }
        : null;
    case "morph:storefront-preview-request-structure":
      return { type: value.type };
    case "morph:storefront-preview-request-selection-style":
      return value.styleRevision === undefined ||
        isSafeRevision(value.styleRevision)
        ? { type: value.type, styleRevision: value.styleRevision }
        : null;
    case "morph:storefront-preview-set-selection-mode":
      if (
        typeof value.enabled !== "boolean" ||
        (value.selectionRevision !== undefined &&
          !isSafeRevision(value.selectionRevision))
      )
        return null;
      {
        const restoreTarget = parsePreviewSelectionRestoreTarget(
          value.restoreTarget,
        );
        if (restoreTarget === null) return null;
        return {
          type: value.type,
          enabled: value.enabled,
          ...(restoreTarget === undefined ? {} : { restoreTarget }),
          ...(value.selectionRevision === undefined
            ? {}
            : { selectionRevision: value.selectionRevision }),
        };
      }
    case "morph:storefront-preview-set-spacing-overlay":
      return isPreviewSpacingOverlayMode(value.mode)
        ? { type: value.type, mode: value.mode }
        : null;
    case "morph:storefront-preview-set-viewport-height":
      return typeof value.height === "number" && Number.isFinite(value.height)
        ? { type: value.type, height: value.height }
        : null;
    case "morph:storefront-preview-set-route":
      return isBoundedString(value.templateId, 100) &&
        (value.routePath === null || isBoundedString(value.routePath, 500))
        ? {
            type: value.type,
            templateId: value.templateId,
            routePath: value.routePath,
          }
        : null;
    case "morph:storefront-preview-set-section":
      if (value.sectionId !== null && !isBoundedString(value.sectionId, 100)) {
        return null;
      }
      {
        const restoreTarget = parsePreviewSelectionRestoreTarget(
          value.restoreTarget,
        );
        if (
          restoreTarget === null ||
          (value.selectionRevision !== undefined &&
            !isSafeRevision(value.selectionRevision))
        ) {
          return null;
        }
        return {
          type: value.type,
          sectionId: value.sectionId,
          ...(restoreTarget === undefined ? {} : { restoreTarget }),
          ...(value.selectionRevision === undefined
            ? {}
            : { selectionRevision: value.selectionRevision }),
        };
      }
    case "morph:storefront-preview-set-selection-field-path":
      return isBoundedString(value.sectionId, 100) &&
        isBoundedString(value.fieldPath, 500)
        ? {
            type: value.type,
            sectionId: value.sectionId,
            fieldPath: value.fieldPath,
          }
        : null;
    case "morph:storefront-preview-set-section-order":
      return Array.isArray(value.sectionIds) &&
        value.sectionIds.every((id) => isBoundedString(id, 100))
        ? { type: value.type, sectionIds: value.sectionIds }
        : null;
    case "morph:storefront-preview-update-section-props":
      if (
        !isBoundedString(value.sectionId, 100) ||
        (value.enabled !== undefined && typeof value.enabled !== "boolean")
      ) {
        return null;
      }
      {
        const props =
          value.props === undefined
            ? undefined
            : parsePreviewSectionProps(value.props);
        if (value.props !== undefined && props === null) return null;
        return {
          type: value.type,
          sectionId: value.sectionId,
          props: props ?? undefined,
          enabled: value.enabled,
        };
      }
    case "morph:storefront-preview-update-theme-files":
      return Array.isArray(value.files) &&
        value.files.length <= 500 &&
        value.files.every(isPreviewThemeFile) &&
        isSafeRevision(value.styleRevision) &&
        (value.sourceGeneration === undefined ||
          isSafeRevision(value.sourceGeneration))
        ? {
            type: value.type,
            files: value.files,
            styleRevision: value.styleRevision,
            sourceGeneration: value.sourceGeneration,
            ...(typeof value.renderDocument === "boolean"
              ? { renderDocument: value.renderDocument }
              : {}),
          }
        : null;
    case "morph:storefront-preview-theme-files-written":
      return isSafeRevision(value.styleRevision)
        ? { type: value.type, styleRevision: value.styleRevision }
        : null;
    case "morph:storefront-preview-catalog-response":
      return isSafeRevision(value.requestId) &&
        typeof value.ok === "boolean" &&
        Number.isSafeInteger(value.status) &&
        Number(value.status) >= 100 &&
        Number(value.status) <= 599 &&
        isBoundedCatalogResponseBody(value.body)
        ? {
            type: value.type,
            requestId: value.requestId,
            ok: value.ok,
            status: Number(value.status),
            body: value.body,
          }
        : null;
    case "morph:storefront-preview-update-selection-style":
      return isStringRecord(value.styles) &&
        isBoundedString(value.targetElement, 100) &&
        (value.sourceLocation === undefined ||
          isNullableBoundedString(value.sourceLocation, 400))
        ? {
            type: value.type,
            styles: value.styles,
            targetElement: value.targetElement,
            sourceLocation: value.sourceLocation ?? null,
          }
        : null;
    case "morph:storefront-preview-reset-selection-style-preview":
      return { type: value.type };
    case "morph:storefront-preview-update-selection-field":
      return isBoundedString(value.fieldKey, 100) &&
        isNullableBoundedString(value.fieldPath, 500) &&
        isBoundedString(value.value, 10_000)
        ? {
            type: value.type,
            fieldKey: value.fieldKey,
            fieldPath: value.fieldPath,
            value: value.value,
          }
        : null;
    default:
      return null;
  }
}

const MAX_DIAGNOSTIC_ENTRIES = 20;
const MAX_DIAGNOSTIC_PATH_LENGTH = 300;

function isDiagnosticPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DIAGNOSTIC_PATH_LENGTH
  );
}

/**
 * Bounded like everything else from the frame: it runs Theme JavaScript, so
 * a diagnostic is a claim to log, never something to act on.
 */
function parsePreviewDiagnostic(
  value: Record<string, unknown>,
): PreviewToEditorMessage | null {
  if (value.kind !== "script-failed" && value.kind !== "load-summary") {
    return null;
  }
  if (
    !Array.isArray(value.failures) ||
    value.failures.length > MAX_DIAGNOSTIC_ENTRIES ||
    !Array.isArray(value.failedScripts) ||
    value.failedScripts.length > MAX_DIAGNOSTIC_ENTRIES ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0
  ) {
    return null;
  }
  const failures: PreviewResourceFailure[] = [];
  for (const failure of value.failures) {
    if (
      !isRecord(failure) ||
      !isDiagnosticPath(failure.path) ||
      !Number.isInteger(failure.status) ||
      (failure.status as number) < 100 ||
      (failure.status as number) > 599
    ) {
      return null;
    }
    failures.push({ path: failure.path, status: failure.status as number });
  }
  if (!value.failedScripts.every(isDiagnosticPath)) return null;
  return {
    type: "morph:storefront-preview-diagnostic",
    kind: value.kind,
    failures,
    failedScripts: value.failedScripts as string[],
    elapsedMs: Math.round(value.elapsedMs),
  };
}

export function parsePreviewToEditorMessage(
  value: unknown,
): PreviewToEditorMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "morph:storefront-preview-ready":
    case "morph:storefront-preview-reset-canvas":
      return { type: value.type };
    case "morph:storefront-preview-pong":
      return isSafeRevision(value.heartbeatId)
        ? { type: value.type, heartbeatId: value.heartbeatId }
        : null;
    case "morph:storefront-preview-history-shortcut":
      return value.direction === "undo" || value.direction === "redo"
        ? { type: value.type, direction: value.direction }
        : null;
    case "morph:storefront-preview-size":
      return typeof value.height === "number" &&
        Number.isFinite(value.height) &&
        isSafeRevision(value.measurementRevision)
        ? {
            type: value.type,
            height: value.height,
            measurementRevision: value.measurementRevision,
          }
        : null;
    case "morph:storefront-preview-diagnostic":
      return parsePreviewDiagnostic(value);
    case "morph:storefront-preview-structure": {
      const nodes = parsePreviewEditableNodes(value.nodes);
      if (!nodes) return null;
      if (value.routePath === undefined) return { type: value.type, nodes };
      return typeof value.routePath === "string" &&
        value.routePath.startsWith("/") &&
        value.routePath.length <= 512
        ? { type: value.type, nodes, routePath: value.routePath }
        : null;
    }
    case "morph:storefront-preview-theme-files-applied":
    case "morph:storefront-preview-theme-files-failed":
      return isSafeRevision(value.styleRevision)
        ? { type: value.type, styleRevision: value.styleRevision }
        : null;
    case "morph:storefront-preview-catalog-request":
      return isSafeRevision(value.requestId) &&
        Number.isSafeInteger(value.page) &&
        Number(value.page) >= 1 &&
        Number(value.page) <= 10_000 &&
        (value.handle === undefined ||
          (isBoundedString(value.handle, 200) && value.handle.length > 0))
        ? {
            type: value.type,
            requestId: value.requestId,
            page: Number(value.page),
            ...(value.handle === undefined ? {} : { handle: value.handle }),
          }
        : null;
    case "morph:storefront-preview-select-section": {
      const descendantFields = parseEditableDescendantFields(
        value.descendantFields,
      );
      if (
        !isBoundedString(value.sectionId, 100) ||
        !isBoundedString(value.componentType, 200) ||
        !isBoundedString(value.kind, 100) ||
        !isSelectionKind(value.kind) ||
        (value.nodeId !== undefined && !isBoundedString(value.nodeId, 200)) ||
        !isNullableBoundedString(value.sourceFilePath, 1_000) ||
        (value.sourceLocation !== undefined &&
          !isNullableBoundedString(value.sourceLocation, 400)) ||
        !isNullableBoundedString(value.elementKey, 200) ||
        !isNullableBoundedString(value.fieldKey, 200) ||
        !isNullableBoundedString(value.field, 200) ||
        !isNullableBoundedString(value.fieldPath, 500) ||
        (value.contentValue !== undefined &&
          !isNullableBoundedString(value.contentValue, 10_000)) ||
        (value.selectionRevision !== undefined &&
          !isSafeRevision(value.selectionRevision)) ||
        descendantFields === null ||
        !isBoundedString(value.tagName, 100) ||
        !isNullableBoundedString(value.role, 100) ||
        !isNullableBoundedString(value.inputType, 100) ||
        !isSafeRevision(value.styleRevision) ||
        !isBoundedString(value.className, 20_000) ||
        typeof value.isSection !== "boolean" ||
        !isNullableBoundedString(value.inspectorOverride, 1_000) ||
        !(
          value.computedStyle === null || isStyleSnapshot(value.computedStyle)
        ) ||
        !(
          value.parentComputedStyle === null ||
          isStyleSnapshot(value.parentComputedStyle)
        ) ||
        !(
          value.sectionComputedStyle === null ||
          isStyleSnapshot(value.sectionComputedStyle)
        ) ||
        !isNullableDocumentRect(value.documentRect)
      ) {
        return null;
      }
      return {
        type: value.type,
        sectionId: value.sectionId,
        componentType: value.componentType,
        kind: value.kind,
        nodeId: value.nodeId,
        sourceFilePath: value.sourceFilePath,
        sourceLocation: value.sourceLocation ?? null,
        elementKey: value.elementKey,
        fieldKey: value.fieldKey,
        field: value.field,
        fieldPath: value.fieldPath,
        contentValue: value.contentValue ?? null,
        ...(value.selectionRevision === undefined
          ? {}
          : { selectionRevision: value.selectionRevision }),
        descendantFields,
        tagName: value.tagName,
        role: value.role,
        inputType: value.inputType,
        styleRevision: value.styleRevision,
        className: value.className,
        isSection: value.isSection,
        inspectorOverride: value.inspectorOverride,
        computedStyle: value.computedStyle,
        parentComputedStyle: value.parentComputedStyle,
        sectionComputedStyle: value.sectionComputedStyle,
        documentRect: readDocumentRect(value.documentRect),
      };
    }
    case "morph:storefront-preview-open-file-history":
      // Bounded like every other path on this channel: the preview is
      // untrusted input, and this one reaches a file lookup.
      return isBoundedString(value.path, 1_000) && value.path.length > 0
        ? { type: value.type, path: value.path }
        : null;
    case "morph:storefront-preview-commit-inline-text":
      return isBoundedString(value.sectionId, 100) &&
        value.sectionId.length > 0 &&
        isBoundedString(value.fieldKey, 200) &&
        value.fieldKey.length > 0 &&
        isBoundedString(value.fieldPath, 500) &&
        value.fieldPath.length > 0 &&
        isBoundedString(value.value, 10_000)
        ? {
            type: value.type,
            sectionId: value.sectionId,
            fieldKey: value.fieldKey,
            fieldPath: value.fieldPath,
            value: value.value,
          }
        : null;
    case "morph:storefront-preview-commit-sibling-reorder":
      return isBoundedString(value.sectionId, 100) &&
        isBoundedString(value.sourceFilePath, 1_000) &&
        isBoundedString(value.draggedNodeId, 200) &&
        isBoundedString(value.targetNodeId, 200) &&
        value.draggedNodeId !== value.targetNodeId
        ? {
            type: value.type,
            sectionId: value.sectionId,
            sourceFilePath: value.sourceFilePath,
            draggedNodeId: value.draggedNodeId,
            targetNodeId: value.targetNodeId,
          }
        : null;
    case "morph:storefront-preview-drag-autoscroll":
      return (value.phase === "move" || value.phase === "end") &&
        Number.isFinite(value.clientX) &&
        Number.isFinite(value.clientY)
        ? {
            type: value.type,
            phase: value.phase,
            clientX: value.clientX as number,
            clientY: value.clientY as number,
          }
        : null;
    case "morph:storefront-preview-commit-section-reorder":
      return isBoundedString(value.draggedSectionId, 100) &&
        isBoundedString(value.targetSectionId, 100) &&
        value.draggedSectionId !== value.targetSectionId
        ? {
            type: value.type,
            draggedSectionId: value.draggedSectionId,
            targetSectionId: value.targetSectionId,
          }
        : null;
    case "morph:storefront-preview-commit-array-item-reorder":
      return isBoundedString(value.sectionId, 100) &&
        isBoundedString(value.draggedFieldPath, 500) &&
        isBoundedString(value.targetFieldPath, 500) &&
        value.draggedFieldPath !== value.targetFieldPath
        ? {
            type: value.type,
            sectionId: value.sectionId,
            draggedFieldPath: value.draggedFieldPath,
            targetFieldPath: value.targetFieldPath,
          }
        : null;
    case "morph:storefront-preview-wheel":
      return typeof value.deltaY === "number" &&
        Number.isFinite(value.deltaY) &&
        typeof value.deltaMode === "number" &&
        typeof value.ctrlKey === "boolean" &&
        typeof value.clientX === "number" &&
        typeof value.clientY === "number"
        ? {
            type: value.type,
            deltaY: value.deltaY,
            deltaMode: value.deltaMode,
            ctrlKey: value.ctrlKey,
            clientX: value.clientX,
            clientY: value.clientY,
          }
        : null;
    case "morph:storefront-preview-pointer":
      return (value.phase === "down" ||
        value.phase === "up" ||
        value.phase === "cancel" ||
        value.phase === "move") &&
        typeof value.pointerId === "number" &&
        typeof value.screenX === "number" &&
        typeof value.screenY === "number"
        ? {
            type: value.type,
            phase: value.phase,
            pointerId: value.pointerId,
            screenX: value.screenX,
            screenY: value.screenY,
          }
        : null;
    default:
      return null;
  }
}

function hasExpectedPreviewSession(
  value: unknown,
  previewSession: string,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    isPreviewSession(value.previewSession) &&
    isPreviewSession(previewSession) &&
    value.previewSession === previewSession
  );
}

export function parseEditorToPreviewEvent(
  event: MessageEvent<unknown>,
  security: PreviewMessageEventSecurity,
): EditorToPreviewMessage | null {
  if (
    event.origin !== security.expectedOrigin ||
    event.source !== security.expectedSource ||
    !hasExpectedPreviewSession(event.data, security.previewSession)
  ) {
    return null;
  }
  return parseEditorToPreviewMessage(event.data);
}

/**
 * A rectangle the preview measured in its own document.
 *
 * Bounded like every other value crossing this boundary: the frame runs Theme
 * JavaScript, so a number arriving from it is a claim, not a fact. A page
 * taller than this is past anything the canvas can show.
 */
const MAX_PREVIEW_DOCUMENT_EXTENT = 1_000_000;

function isNullableDocumentRect(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  return (
    Number.isFinite(value.top) &&
    Number.isFinite(value.height) &&
    Math.abs(value.top as number) <= MAX_PREVIEW_DOCUMENT_EXTENT &&
    (value.height as number) >= 0 &&
    (value.height as number) <= MAX_PREVIEW_DOCUMENT_EXTENT
  );
}

function readDocumentRect(
  value: unknown,
): { top: number; height: number } | null {
  if (!isNullableDocumentRect(value) || !isRecord(value)) return null;
  return { top: value.top as number, height: value.height as number };
}

export function parsePreviewToEditorEvent(
  event: MessageEvent<unknown>,
  security: PreviewMessageEventSecurity,
): PreviewToEditorMessage | null {
  if (
    event.origin !== security.expectedOrigin ||
    event.source !== security.expectedSource ||
    !hasExpectedPreviewSession(event.data, security.previewSession)
  ) {
    return null;
  }
  return parsePreviewToEditorMessage(event.data);
}

export function readPreviewRuntimeChannel(
  href: string,
): PreviewMessageChannel | null {
  try {
    const url = new URL(href);
    const targetOrigin = url.searchParams.get("editorOrigin");
    const previewSession = url.searchParams.get("previewSession");
    if (
      !targetOrigin ||
      !isExactHttpOrigin(targetOrigin) ||
      !isPreviewSession(previewSession)
    ) {
      return null;
    }
    return { targetOrigin, previewSession };
  } catch {
    return null;
  }
}

export function parseEditorToPreviewWindowEvent(
  event: MessageEvent<unknown>,
): EditorToPreviewMessage | null {
  const channel = readPreviewRuntimeChannel(window.location.href);
  if (!channel) return null;
  return parseEditorToPreviewEvent(event, {
    expectedOrigin: channel.targetOrigin,
    expectedSource: window.parent,
    previewSession: channel.previewSession,
  });
}

export function postEditorToPreviewMessage(
  target: Window | null | undefined,
  message: EditorToPreviewMessage,
  channel: PreviewMessageChannel,
) {
  if (
    !isExactHttpOrigin(channel.targetOrigin) ||
    !isPreviewSession(channel.previewSession)
  ) {
    return;
  }
  if (!target) return;
  // An iframe React has just created has not navigated yet: it is still
  // `about:blank`, which inherits the editor's own origin. Posting to it with
  // the preview's origin is refused, and the message is gone with nothing but
  // a console warning to say so — the worst way for editor state to go
  // missing, and five of them on every preview load.
  //
  // Readiness cannot be the test here. `request-size` is itself how the editor
  // recovers when the preview's one-shot `ready` was emitted before the parent
  // was listening, so a send gated on ready would remove the path that makes
  // the frame ready. The origin is the honest question: a frame serving the
  // preview is cross-origin, so reading its location throws, and that throw is
  // the proof this is the frame the channel was opened for. Anything readable
  // is still the blank one, and the send is skipped rather than dropped.
  try {
    if (target.location.origin !== channel.targetOrigin) return;
  } catch {
    // Cross-origin, which is what a loaded preview looks like from here.
  }
  target.postMessage(
    { ...message, previewSession: channel.previewSession },
    channel.targetOrigin,
  );
}

export function postPreviewToEditorMessage(
  message: PreviewToEditorMessage,
  channel = readPreviewRuntimeChannel(window.location.href),
) {
  if (
    !channel ||
    !isExactHttpOrigin(channel.targetOrigin) ||
    !isPreviewSession(channel.previewSession)
  ) {
    return;
  }
  window.parent.postMessage(
    { ...message, previewSession: channel.previewSession },
    channel.targetOrigin,
  );
}
