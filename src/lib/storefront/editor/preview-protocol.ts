import { isSelectionKind, type SelectionKind } from "./selection-taxonomy";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { JsonValue } from "@/db/json";

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
  backgroundColor: string;
  backgroundImage: string;
  borderRadius: string;
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

export type EditorToPreviewMessage =
  | { type: "morph:storefront-preview-request-size" }
  | {
      type: "morph:storefront-preview-request-selection-style";
      styleRevision?: number;
    }
  | { type: "morph:storefront-preview-set-selection-mode"; enabled: boolean }
  | { type: "morph:storefront-preview-set-viewport-height"; height: number }
  | { type: "morph:storefront-preview-set-section"; sectionId: string | null }
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
    }
  | {
      type: "morph:storefront-preview-update-selection-style";
      styles: Record<string, string>;
      targetElement: string;
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
  elementKey: string | null;
  fieldKey: string | null;
  field: string | null;
  fieldPath: string | null;
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
  | { type: "morph:storefront-preview-size"; height: number }
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
      type: "morph:storefront-preview-commit-sibling-reorder";
      sectionId: string;
      sourceFilePath: string;
      draggedNodeId: string;
      targetNodeId: string;
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
  "backgroundColor",
  "backgroundImage",
  "borderRadius",
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
      return { type: value.type };
    case "morph:storefront-preview-request-selection-style":
      return value.styleRevision === undefined ||
        isSafeRevision(value.styleRevision)
        ? { type: value.type, styleRevision: value.styleRevision }
        : null;
    case "morph:storefront-preview-set-selection-mode":
      return typeof value.enabled === "boolean"
        ? { type: value.type, enabled: value.enabled }
        : null;
    case "morph:storefront-preview-set-viewport-height":
      return typeof value.height === "number" && Number.isFinite(value.height)
        ? { type: value.type, height: value.height }
        : null;
    case "morph:storefront-preview-set-section":
      return value.sectionId === null || isBoundedString(value.sectionId, 100)
        ? { type: value.type, sectionId: value.sectionId }
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
          }
        : null;
    case "morph:storefront-preview-update-selection-style":
      return isStringRecord(value.styles) &&
        isBoundedString(value.targetElement, 100)
        ? {
            type: value.type,
            styles: value.styles,
            targetElement: value.targetElement,
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
    case "morph:storefront-preview-size":
      return typeof value.height === "number" && Number.isFinite(value.height)
        ? { type: value.type, height: value.height }
        : null;
    case "morph:storefront-preview-theme-files-applied":
    case "morph:storefront-preview-theme-files-failed":
      return isSafeRevision(value.styleRevision)
        ? { type: value.type, styleRevision: value.styleRevision }
        : null;
    case "morph:storefront-preview-select-section": {
      if (
        !isBoundedString(value.sectionId, 100) ||
        !isBoundedString(value.componentType, 200) ||
        !isBoundedString(value.kind, 100) ||
        !isSelectionKind(value.kind) ||
        (value.nodeId !== undefined && !isBoundedString(value.nodeId, 200)) ||
        !isNullableBoundedString(value.sourceFilePath, 1_000) ||
        !isNullableBoundedString(value.elementKey, 200) ||
        !isNullableBoundedString(value.fieldKey, 200) ||
        !isNullableBoundedString(value.field, 200) ||
        !isNullableBoundedString(value.fieldPath, 500) ||
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
        elementKey: value.elementKey,
        fieldKey: value.fieldKey,
        field: value.field,
        fieldPath: value.fieldPath,
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

export function postEditorToPreviewMessage(
  target: Window | null | undefined,
  message: EditorToPreviewMessage,
) {
  target?.postMessage(message, window.location.origin);
}

export function postPreviewToEditorMessage(message: PreviewToEditorMessage) {
  window.parent.postMessage(message, window.location.origin);
}
