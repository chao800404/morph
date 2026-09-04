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
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function parsePreviewSectionProps(
  value: unknown,
): PreviewSectionProps | null {
  if (!isRecord(value) || !isJsonValue(value)) return null;
  return value;
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
};

export type PreviewToEditorMessage =
  | { type: "morph:storefront-preview-ready" }
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
    }
  | {
      type: "morph:storefront-preview-theme-files-applied";
      styleRevision: number;
    }
  | {
      type: "morph:storefront-preview-theme-files-failed";
      styleRevision: number;
    }
  | PreviewSelectionMessage
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

export function parsePreviewToEditorMessage(
  value: unknown,
): PreviewToEditorMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "morph:storefront-preview-ready":
    case "morph:storefront-preview-reset-canvas":
      return { type: value.type };
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
    case "morph:storefront-preview-structure": {
      const nodes = parsePreviewEditableNodes(value.nodes);
      return nodes ? { type: value.type, nodes } : null;
    }
    case "morph:storefront-preview-theme-files-applied":
    case "morph:storefront-preview-theme-files-failed":
      return isSafeRevision(value.styleRevision)
        ? { type: value.type, styleRevision: value.styleRevision }
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
        )
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
      };
    }
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
  target?.postMessage(
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
