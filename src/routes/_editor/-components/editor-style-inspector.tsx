import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import { Select, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TailwindClassTokenInput } from "./tailwind-class-token-input";
import {
  getFieldPathValue,
  setFieldPathValue,
  type EditorSelectionDescriptor,
} from "@/lib/storefront/editor/selection-taxonomy";
import { resolveInspectorModules } from "@/lib/storefront/editor/inspector-modules";
import {
  findSourceLocation,
  getComponentFilePath,
  parseComponentSource,
  parseTailwindBackgroundColor,
  parseTailwindBorderColor,
  parseTailwindBorderRadii,
  parseTailwindBorderStyle,
  parseTailwindBorderWidth,
  parseTailwindFontFamily,
  parseTailwindFontSizeDetailed,
  parseTailwindFontWeight,
  parseTailwindLineHeight,
  parseTailwindPadding,
  parseTailwindTextAlign,
  parseTailwindTextColor,
  type ComponentElementMeta,
} from "@/lib/storefront/ast/theme-ast-transformer";
import {
  patchTailwindClasses as patchTailwindClassesBase,
  tokenizeTailwindClasses,
  type PatchTailwindOptions,
} from "@/lib/storefront/ast/tailwind-token-engine";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Code2,
  Image as ImageIcon,
  Link,
  Paintbrush,
  Palette,
  Sliders,
  Type,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { RxPadding } from "react-icons/rx";
import { InspectorColorField } from "./style-inspector/inspector-color-field";
import {
  isGradientPaint,
  paintPreviewStyles,
  parseTailwindBackgroundPaint,
  parseTailwindTextGradient,
  patchTailwindTextPaint,
  textPaintPreviewStyles,
  toBackgroundPaintUtility,
  toBorderColorUtility,
} from "./style-inspector/inspector-paint-utils";
import {
  InspectorModuleCard as InspectorGroup,
  InspectorModuleStaticSections,
} from "./style-inspector/inspector-module-card";
import {
  InspectorSelectContent,
  InspectorSelectControl,
  InspectorSelectItem,
  InspectorSelectTrigger,
} from "./style-inspector/inspector-select-control";
import { InspectorDisclosureField } from "./style-inspector/inspector-disclosure-field";
import { InspectorControlRow } from "./style-inspector/inspector-control-row";
import { InspectorBreakpointIndicator } from "./style-inspector/inspector-breakpoint-indicator";
import {
  InspectorLengthControl,
  inspectorLengthUtility,
  resolveInspectorLength,
} from "./style-inspector/inspector-length-control";
import {
  hasInspectorDesignModule,
  renderInspectorDesignModule,
} from "./style-inspector/inspector-module-registry";
import {
  BorderRadiusInspectorModule,
  type BorderRadiusCorner,
} from "./style-inspector/border-radius-inspector-module";
import {
  AppearanceInspectorModule,
  LayoutInspectorModule,
  PositionInspectorModule,
  SizingInspectorModule,
} from "./style-inspector/box-style-modules";
import {
  canPatchThemeInstanceStyleClasses,
  isRepeatedFieldPath,
  readThemeElementBaseClasses,
  readThemeInstanceStyleClasses,
  type ThemeInstanceStyleTarget,
} from "@/lib/storefront/editor/theme-instance-style-source";

type EditorSection =
  StorefrontThemeEditorDTO["templates"][number]["document"]["sections"][number];

type EditorStyleInspectorProps = {
  section: EditorSection;
  themeFiles?: StorefrontThemeFileDTO[];
  selection?: EditorSelectionDescriptor | null;
  activeComputedStyleRevision?: number;
  activeViewport?: "desktop" | "tablet" | "mobile";
  onUpdateThemeFileStyle?: (
    filePath: string,
    elementName: string,
    updater: (prevClasses: string) => string,
    instanceTarget?: ThemeInstanceStyleTarget,
  ) => number | void;
  onPreviewSelectionStyle?: (
    styles: Record<string, string>,
    targetElement: string,
  ) => void;
  onPreviewSelectionField?: (
    fieldKey: string,
    fieldPath: string | null,
    value: string,
  ) => void;
  onPropsChange: (next: Record<string, unknown>) => void;
  onJumpToCode?: (filePath: string, line?: number, column?: number) => void;
  disabled?: boolean;
};

const THEME_PALETTE_COLORS = [
  {
    label: "Stone 50",
    value: "#fafaf9",
    preview: "bg-[#fafaf9] border-stone-200",
  },
  {
    label: "Stone 100",
    value: "#f5f5f4",
    preview: "bg-[#f5f5f4] border-stone-300",
  },
  {
    label: "Cream",
    value: "#d8d0c3",
    preview: "bg-[#d8d0c3] border-stone-400",
  },
  {
    label: "Warm Tan",
    value: "#b7ad9d",
    preview: "bg-[#b7ad9d] border-stone-500",
  },
  {
    label: "Stone 800",
    value: "#292524",
    preview: "bg-[#292524] border-stone-700",
  },
  {
    label: "Stone 900",
    value: "#1c1917",
    preview: "bg-[#1c1917] border-stone-800",
  },
  { label: "White", value: "#ffffff", preview: "bg-white border-stone-200" },
  { label: "Black", value: "#000000", preview: "bg-black border-stone-800" },
];

const BORDER_RADIUS_CORNER_CONFIG = {
  topLeft: {
    cssProperty: "border-top-left-radius",
    property: "border-radius-top-left",
    utility: "rounded-tl",
    optimisticKey: "borderRadiusTopLeft",
  },
  topRight: {
    cssProperty: "border-top-right-radius",
    property: "border-radius-top-right",
    utility: "rounded-tr",
    optimisticKey: "borderRadiusTopRight",
  },
  bottomRight: {
    cssProperty: "border-bottom-right-radius",
    property: "border-radius-bottom-right",
    utility: "rounded-br",
    optimisticKey: "borderRadiusBottomRight",
  },
  bottomLeft: {
    cssProperty: "border-bottom-left-radius",
    property: "border-radius-bottom-left",
    utility: "rounded-bl",
    optimisticKey: "borderRadiusBottomLeft",
  },
} as const satisfies Record<
  Exclude<BorderRadiusCorner, "all">,
  {
    cssProperty: string;
    property: PatchTailwindOptions["property"];
    utility: string;
    optimisticKey: string;
  }
>;

function parsePx(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computedFontFamilyKind(
  value?: string | null,
): "serif" | "sans" | "mono" | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (
    normalized.includes("monospace") ||
    normalized.includes("menlo") ||
    normalized.includes("monaco") ||
    normalized.includes("consolas")
  ) {
    return "mono";
  }
  if (
    normalized.includes("serif") ||
    normalized.includes("georgia") ||
    normalized.includes("times")
  ) {
    return "serif";
  }
  return "sans";
}

function computedFontWeightKind(
  value?: string | null,
): "normal" | "medium" | "bold" | null {
  if (!value) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) {
    if (numeric >= 650) return "bold";
    if (numeric >= 500) return "medium";
    return "normal";
  }
  if (value === "bold") return "bold";
  return value === "normal" ? "normal" : null;
}

function computedLineHeightRatio(
  lineHeight?: string | null,
  fontSize?: string | null,
): number | null {
  const line = parsePx(lineHeight);
  const font = parsePx(fontSize);
  if (line === null || font === null || font <= 0) return null;
  return Math.round((line / font) * 100) / 100;
}

function repeatedItemRootPath(
  fieldPath: string | null | undefined,
): string | null {
  if (!fieldPath) return null;
  const segments = fieldPath.split(".");
  const itemIndex = segments.findIndex((segment) => /^\d+$/.test(segment));
  return itemIndex >= 0 ? segments.slice(0, itemIndex + 1).join(".") : null;
}

function createMorphItemId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return "morph-" + uuid;
  return (
    "morph-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

function computedColorToHex(value?: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  const match = raw.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isFinite(alpha) || alpha < 0.999) return null;
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Resolve the class string shown by the inspector without losing the
 * distinction between a selected source node with no classes and a node that
 * was not resolved. A resolved node is authoritative, including an empty
 * className; only unresolved nodes may fall back to section/document props.
 */
export function resolveStyleInspectorClassName(
  targetMeta: ComponentElementMeta | undefined,
  sectionClassName: string,
  activeClassName?: string | null,
  propsClassName?: unknown,
  propsCustomClass?: unknown,
): string {
  if (targetMeta) return targetMeta.className;
  if (activeClassName !== null && activeClassName !== undefined) {
    return activeClassName;
  }
  if (sectionClassName) return sectionClassName;
  if (typeof propsClassName === "string") return propsClassName;
  if (typeof propsCustomClass === "string") return propsCustomClass;
  return "";
}

export const EditorStyleInspector = memo(function EditorStyleInspector({
  section,
  themeFiles,
  selection,
  activeComputedStyleRevision = 0,
  activeViewport = "mobile",
  onUpdateThemeFileStyle,
  onPreviewSelectionStyle,
  onPreviewSelectionField,
  onPropsChange,
  onJumpToCode,
  disabled = false,
}: EditorStyleInspectorProps) {
  const activeNodeId = selection?.nodeId;
  const activeElementKey = selection?.elementKey;
  const activeFieldKey = selection?.fieldKey;
  const activeFieldPath = selection?.fieldPath;
  const activeClassName = selection?.className;
  const activeSelectionIsSection = selection?.isSection;
  const activeComputedStyle = selection?.computed;
  const activeSectionComputedStyle = selection?.sectionComputed;

  const [paddingExpanded, setPaddingExpanded] = useState(false);
  const [marginExpanded, setMarginExpanded] = useState(false);
  const [sectionsExpanded, setSectionsExpanded] = useState({
    design: true,
    content: true,
    flow: true,
    sizing: true,
    position: true,
    appearance: true,
    layout: true,
    typography: true,
    fills: true,
    borders: true,
    tailwind: false,
  });

  const toggleSection = (key: keyof typeof sectionsExpanded) => {
    setSectionsExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [localProps, setLocalProps] = useState<Record<string, any>>(
    () => (section.props as Record<string, any>) ?? {},
  );
  const localPropsRef = useRef(localProps);
  const optimisticStyleRef = useRef<{
    key: string;
    revision: number;
    values: Record<string, string | number>;
  }>({ key: "", revision: 0, values: {} });

  useEffect(() => {
    const next = (section.props as Record<string, any>) ?? {};
    localPropsRef.current = next;
    setLocalProps(next);
  }, [section.id]);
  useEffect(() => {
    if (
      optimisticStyleRef.current.revision > 0 &&
      activeComputedStyleRevision >= optimisticStyleRef.current.revision
    ) {
      optimisticStyleRef.current = { key: "", revision: 0, values: {} };
    }
  }, [activeComputedStyleRevision]);

  const componentPath =
    (selection?.sourceFilePath &&
    themeFiles?.some((file) => file.path === selection.sourceFilePath)
      ? selection.sourceFilePath
      : null) ??
    getComponentFilePath(
      section.type,
      themeFiles,
      section.componentRef ?? undefined,
    );
  const targetElement = activeNodeId || activeElementKey || "heading";
  const props = localProps;
  const selectedField = activeFieldKey ?? activeElementKey;
  const isSelectedNode = activeSelectionIsSection === false;
  const selectedKind = selection?.kind ?? "custom";
  const showField = (...keys: string[]) =>
    !isSelectedNode ||
    keys.includes(selectedField ?? "") ||
    (activeFieldPath
      ? keys.includes(activeFieldPath.split(".").pop() ?? "")
      : false);
  const fieldValue = (key: string): unknown =>
    activeFieldPath && activeFieldPath.endsWith("." + key)
      ? getFieldPathValue(props, activeFieldPath)
      : props[key];
  const nestedFieldPath = (key: string): string | null => {
    if (!activeFieldPath || !activeFieldPath.includes(".") || !isSelectedNode)
      return null;
    const prefix = activeFieldPath.slice(0, activeFieldPath.lastIndexOf("."));
    return prefix + "." + key;
  };
  const selectedFieldValue = (key: string): unknown => {
    const path = nestedFieldPath(key);
    return path ? getFieldPathValue(props, path) : props[key];
  };
  const optimisticValue = (key: string): number | string | undefined =>
    optimisticStyleRef.current.values[key];
  const optimisticNumber = (key: string): number | undefined => {
    const value = optimisticStyleRef.current.values[key];
    return typeof value === "number" ? value : undefined;
  };

  const componentFile = themeFiles?.find((f) => f.path === componentPath);
  const parsedMeta = componentFile?.content
    ? parseComponentSource(componentFile.content, componentFile.path)
    : null;
  const targetElementMeta =
    (activeNodeId ? parsedMeta?.nodeMap[activeNodeId] : undefined) ??
    parsedMeta?.elements[targetElement] ??
    (activeSelectionIsSection === false
      ? undefined
      : parsedMeta?.elements["heading"]);
  const sectionElementMeta =
    parsedMeta?.elements["section"] ?? parsedMeta?.elements["root"];
  const activeRepeatedItemPath = repeatedItemRootPath(activeFieldPath);
  const activeRepeatedItem = activeRepeatedItemPath
    ? getFieldPathValue(props, activeRepeatedItemPath)
    : null;
  const hasActiveRepeatedBody = Boolean(
    isSelectedNode &&
    activeFieldPath?.endsWith(".body") &&
    activeRepeatedItemPath,
  );
  const activeRepeatedItemId =
    activeRepeatedItem &&
    typeof activeRepeatedItem === "object" &&
    typeof (activeRepeatedItem as Record<string, unknown>).id === "string"
      ? ((activeRepeatedItem as Record<string, unknown>).id as string)
      : undefined;
  const instanceStyleTarget = isRepeatedFieldPath(activeFieldPath)
    ? {
        sectionId: section.id,
        fieldPath: activeFieldPath,
        itemId: activeRepeatedItemId,
      }
    : null;
  const sourceElementName = activeNodeId ?? targetElement;
  const instanceStyleClassName =
    instanceStyleTarget && componentFile
      ? readThemeInstanceStyleClasses(
          componentFile.content,
          instanceStyleTarget,
          sourceElementName,
        )
      : null;
  const editableBaseClassName = componentFile
    ? readThemeElementBaseClasses(componentFile.content, sourceElementName)
    : null;
  const instanceExpressionEditable = Boolean(
    instanceStyleTarget &&
    componentFile &&
    canPatchThemeInstanceStyleClasses(
      componentFile.content,
      sourceElementName,
      instanceStyleTarget,
    ),
  );

  const isDynamicClassName = Boolean(
    targetElementMeta?.classNameOffsets?.isExpression,
  );
  const isDomOnlyNestedTarget =
    activeSelectionIsSection === false && !targetElementMeta;
  const hasSyntaxError = parsedMeta ? !parsedMeta.parseOk : false;
  const sourceStyleLocked =
    hasSyntaxError ||
    (isDynamicClassName && !instanceExpressionEditable) ||
    isDomOnlyNestedTarget;
  const visibleModules = new Set(
    resolveInspectorModules({
      kind: selectedKind,
      isSection: activeSelectionIsSection === true,
      tagName: selection?.tagName ?? undefined,
      role: selection?.role ?? undefined,
      inputType: selection?.inputType ?? undefined,
      computedStyle: activeComputedStyle ?? undefined,
      parentComputedStyle: selection?.parentComputed ?? undefined,
      contentFieldBinding: activeFieldPath,
      sourceEditability: {
        className: Boolean(
          componentPath &&
          targetElementMeta?.classNameOffsets &&
          (!isDynamicClassName || instanceExpressionEditable),
        ),
        style: !componentFile,
        dynamic: sourceStyleLocked,
      },
      override: selection?.inspectorOverride,
    }),
  );

  // Code as SSOT: derive style values from the source code AST
  const targetClassName =
    instanceStyleClassName ??
    editableBaseClassName ??
    targetElementMeta?.className ??
    "";
  const sectionClassName = sectionElementMeta?.className || "";
  const hasResolvedContainerSource = isSelectedNode
    ? Boolean(targetElementMeta)
    : Boolean(sectionElementMeta);
  const hasResolvedTextSource = Boolean(targetElementMeta);

  const fontSizeDetailed = parseTailwindFontSizeDetailed(targetClassName);
  const isComplexFontSize = fontSizeDetailed.type === "complex";
  const complexFontSizeRaw =
    fontSizeDetailed.type === "complex" ? fontSizeDetailed.raw : null;

  const computedFontSizeNum = parsePx(activeComputedStyle?.fontSize);
  const effectiveFontSize =
    optimisticNumber("fontSize") ??
    computedFontSizeNum ??
    (fontSizeDetailed.type === "exact"
      ? fontSizeDetailed.value
      : typeof props.fontSize === "number"
        ? props.fontSize
        : 48);

  const effectiveFontFamily =
    optimisticValue("fontFamily") ??
    computedFontFamilyKind(activeComputedStyle?.fontFamily) ??
    parseTailwindFontFamily(targetClassName) ??
    props.fontFamily ??
    "serif";

  const effectiveFontWeight =
    optimisticValue("fontWeight") ??
    computedFontWeightKind(activeComputedStyle?.fontWeight) ??
    parseTailwindFontWeight(targetClassName) ??
    props.fontWeight ??
    "normal";

  const computedAlign = activeComputedStyle?.textAlign;
  const effectiveTextAlign =
    optimisticValue("textAlign") ??
    (computedAlign === "left" ||
    computedAlign === "center" ||
    computedAlign === "right" ||
    computedAlign === "justify" ||
    computedAlign === "start" ||
    computedAlign === "end"
      ? computedAlign
      : (parseTailwindTextAlign(targetClassName) ?? props.textAlign ?? "left"));

  const effectiveLineHeight =
    optimisticNumber("lineHeight") ??
    computedLineHeightRatio(
      activeComputedStyle?.lineHeight,
      activeComputedStyle?.fontSize,
    ) ??
    parseTailwindLineHeight(targetClassName) ??
    (typeof props.lineHeight === "number" ? props.lineHeight : 1.1);

  const containerClassName = isSelectedNode
    ? targetClassName
    : sectionClassName;
  const targetVariants =
    activeViewport === "desktop"
      ? ["lg"]
      : activeViewport === "tablet"
        ? ["md"]
        : [];
  const effectiveFontSizeLength = resolveInspectorLength({
    className: targetClassName,
    sources: [{ property: "font-size", prefix: "text" }],
    targetVariants,
    computedValue: activeComputedStyle?.fontSize,
    optimisticValue: optimisticValue("fontSize"),
    fallbackValue: effectiveFontSize,
  });
  const containerComputedStyle = isSelectedNode
    ? activeComputedStyle
    : activeSectionComputedStyle;
  const sourcePadding = parseTailwindPadding(containerClassName);
  const computedPaddingTop = parsePx(containerComputedStyle?.paddingTop);
  const computedPaddingBottom = parsePx(containerComputedStyle?.paddingBottom);
  const computedPaddingLeft = parsePx(containerComputedStyle?.paddingLeft);
  const computedPaddingRight = parsePx(containerComputedStyle?.paddingRight);
  const sourcePaddingAll =
    sourcePadding.all ??
    (typeof props.padding === "number" ? props.padding : 48);

  const effectivePaddingTop =
    optimisticNumber("paddingTop") ??
    computedPaddingTop ??
    sourcePadding.top ??
    sourcePadding.y ??
    sourcePaddingAll;
  const effectivePaddingBottom =
    optimisticNumber("paddingBottom") ??
    computedPaddingBottom ??
    sourcePadding.bottom ??
    sourcePadding.y ??
    sourcePaddingAll;
  const effectivePaddingLeft =
    optimisticNumber("paddingLeft") ??
    computedPaddingLeft ??
    sourcePadding.left ??
    sourcePadding.x ??
    (typeof props.paddingLeft === "number" ? props.paddingLeft : 24);
  const effectivePaddingRight =
    optimisticNumber("paddingRight") ??
    computedPaddingRight ??
    sourcePadding.right ??
    sourcePadding.x ??
    (typeof props.paddingRight === "number" ? props.paddingRight : 24);
  const effectivePaddingAll =
    optimisticNumber("paddingAll") ??
    (effectivePaddingTop === effectivePaddingBottom &&
    effectivePaddingTop === effectivePaddingLeft &&
    effectivePaddingTop === effectivePaddingRight
      ? effectivePaddingTop
      : sourcePaddingAll);
  const effectivePaddingLengths = {
    all: resolveInspectorLength({
      className: containerClassName,
      sources: [{ property: "padding", prefix: "p" }],
      targetVariants,
      computedValue: containerComputedStyle?.paddingTop,
      optimisticValue: optimisticValue("paddingAll"),
      fallbackValue: effectivePaddingAll,
    }),
    top: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "padding-top", prefix: "pt" },
        { property: "padding-y", prefix: "py" },
        { property: "padding", prefix: "p" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.paddingTop,
      optimisticValue: optimisticValue("paddingTop"),
      fallbackValue: effectivePaddingTop,
    }),
    bottom: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "padding-bottom", prefix: "pb" },
        { property: "padding-y", prefix: "py" },
        { property: "padding", prefix: "p" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.paddingBottom,
      optimisticValue: optimisticValue("paddingBottom"),
      fallbackValue: effectivePaddingBottom,
    }),
    left: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "padding-left", prefix: "pl" },
        { property: "padding-x", prefix: "px" },
        { property: "padding", prefix: "p" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.paddingLeft,
      optimisticValue: optimisticValue("paddingLeft"),
      fallbackValue: effectivePaddingLeft,
    }),
    right: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "padding-right", prefix: "pr" },
        { property: "padding-x", prefix: "px" },
        { property: "padding", prefix: "p" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.paddingRight,
      optimisticValue: optimisticValue("paddingRight"),
      fallbackValue: effectivePaddingRight,
    }),
  };

  const effectiveMarginLengths = {
    all: resolveInspectorLength({
      className: containerClassName,
      sources: [{ property: "margin", prefix: "m" }],
      targetVariants,
      computedValue: containerComputedStyle?.marginTop,
      optimisticValue: optimisticValue("marginAll"),
      fallbackValue: 0,
    }),
    top: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "margin-top", prefix: "mt" },
        { property: "margin-y", prefix: "my" },
        { property: "margin", prefix: "m" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.marginTop,
      optimisticValue: optimisticValue("marginTop"),
      fallbackValue: 0,
    }),
    bottom: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "margin-bottom", prefix: "mb" },
        { property: "margin-y", prefix: "my" },
        { property: "margin", prefix: "m" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.marginBottom,
      optimisticValue: optimisticValue("marginBottom"),
      fallbackValue: 0,
    }),
    left: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "margin-left", prefix: "ml" },
        { property: "margin-x", prefix: "mx" },
        { property: "margin", prefix: "m" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.marginLeft,
      optimisticValue: optimisticValue("marginLeft"),
      fallbackValue: 0,
    }),
    right: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "margin-right", prefix: "mr" },
        { property: "margin-x", prefix: "mx" },
        { property: "margin", prefix: "m" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.marginRight,
      optimisticValue: optimisticValue("marginRight"),
      fallbackValue: 0,
    }),
  };

  const computedBackgroundImage = containerComputedStyle?.backgroundImage;
  const sourceTextGradient = parseTailwindTextGradient(targetClassName);
  const containerTextGradient = parseTailwindTextGradient(containerClassName);
  const sourceBackgroundPaint = !containerTextGradient
    ? (parseTailwindBackgroundPaint(containerClassName) ??
      parseTailwindBackgroundColor(containerClassName))
    : null;
  const sourceTextPaint =
    sourceTextGradient ?? parseTailwindTextColor(targetClassName);
  const effectiveBackgroundPaint =
    optimisticValue("backgroundPaint") ??
    sourceBackgroundPaint ??
    (hasResolvedContainerSource
      ? ""
      : ((!containerTextGradient &&
        computedBackgroundImage &&
        computedBackgroundImage !== "none"
          ? computedBackgroundImage
          : undefined) ??
        computedColorToHex(containerComputedStyle?.backgroundColor) ??
        props.backgroundColor ??
        "#fafaf9"));
  const effectiveTextPaint =
    optimisticValue("textPaint") ??
    sourceTextPaint ??
    (hasResolvedTextSource
      ? ""
      : (computedColorToHex(activeComputedStyle?.color) ??
        props.textColor ??
        "#1c1917"));
  const sourceBorderRadii = parseTailwindBorderRadii(containerClassName);
  const computedBorderRadius = parsePx(containerComputedStyle?.borderRadius);
  const sourceCornerValues = [
    sourceBorderRadii.topLeft,
    sourceBorderRadii.topRight,
    sourceBorderRadii.bottomRight,
    sourceBorderRadii.bottomLeft,
  ];
  const commonSourceCornerRadius =
    sourceCornerValues.every(
      (value) => value !== null && value === sourceCornerValues[0],
    ) && sourceCornerValues[0] !== null
      ? sourceCornerValues[0]
      : null;
  const effectiveBorderRadius =
    optimisticNumber("borderRadius") ??
    sourceBorderRadii.all ??
    commonSourceCornerRadius ??
    (hasResolvedContainerSource
      ? 0
      : (computedBorderRadius ??
        (typeof props.borderRadius === "number" ? props.borderRadius : 0)));
  const resolveCornerRadius = (
    optimisticKey: string,
    sourceValue: number | null,
    computedKey: string,
  ) =>
    optimisticNumber(optimisticKey) ??
    sourceValue ??
    (hasResolvedContainerSource
      ? 0
      : (parsePx(containerComputedStyle?.[computedKey]) ??
        computedBorderRadius ??
        effectiveBorderRadius));
  const effectiveBorderRadii = {
    all: effectiveBorderRadius,
    topLeft: resolveCornerRadius(
      "borderRadiusTopLeft",
      sourceBorderRadii.topLeft,
      "borderTopLeftRadius",
    ),
    topRight: resolveCornerRadius(
      "borderRadiusTopRight",
      sourceBorderRadii.topRight,
      "borderTopRightRadius",
    ),
    bottomRight: resolveCornerRadius(
      "borderRadiusBottomRight",
      sourceBorderRadii.bottomRight,
      "borderBottomRightRadius",
    ),
    bottomLeft: resolveCornerRadius(
      "borderRadiusBottomLeft",
      sourceBorderRadii.bottomLeft,
      "borderBottomLeftRadius",
    ),
  };
  const effectiveBorderRadiusLengths = {
    all: resolveInspectorLength({
      className: containerClassName,
      sources: [{ property: "border-radius", prefix: "rounded" }],
      targetVariants,
      computedValue: containerComputedStyle?.borderRadius,
      optimisticValue: optimisticValue("borderRadius"),
      fallbackValue: effectiveBorderRadii.all,
    }),
    topLeft: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-radius-top-left", prefix: "rounded-tl" },
        { property: "border-radius", prefix: "rounded" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderTopLeftRadius,
      optimisticValue: optimisticValue("borderRadiusTopLeft"),
      fallbackValue: effectiveBorderRadii.topLeft,
    }),
    topRight: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-radius-top-right", prefix: "rounded-tr" },
        { property: "border-radius", prefix: "rounded" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderTopRightRadius,
      optimisticValue: optimisticValue("borderRadiusTopRight"),
      fallbackValue: effectiveBorderRadii.topRight,
    }),
    bottomRight: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-radius-bottom-right", prefix: "rounded-br" },
        { property: "border-radius", prefix: "rounded" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderBottomRightRadius,
      optimisticValue: optimisticValue("borderRadiusBottomRight"),
      fallbackValue: effectiveBorderRadii.bottomRight,
    }),
    bottomLeft: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-radius-bottom-left", prefix: "rounded-bl" },
        { property: "border-radius", prefix: "rounded" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderBottomLeftRadius,
      optimisticValue: optimisticValue("borderRadiusBottomLeft"),
      fallbackValue: effectiveBorderRadii.bottomLeft,
    }),
  };
  const effectiveBorderWidth =
    optimisticNumber("borderWidth") ??
    parseTailwindBorderWidth(containerClassName) ??
    (hasResolvedContainerSource
      ? 0
      : (parsePx(containerComputedStyle?.borderTopWidth) ?? 0));
  const effectiveBorderWidthLength = resolveInspectorLength({
    className: containerClassName,
    sources: [{ property: "border-width", prefix: "border" }],
    targetVariants,
    computedValue: containerComputedStyle?.borderTopWidth,
    optimisticValue: optimisticValue("borderWidth"),
    fallbackValue: effectiveBorderWidth,
  });
  const effectiveBorderStyle =
    optimisticValue("borderStyle") ??
    parseTailwindBorderStyle(containerClassName) ??
    (hasResolvedContainerSource
      ? "solid"
      : (containerComputedStyle?.borderTopStyle ?? "solid"));
  const effectiveBorderColor =
    optimisticValue("borderColor") ??
    parseTailwindBorderColor(containerClassName) ??
    (hasResolvedContainerSource
      ? ""
      : (computedColorToHex(containerComputedStyle?.borderTopColor) ?? ""));
  const inspectorIdentity =
    section.id +
    ":" +
    (activeFieldPath ?? "") +
    ":" +
    targetElement +
    ":" +
    activeViewport;
  const inspectorIdentityRef = useRef(inspectorIdentity);
  useEffect(() => {
    if (inspectorIdentityRef.current === inspectorIdentity) return;
    inspectorIdentityRef.current = inspectorIdentity;
    optimisticStyleRef.current = {
      key: inspectorIdentity,
      revision: 0,
      values: {},
    };
  }, [inspectorIdentity]);

  const effectiveRawClassName =
    instanceStyleClassName ??
    resolveStyleInspectorClassName(
      targetElementMeta,
      sectionClassName,
      activeClassName,
      props.className,
      props.customClass,
    );
  const tailwindClassCount = tokenizeTailwindClasses(
    effectiveRawClassName,
  ).length;

  const patchTailwindClasses = useCallback(
    (current: string, options: Omit<PatchTailwindOptions, "targetVariants">) =>
      patchTailwindClassesBase(current, {
        ...options,
        targetVariants,
      }),
    [activeViewport],
  );

  const containerTargetElement = isSelectedNode
    ? targetElement
    : parsedMeta?.elements["section"]
      ? "section"
      : parsedMeta?.elements["root"]
        ? "root"
        : targetElement;
  const previewStyle = useCallback(
    (styles: Record<string, string>) =>
      onPreviewSelectionStyle?.(styles, targetElement),
    [onPreviewSelectionStyle, targetElement],
  );
  const previewContainerStyle = useCallback(
    (styles: Record<string, string>) =>
      onPreviewSelectionStyle?.(styles, containerTargetElement),
    [containerTargetElement, onPreviewSelectionStyle],
  );

  const resolveCommittedInstanceStyleTarget = useCallback(():
    | ThemeInstanceStyleTarget
    | undefined => {
    if (!activeFieldPath || !activeRepeatedItemPath) return undefined;
    const currentItem = getFieldPathValue(
      localPropsRef.current,
      activeRepeatedItemPath,
    );
    const existingId =
      currentItem &&
      typeof currentItem === "object" &&
      typeof (currentItem as Record<string, unknown>).id === "string"
        ? ((currentItem as Record<string, unknown>).id as string)
        : null;
    const itemId = existingId || createMorphItemId();
    if (!existingId) {
      const next = setFieldPathValue(
        localPropsRef.current,
        activeRepeatedItemPath + ".id",
        itemId,
      );
      localPropsRef.current = next;
      setLocalProps(next);
      onPropsChange(next);
    }
    return { sectionId: section.id, fieldPath: activeFieldPath, itemId };
  }, [activeFieldPath, activeRepeatedItemPath, onPropsChange, section.id]);

  const patchStyle = useCallback(
    (
      updater: (prevClasses: string) => string,
      optimistic?: Record<string, string | number>,
    ) => {
      if (!componentPath || sourceStyleLocked) return;
      const revision = onUpdateThemeFileStyle?.(
        componentPath,
        targetElement,
        updater,
        resolveCommittedInstanceStyleTarget(),
      );
      if (optimistic) {
        optimisticStyleRef.current = {
          key: section.id + ":" + targetElement + ":" + activeViewport,
          revision:
            typeof revision === "number"
              ? revision
              : activeComputedStyleRevision + 1,
          values: { ...optimisticStyleRef.current.values, ...optimistic },
        };
      }
    },
    [
      activeComputedStyleRevision,
      activeViewport,
      componentPath,
      onUpdateThemeFileStyle,
      resolveCommittedInstanceStyleTarget,
      section.id,
      sourceStyleLocked,
      targetElement,
    ],
  );

  const patchContainerStyle = useCallback(
    (
      updater: (prevClasses: string) => string,
      optimistic?: Record<string, string | number>,
    ) => {
      if (!componentPath || sourceStyleLocked) return;
      const revision = onUpdateThemeFileStyle?.(
        componentPath,
        containerTargetElement,
        updater,
        resolveCommittedInstanceStyleTarget(),
      );
      if (optimistic) {
        optimisticStyleRef.current = {
          key: section.id + ":" + containerTargetElement + ":" + activeViewport,
          revision:
            typeof revision === "number"
              ? revision
              : activeComputedStyleRevision + 1,
          values: { ...optimisticStyleRef.current.values, ...optimistic },
        };
      }
    },
    [
      componentPath,
      activeComputedStyleRevision,
      activeViewport,
      containerTargetElement,
      onUpdateThemeFileStyle,
      resolveCommittedInstanceStyleTarget,
      sourceStyleLocked,
      section.id,
    ],
  );

  const commitContainerProperty = useCallback(
    (
      property: PatchTailwindOptions["property"],
      utility: string,
      optimisticKey: string,
      optimisticValue: string | number,
    ) => {
      patchContainerStyle(
        (previous) =>
          patchTailwindClasses(previous, { property, value: utility }),
        { [optimisticKey]: optimisticValue },
      );
    },
    [patchContainerStyle, patchTailwindClasses],
  );

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      const currentProps = localPropsRef.current;
      const next = activeFieldPath?.endsWith("." + field)
        ? setFieldPathValue(currentProps, activeFieldPath, value)
        : { ...currentProps, [field]: value };
      localPropsRef.current = next;
      setLocalProps(next);
      onPropsChange(next);
    },
    [activeFieldPath, onPropsChange],
  );
  const handleNestedFieldChange = useCallback(
    (path: string, value: unknown) => {
      const next = setFieldPathValue(localPropsRef.current, path, value);
      localPropsRef.current = next;
      setLocalProps(next);
      onPropsChange(next);
    },
    [onPropsChange],
  );

  return (
    <div className="space-y-3 p-3 text-xs">
      {/* Component Header & Code Bridge */}
      <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Paintbrush className="size-3.5" />
            </span>
            <div>
              <h4 className="font-semibold text-foreground text-xs leading-none capitalize">
                {(isSelectedNode ? selectedKind : section.type).replace(
                  /-/g,
                  " ",
                )}
              </h4>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                {section.id.slice(0, 16)}...
              </p>
            </div>
          </div>
        </div>

        {/* Jump to Source Code Bridge */}
        <div className="pt-2 border-t flex items-center gap-2">
          {componentPath ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-7 w-full gap-1.5 text-xs font-medium justify-start"
              onClick={() => {
                const file = themeFiles?.find((f) => f.path === componentPath);
                const loc = file?.content
                  ? (findSourceLocation(file.content, targetElement) ??
                    findSourceLocation(file.content, "heading"))
                  : null;
                onJumpToCode?.(componentPath, loc?.line, loc?.column);
              }}
              title={`Open ${componentPath} in Monaco Code Editor`}
            >
              <Code2 className="size-3.5 text-primary shrink-0" />
              <span className="truncate">Edit in Code ({targetElement})</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-28">
                {componentPath.split("/").pop()}
              </span>
            </Button>
          ) : (
            <div className="w-full flex items-center justify-between rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
              <span>Section has no source file</span>
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                CMS-only
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Syntax Error Alert */}
      {hasSyntaxError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5 shadow-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
          <div className="space-y-1">
            <div className="font-semibold text-xs leading-none">
              TSX Syntax Errors in Source
            </div>
            <p className="text-[11px] opacity-90 leading-relaxed">
              {componentPath?.split("/").pop()} contains syntax errors. Visual
              style patching is paused until syntax is resolved in Code mode.
            </p>
          </div>
        </div>
      )}

      {/* Dynamic ClassName (Code-controlled) Banner */}
      {!hasSyntaxError && isDynamicClassName && !instanceExpressionEditable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5 shadow-xs">
          <Code2 className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <div className="font-semibold text-xs leading-none">
              Code-Controlled ClassName ({targetElement})
            </div>
            <p className="text-[11px] opacity-90 leading-relaxed">
              This element uses a dynamic expression (e.g. <code>cn(...)</code>
              ). Direct style patching is disabled to protect component logic.
            </p>
          </div>
        </div>
      )}

      {/* Advanced source classes */}
      {visibleModules.has("source-style") && (
        <InspectorGroup
          title={`Tailwind CSS Classes · ${tailwindClassCount}`}
          icon={<Code2 className="size-3.5" />}
          expanded={sectionsExpanded.tailwind}
          onToggle={() => toggleSection("tailwind")}
        >
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {isDomOnlyNestedTarget
                ? "Tailwind utility classes read from the selected rendered component. This DOM-only target has no editable source."
                : targetElementMeta
                  ? "Direct Tailwind utility classes applied to the selected source component."
                  : "Direct Tailwind utility classes applied to this section container."}
            </p>
            <TailwindClassTokenInput
              value={effectiveRawClassName}
              onValueChange={(nextClasses) => {
                if (sourceStyleLocked) return;
                if (componentPath) {
                  patchStyle(() => nextClasses);
                } else {
                  handleFieldChange("className", nextClasses);
                }
              }}
              disabled={disabled || sourceStyleLocked}
              placeholder="e.g. py-24 bg-stone-900"
            />
          </div>
        </InspectorGroup>
      )}

      {/* 1. Content & Text Fields */}
      {(visibleModules.has("content") || visibleModules.has("media")) && (
        <InspectorGroup
          title="Content & Fields"
          icon={<Sliders className="size-3.5" />}
          expanded={sectionsExpanded.content}
          onToggle={() => toggleSection("content")}
        >
          <div className="space-y-3">
            {isSelectedNode &&
              activeFieldPath &&
              selectedField &&
              ![
                "heading",
                "description",
                "body",
                "label",
                "eyebrow",
                "actionLabel",
                "actionHref",
                "imageSrc",
                "imageAlt",
                "imagePosition",
              ].includes(selectedField) &&
              (typeof fieldValue(selectedField) === "object" &&
              fieldValue(selectedField) !== null ? (
                Object.entries(
                  fieldValue(selectedField) as Record<string, unknown>,
                )
                  .filter(
                    ([, value]) =>
                      value === null ||
                      ["string", "number", "boolean"].includes(typeof value),
                  )
                  .map(([key, value]) => (
                    <InspectorField key={key} label={key.replace(/[-_]/g, " ")}>
                      <Input
                        defaultValue={String(value ?? "")}
                        onInput={(e) =>
                          onPreviewSelectionField?.(
                            key,
                            activeFieldPath + "." + key,
                            e.currentTarget.value,
                          )
                        }
                        onBlur={(e) =>
                          handleNestedFieldChange(
                            activeFieldPath + "." + key,
                            e.currentTarget.value,
                          )
                        }
                        disabled={disabled}
                        className="h-8 text-xs"
                      />
                    </InspectorField>
                  ))
              ) : (
                <InspectorField label={selectedField.replace(/[-_]/g, " ")}>
                  <Textarea
                    rows={3}
                    defaultValue={String(fieldValue(selectedField) ?? "")}
                    onInput={(e) =>
                      onPreviewSelectionField?.(
                        selectedField,
                        activeFieldPath,
                        e.currentTarget.value,
                      )
                    }
                    onBlur={(e) =>
                      handleFieldChange(selectedField, e.currentTarget.value)
                    }
                    disabled={disabled}
                    className="min-h-16 resize-none text-xs"
                  />
                </InspectorField>
              ))}
            {showField("eyebrow") && "eyebrow" in props && (
              <InspectorField
                label="Eyebrow / Subtitle"
                isFocused={activeFieldKey === "eyebrow"}
              >
                <Input
                  defaultValue={props.eyebrow ?? ""}
                  onInput={(e) =>
                    onPreviewSelectionField?.(
                      "eyebrow",
                      nestedFieldPath("eyebrow"),
                      e.currentTarget.value,
                    )
                  }
                  onBlur={(e) =>
                    handleFieldChange("eyebrow", e.currentTarget.value)
                  }
                  disabled={disabled}
                  placeholder="Eyebrow text..."
                  className="h-8 text-xs"
                />
              </InspectorField>
            )}

            {showField("label") && "label" in props && (
              <InspectorField
                label="Label"
                isFocused={activeFieldKey === "label"}
              >
                <Input
                  defaultValue={props.label ?? ""}
                  onInput={(e) =>
                    onPreviewSelectionField?.(
                      "label",
                      nestedFieldPath("label"),
                      e.currentTarget.value,
                    )
                  }
                  onBlur={(e) =>
                    handleFieldChange("label", e.currentTarget.value)
                  }
                  disabled={disabled}
                  placeholder="Section label..."
                  className="h-8 text-xs"
                />
              </InspectorField>
            )}

            {showField("heading") && "heading" in props && (
              <InspectorField
                label="Heading"
                isFocused={activeFieldKey === "heading"}
              >
                <Textarea
                  rows={2}
                  defaultValue={props.heading ?? ""}
                  onInput={(e) =>
                    onPreviewSelectionField?.(
                      "heading",
                      nestedFieldPath("heading"),
                      e.currentTarget.value,
                    )
                  }
                  onBlur={(e) =>
                    handleFieldChange("heading", e.currentTarget.value)
                  }
                  disabled={disabled}
                  placeholder="Main headline..."
                  className="min-h-16 text-xs resize-none"
                />
              </InspectorField>
            )}

            {showField("description", "body") && "description" in props && (
              <InspectorField
                label="Description"
                isFocused={activeFieldKey === "description"}
              >
                <Textarea
                  rows={3}
                  defaultValue={props.description ?? ""}
                  onInput={(e) =>
                    onPreviewSelectionField?.(
                      "description",
                      nestedFieldPath("description"),
                      e.currentTarget.value,
                    )
                  }
                  onBlur={(e) =>
                    handleFieldChange("description", e.currentTarget.value)
                  }
                  disabled={disabled}
                  placeholder="Body description..."
                  className="min-h-20 text-xs resize-none"
                />
              </InspectorField>
            )}

            {showField("body", "description") &&
              ("body" in props || hasActiveRepeatedBody) && (
                <InspectorField
                  label="Body text"
                  isFocused={activeFieldKey === "body"}
                >
                  <Textarea
                    rows={3}
                    defaultValue={String(
                      hasActiveRepeatedBody
                        ? (selectedFieldValue("body") ?? "")
                        : (props.body ?? ""),
                    )}
                    onInput={(e) =>
                      onPreviewSelectionField?.(
                        "body",
                        nestedFieldPath("body"),
                        e.currentTarget.value,
                      )
                    }
                    onBlur={(e) =>
                      handleFieldChange("body", e.currentTarget.value)
                    }
                    disabled={disabled}
                    placeholder="Section body text..."
                    className="min-h-20 text-xs resize-none"
                  />
                </InspectorField>
              )}

            {showField("actionLabel", "actionHref", "action") &&
              "actionLabel" in props && (
                <div
                  className={cn(
                    "space-y-2 rounded-lg border p-2.5 transition-all",
                    activeFieldKey === "actionLabel" ||
                      activeFieldKey === "actionHref" ||
                      activeElementKey === "action"
                      ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                      : "bg-muted/20",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Link className="size-3 text-muted-foreground" />
                    <span>Action Button</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">
                        Label
                      </label>
                      <Input
                        defaultValue={props.actionLabel ?? ""}
                        onInput={(e) =>
                          onPreviewSelectionField?.(
                            "actionLabel",
                            nestedFieldPath("actionLabel"),
                            e.currentTarget.value,
                          )
                        }
                        onBlur={(e) =>
                          handleFieldChange(
                            "actionLabel",
                            e.currentTarget.value,
                          )
                        }
                        disabled={disabled}
                        placeholder="Button text"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">
                        Link URL
                      </label>
                      <Input
                        defaultValue={props.actionHref ?? ""}
                        onBlur={(e) =>
                          handleFieldChange("actionHref", e.currentTarget.value)
                        }
                        disabled={disabled}
                        placeholder="/collections/all"
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

            {showField("imageSrc", "imageAlt", "imagePosition", "image") &&
              selectedFieldValue("imageSrc") !== undefined && (
                <div
                  className={cn(
                    "space-y-2 rounded-lg border p-2.5 transition-all",
                    activeFieldKey === "imageSrc" ||
                      activeFieldKey === "imageAlt" ||
                      activeElementKey === "image"
                      ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                      : "bg-muted/20",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <ImageIcon className="size-3 text-muted-foreground" />
                      <span>Media Image</span>
                    </span>
                    {selectedFieldValue("imagePosition") !== undefined && (
                      <Select
                        value={String(
                          selectedFieldValue("imagePosition") ?? "center",
                        )}
                        onValueChange={(val) => {
                          previewStyle({ "object-position": val });
                          nestedFieldPath("imagePosition")
                            ? handleNestedFieldChange(
                                nestedFieldPath("imagePosition")!,
                                val,
                              )
                            : handleFieldChange("imagePosition", val);
                          patchStyle((prev) =>
                            patchTailwindClasses(prev, {
                              property: "object-position",
                              value: "object-" + val,
                            }),
                          );
                        }}
                        disabled={disabled}
                      >
                        <InspectorSelectTrigger className="h-7 w-24">
                          <SelectValue placeholder="Position" />
                        </InspectorSelectTrigger>
                        <InspectorSelectContent>
                          <InspectorSelectItem value="center">
                            Center
                          </InspectorSelectItem>
                          <InspectorSelectItem value="top">
                            Top
                          </InspectorSelectItem>
                          <InspectorSelectItem value="bottom">
                            Bottom
                          </InspectorSelectItem>
                          <InspectorSelectItem value="left">
                            Left
                          </InspectorSelectItem>
                          <InspectorSelectItem value="right">
                            Right
                          </InspectorSelectItem>
                        </InspectorSelectContent>
                      </Select>
                    )}
                  </div>
                  <Input
                    defaultValue={String(selectedFieldValue("imageSrc") ?? "")}
                    onBlur={(e) =>
                      nestedFieldPath("imageSrc")
                        ? handleNestedFieldChange(
                            nestedFieldPath("imageSrc")!,
                            e.currentTarget.value,
                          )
                        : handleFieldChange("imageSrc", e.currentTarget.value)
                    }
                    disabled={disabled}
                    placeholder="Image URL path..."
                    className="h-7 text-xs font-mono"
                  />
                  {selectedFieldValue("imageAlt") !== undefined && (
                    <Input
                      defaultValue={String(
                        selectedFieldValue("imageAlt") ?? "",
                      )}
                      onInput={(e) =>
                        onPreviewSelectionField?.(
                          "imageAlt",
                          nestedFieldPath("imageAlt"),
                          e.currentTarget.value,
                        )
                      }
                      onBlur={(e) =>
                        nestedFieldPath("imageAlt")
                          ? handleNestedFieldChange(
                              nestedFieldPath("imageAlt")!,
                              e.currentTarget.value,
                            )
                          : handleFieldChange("imageAlt", e.currentTarget.value)
                      }
                      disabled={disabled}
                      placeholder="Alt text description"
                      className="h-7 text-xs"
                    />
                  )}
                  {visibleModules.has("media") && (
                    <div className="grid grid-cols-2 gap-2 border-t pt-2">
                      <InspectorSelectControl
                        label="Fit"
                        ariaLabel="Object fit"
                        value={
                          targetClassName.includes("object-contain")
                            ? "contain"
                            : targetClassName.includes("object-fill")
                              ? "fill"
                              : targetClassName.includes("object-none")
                                ? "none"
                                : targetClassName.includes("object-scale-down")
                                  ? "scale-down"
                                  : "cover"
                        }
                        options={[
                          "cover",
                          "contain",
                          "fill",
                          "none",
                          "scale-down",
                        ]}
                        formatOption={(value) =>
                          value === "scale-down"
                            ? "Scale down"
                            : value.charAt(0).toUpperCase() + value.slice(1)
                        }
                        onValueChange={(value) => {
                          previewStyle({ "object-fit": value });
                          patchStyle((prev) =>
                            patchTailwindClasses(prev, {
                              property: "object-fit",
                              value: "object-" + value,
                            }),
                          );
                        }}
                        disabled={disabled || sourceStyleLocked}
                      />
                      <InspectorSelectControl
                        label="Ratio"
                        ariaLabel="Aspect ratio"
                        value={
                          targetClassName.match(/aspect-\[([^\]]+)\]/)?.[1] ??
                          "auto"
                        }
                        options={["auto", "1/1", "4/3", "4/5", "16/9"]}
                        formatOption={(value) =>
                          value === "auto"
                            ? "Auto"
                            : value === "1/1"
                              ? "Square"
                              : value.replace("/", ":")
                        }
                        onValueChange={(value) => {
                          previewStyle({
                            "aspect-ratio":
                              value === "auto"
                                ? "auto"
                                : value.replace("/", " / "),
                          });
                          patchStyle((prev) =>
                            patchTailwindClasses(prev, {
                              property: "aspect-ratio",
                              value:
                                value === "auto"
                                  ? "aspect-auto"
                                  : "aspect-[" + value + "]",
                            }),
                          );
                        }}
                        disabled={disabled || sourceStyleLocked}
                      />
                    </div>
                  )}
                </div>
              )}
          </div>
        </InspectorGroup>
      )}

      {hasInspectorDesignModule(visibleModules) ? (
        <div
          data-inspector-module="Styles"
          className="relative rounded-xl bg-background shadow-xs overflow-hidden"
        >
          <InspectorBreakpointIndicator viewport={activeViewport} />
          <InspectorModuleStaticSections>
            {visibleModules.has("layout") || visibleModules.has("spacing") ? (
              <LayoutInspectorModule
                expanded={sectionsExpanded.flow}
                onToggle={() => toggleSection("flow")}
                computed={containerComputedStyle}
                disabled={disabled || sourceStyleLocked || !componentFile}
                onPreview={previewContainerStyle}
                onCommit={commitContainerProperty}
              >
                {visibleModules.has("spacing") ? (
                  <div className="space-y-3">
                    <div className="space-y-3">
                      {/* Padding */}
                      <InspectorDisclosureField
                        id="padding-side-controls"
                        expanded={paddingExpanded}
                        onExpandedChange={setPaddingExpanded}
                        expandLabel="Expand individual padding sides"
                        collapseLabel="Collapse individual padding sides"
                        icon={
                          <RxPadding className="size-4" aria-hidden="true" />
                        }
                        field={
                          <InspectorLengthControl
                            label="Padding"
                            ariaLabel="Section padding"
                            value={effectivePaddingLengths.all}
                            computedValue={containerComputedStyle?.paddingTop}
                            min={0}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "padding-top": cssValue,
                                "padding-bottom": cssValue,
                                "padding-left": cssValue,
                                "padding-right": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("padding", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(
                                    patchTailwindClasses(
                                      patchTailwindClasses(
                                        patchTailwindClasses(
                                          patchTailwindClasses(prev, {
                                            property: "padding",
                                            value: inspectorLengthUtility(
                                              "p",
                                              cssValue,
                                            ),
                                          }),
                                          {
                                            property: "padding-top",
                                            value: "",
                                          },
                                        ),
                                        {
                                          property: "padding-bottom",
                                          value: "",
                                        },
                                      ),
                                      { property: "padding-left", value: "" },
                                    ),
                                    { property: "padding-right", value: "" },
                                  ),
                                {
                                  paddingAll: cssValue,
                                  paddingTop: cssValue,
                                  paddingBottom: cssValue,
                                  paddingLeft: cssValue,
                                  paddingRight: cssValue,
                                },
                              );
                            }}
                            className="flex-1"
                          />
                        }
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorLengthControl
                            label="T"
                            ariaLabel="Top padding"
                            value={effectivePaddingLengths.top}
                            computedValue={containerComputedStyle?.paddingTop}
                            min={0}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({ "padding-top": cssValue })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("paddingTop", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "padding-top",
                                    value: inspectorLengthUtility(
                                      "pt",
                                      cssValue,
                                    ),
                                  }),
                                { paddingTop: cssValue },
                              );
                            }}
                          />
                          <InspectorLengthControl
                            label="B"
                            ariaLabel="Bottom padding"
                            value={effectivePaddingLengths.bottom}
                            computedValue={
                              containerComputedStyle?.paddingBottom
                            }
                            min={0}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "padding-bottom": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange(
                                  "paddingBottom",
                                  numericValue,
                                );
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "padding-bottom",
                                    value: inspectorLengthUtility(
                                      "pb",
                                      cssValue,
                                    ),
                                  }),
                                { paddingBottom: cssValue },
                              );
                            }}
                          />
                          <InspectorLengthControl
                            label="L"
                            ariaLabel="Left padding"
                            value={effectivePaddingLengths.left}
                            computedValue={containerComputedStyle?.paddingLeft}
                            min={0}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "padding-left": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("paddingLeft", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "padding-left",
                                    value: inspectorLengthUtility(
                                      "pl",
                                      cssValue,
                                    ),
                                  }),
                                { paddingLeft: cssValue },
                              );
                            }}
                          />
                          <InspectorLengthControl
                            label="R"
                            ariaLabel="Right padding"
                            value={effectivePaddingLengths.right}
                            computedValue={containerComputedStyle?.paddingRight}
                            min={0}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "padding-right": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("paddingRight", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "padding-right",
                                    value: inspectorLengthUtility(
                                      "pr",
                                      cssValue,
                                    ),
                                  }),
                                { paddingRight: cssValue },
                              );
                            }}
                          />
                        </div>
                      </InspectorDisclosureField>

                      {/* Margin */}
                      <InspectorDisclosureField
                        id="margin-side-controls"
                        expanded={marginExpanded}
                        onExpandedChange={setMarginExpanded}
                        expandLabel="Expand individual margin sides"
                        collapseLabel="Collapse individual margin sides"
                        icon={
                          <RxPadding className="size-4" aria-hidden="true" />
                        }
                        field={
                          <InspectorLengthControl
                            label="Margin"
                            ariaLabel="Section margin"
                            value={effectiveMarginLengths.all}
                            computedValue={containerComputedStyle?.marginTop}
                            min={-10_000}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "margin-top": cssValue,
                                "margin-bottom": cssValue,
                                "margin-left": cssValue,
                                "margin-right": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("margin", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(
                                    patchTailwindClasses(
                                      patchTailwindClasses(
                                        patchTailwindClasses(
                                          patchTailwindClasses(prev, {
                                            property: "margin",
                                            value: inspectorLengthUtility(
                                              "p",
                                              cssValue,
                                            ),
                                          }),
                                          { property: "margin-top", value: "" },
                                        ),
                                        {
                                          property: "margin-bottom",
                                          value: "",
                                        },
                                      ),
                                      { property: "margin-left", value: "" },
                                    ),
                                    { property: "margin-right", value: "" },
                                  ),
                                {
                                  marginAll: cssValue,
                                  marginTop: cssValue,
                                  marginBottom: cssValue,
                                  marginLeft: cssValue,
                                  marginRight: cssValue,
                                },
                              );
                            }}
                            className="flex-1"
                          />
                        }
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorLengthControl
                            label="T"
                            ariaLabel="Top margin"
                            value={effectiveMarginLengths.top}
                            computedValue={containerComputedStyle?.marginTop}
                            min={-10_000}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({ "margin-top": cssValue })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("marginTop", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "margin-top",
                                    value: inspectorLengthUtility(
                                      "mt",
                                      cssValue,
                                    ),
                                  }),
                                { marginTop: cssValue },
                              );
                            }}
                          />
                          <InspectorLengthControl
                            label="B"
                            ariaLabel="Bottom margin"
                            value={effectiveMarginLengths.bottom}
                            computedValue={containerComputedStyle?.marginBottom}
                            min={-10_000}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "margin-bottom": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("marginBottom", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "margin-bottom",
                                    value: inspectorLengthUtility(
                                      "mb",
                                      cssValue,
                                    ),
                                  }),
                                { marginBottom: cssValue },
                              );
                            }}
                          />
                          <InspectorLengthControl
                            label="L"
                            ariaLabel="Left margin"
                            value={effectiveMarginLengths.left}
                            computedValue={containerComputedStyle?.marginLeft}
                            min={-10_000}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({ "margin-left": cssValue })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("marginLeft", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "margin-left",
                                    value: inspectorLengthUtility(
                                      "ml",
                                      cssValue,
                                    ),
                                  }),
                                { marginLeft: cssValue },
                              );
                            }}
                          />
                          <InspectorLengthControl
                            label="R"
                            ariaLabel="Right margin"
                            value={effectiveMarginLengths.right}
                            computedValue={containerComputedStyle?.marginRight}
                            min={-10_000}
                            max={10_000}
                            step={4}
                            disabled={disabled || sourceStyleLocked}
                            onPreview={(cssValue) =>
                              previewContainerStyle({
                                "margin-right": cssValue,
                              })
                            }
                            onCommit={(cssValue, numericValue) => {
                              if (sourceStyleLocked) return;
                              if (!componentPath && numericValue !== null) {
                                handleFieldChange("marginRight", numericValue);
                              }
                              patchContainerStyle(
                                (prev) =>
                                  patchTailwindClasses(prev, {
                                    property: "margin-right",
                                    value: inspectorLengthUtility(
                                      "mr",
                                      cssValue,
                                    ),
                                  }),
                                { marginRight: cssValue },
                              );
                            }}
                          />
                        </div>
                      </InspectorDisclosureField>

                      {/* Alignment */}
                      <InspectorControlRow
                        label="Alignment"
                        flushTrailing
                        control={
                          <div className="flex items-center p-0.5">
                            <Button
                              type="button"
                              aria-label="Align left"
                              variant={
                                effectiveTextAlign === "left"
                                  ? "secondary"
                                  : "ghost"
                              }
                              size="icon"
                              className="size-6 shadow-none"
                              disabled={disabled || sourceStyleLocked}
                              onClick={() => {
                                if (sourceStyleLocked) return;
                                previewStyle({ "text-align": "left" });
                                if (!componentPath)
                                  handleFieldChange("textAlign", "left");
                                patchStyle(
                                  (prev) =>
                                    patchTailwindClasses(prev, {
                                      property: "text-align",
                                      value: "text-left",
                                    }),
                                  { textAlign: "left" },
                                );
                              }}
                            >
                              <AlignLeft className="size-3" />
                            </Button>
                            <Button
                              type="button"
                              aria-label="Align center"
                              variant={
                                effectiveTextAlign === "center"
                                  ? "secondary"
                                  : "ghost"
                              }
                              size="icon"
                              className="size-6 shadow-none"
                              disabled={disabled || sourceStyleLocked}
                              onClick={() => {
                                if (sourceStyleLocked) return;
                                previewStyle({ "text-align": "center" });
                                if (!componentPath)
                                  handleFieldChange("textAlign", "center");
                                patchStyle(
                                  (prev) =>
                                    patchTailwindClasses(prev, {
                                      property: "text-align",
                                      value: "text-center",
                                    }),
                                  { textAlign: "center" },
                                );
                              }}
                            >
                              <AlignCenter className="size-3" />
                            </Button>
                            <Button
                              type="button"
                              aria-label="Align right"
                              variant={
                                effectiveTextAlign === "right"
                                  ? "secondary"
                                  : "ghost"
                              }
                              size="icon"
                              className="size-6 shadow-none"
                              disabled={disabled || sourceStyleLocked}
                              onClick={() => {
                                if (sourceStyleLocked) return;
                                previewStyle({ "text-align": "right" });
                                if (!componentPath)
                                  handleFieldChange("textAlign", "right");
                                patchStyle(
                                  (prev) =>
                                    patchTailwindClasses(prev, {
                                      property: "text-align",
                                      value: "text-right",
                                    }),
                                  { textAlign: "right" },
                                );
                              }}
                            >
                              <AlignRight className="size-3" />
                            </Button>
                          </div>
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </LayoutInspectorModule>
            ) : null}

            {renderInspectorDesignModule("sizing", visibleModules, () => (
              <SizingInspectorModule
                expanded={sectionsExpanded.sizing}
                onToggle={() => toggleSection("sizing")}
                computed={containerComputedStyle}
                sourceClassName={containerClassName}
                targetVariants={targetVariants}
                optimisticWidth={optimisticValue("width")}
                optimisticHeight={optimisticValue("height")}
                optimisticMinWidth={optimisticValue("minWidth")}
                optimisticMinHeight={optimisticValue("minHeight")}
                optimisticMaxWidth={optimisticValue("maxWidth")}
                optimisticMaxHeight={optimisticValue("maxHeight")}
                disabled={disabled || sourceStyleLocked || !componentFile}
                onPreview={previewContainerStyle}
                onCommit={commitContainerProperty}
              />
            ))}

            {renderInspectorDesignModule("position", visibleModules, () => (
              <PositionInspectorModule
                expanded={sectionsExpanded.position}
                onToggle={() => toggleSection("position")}
                computed={containerComputedStyle}
                disabled={disabled || sourceStyleLocked || !componentFile}
                onPreview={previewContainerStyle}
                onCommit={commitContainerProperty}
              />
            ))}

            {renderInspectorDesignModule("appearance", visibleModules, () => (
              <AppearanceInspectorModule
                expanded={sectionsExpanded.appearance}
                onToggle={() => toggleSection("appearance")}
                computed={containerComputedStyle}
                disabled={disabled || sourceStyleLocked || !componentFile}
                onPreview={previewContainerStyle}
                onCommit={commitContainerProperty}
              />
            ))}

            {/* 3. Typography */}
            {renderInspectorDesignModule("typography", visibleModules, () => (
              <InspectorGroup
                title="Typography"
                icon={<Type className="size-3.5" />}
                expanded={sectionsExpanded.typography}
                onToggle={() => toggleSection("typography")}
              >
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <InspectorSelectControl
                      label="Font"
                      ariaLabel="Font family"
                      value={effectiveFontFamily}
                      options={["serif", "sans", "mono"]}
                      formatOption={(value) =>
                        value === "serif"
                          ? "Serif (Editorial)"
                          : value === "sans"
                            ? "Sans-serif (Modern)"
                            : "Monospace"
                      }
                      onValueChange={(val) => {
                        if (sourceStyleLocked) return;
                        previewStyle({
                          "font-family":
                            val === "sans"
                              ? "ui-sans-serif, system-ui, sans-serif"
                              : val === "mono"
                                ? "ui-monospace, monospace"
                                : "ui-serif, Georgia, serif",
                        });
                        if (!componentPath)
                          handleFieldChange("fontFamily", val);
                        patchStyle(
                          (prev) =>
                            patchTailwindClasses(prev, {
                              property: "font-family",
                              value: `font-${val}`,
                            }),
                          { fontFamily: val },
                        );
                      }}
                      disabled={disabled || sourceStyleLocked}
                    />
                    <InspectorSelectControl
                      label="Weight"
                      ariaLabel="Font weight"
                      value={effectiveFontWeight}
                      options={["300", "normal", "medium", "bold"]}
                      formatOption={(value) =>
                        value === "300"
                          ? "Light (300)"
                          : value === "normal"
                            ? "Regular (400)"
                            : value === "medium"
                              ? "Medium (500)"
                              : "Bold (700)"
                      }
                      onValueChange={(val) => {
                        if (sourceStyleLocked) return;
                        previewStyle({
                          "font-weight":
                            val === "300"
                              ? "300"
                              : val === "normal"
                                ? "400"
                                : val === "medium"
                                  ? "500"
                                  : "700",
                        });
                        if (!componentPath)
                          handleFieldChange("fontWeight", val);
                        const weightClass =
                          val === "300"
                            ? "font-light"
                            : val === "normal"
                              ? "font-normal"
                              : val === "medium"
                                ? "font-medium"
                                : "font-bold";
                        patchStyle(
                          (prev) =>
                            patchTailwindClasses(prev, {
                              property: "font-weight",
                              value: weightClass,
                            }),
                          { fontWeight: val },
                        );
                      }}
                      disabled={disabled || sourceStyleLocked}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {isComplexFontSize ? (
                      <InspectorControlRow
                        label="Size"
                        control={
                          <span
                            className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground truncate max-w-[80px]"
                            title={`Controlled in code: ${complexFontSizeRaw}`}
                          >
                            Custom
                          </span>
                        }
                      />
                    ) : (
                      <InspectorLengthControl
                        label="Size"
                        ariaLabel="Heading font size"
                        value={effectiveFontSizeLength}
                        computedValue={activeComputedStyle?.fontSize}
                        allowedUnits={
                          componentPath ? ["px", "rem", "em"] : ["px"]
                        }
                        min={
                          effectiveFontSizeLength.unit === "px" ? 1 : 0.05
                        }
                        max={
                          effectiveFontSizeLength.unit === "px" ? 240 : 15
                        }
                        step={
                          effectiveFontSizeLength.unit === "px" ? 1 : 0.05
                        }
                        disabled={disabled || sourceStyleLocked}
                        onPreview={(cssValue) =>
                          previewStyle({ "font-size": cssValue })
                        }
                        onCommit={(cssValue, numericValue) => {
                          if (sourceStyleLocked || numericValue === null) return;
                          if (!componentPath)
                            handleFieldChange("fontSize", numericValue);
                          patchStyle(
                            (prev) =>
                              patchTailwindClasses(prev, {
                                property: "font-size",
                                value: inspectorLengthUtility("text", cssValue),
                              }),
                            { fontSize: cssValue },
                          );
                        }}
                      />
                    )}
                    <InspectorControlRow
                      label="Line H"
                      control={
                        <ScrubbableNumberInput
                          value={effectiveLineHeight}
                          min={0.8}
                          max={2.5}
                          step={0.05}
                          suffix="×"
                          disabled={disabled || sourceStyleLocked}
                          ariaLabel="Line height multiplier"
                          onValuePreview={(val) =>
                            previewStyle({ "line-height": String(val) })
                          }
                          onValueChange={(val) => {
                            if (sourceStyleLocked) return;
                            if (!componentPath)
                              handleFieldChange("lineHeight", val);
                            patchStyle(
                              (prev) =>
                                patchTailwindClasses(prev, {
                                  property: "line-height",
                                  value: `leading-[${val}]`,
                                }),
                              { lineHeight: val },
                            );
                          }}
                          className="h-7 min-w-0 flex-1 justify-end"
                          inputClassName="h-7 min-w-0 px-0 text-right font-mono text-xs"
                        />
                      }
                    />
                  </div>
                </div>
              </InspectorGroup>
            ))}

            {/* 4. Fills & Background */}
            {renderInspectorDesignModule("fill", visibleModules, () => (
              <InspectorGroup
                title="Fills & Background"
                icon={<Palette className="size-3.5" />}
                expanded={sectionsExpanded.fills}
                onToggle={() => toggleSection("fills")}
              >
                <div className="space-y-3">
                  {visibleModules.has("typography") && (
                    <InspectorColorField
                      label="Text"
                      value={effectiveTextPaint}
                      disabled={disabled || sourceStyleLocked}
                      allowGradient
                      onPreview={(value) =>
                        previewStyle(
                          textPaintPreviewStyles(value, effectiveTextPaint),
                        )
                      }
                      onCommit={(value) => {
                        if (!componentPath && !isGradientPaint(value)) {
                          handleFieldChange("textColor", value);
                        }
                        patchStyle(
                          (prev) =>
                            patchTailwindTextPaint(prev, value, targetVariants),
                          { textPaint: value },
                        );
                      }}
                      onClear={() => {
                        previewStyle({
                          color: "",
                          "background-image": "",
                          "background-clip": "",
                          "-webkit-background-clip": "",
                        });
                        if (!componentPath)
                          handleFieldChange("textColor", undefined);
                        patchStyle(
                          (prev) =>
                            patchTailwindTextPaint(prev, "", targetVariants),
                          { textPaint: "" },
                        );
                      }}
                      palette={THEME_PALETTE_COLORS}
                    />
                  )}

                  <InspectorColorField
                    label="Background"
                    value={effectiveBackgroundPaint}
                    disabled={disabled || sourceStyleLocked}
                    allowGradient
                    onPreview={(value) => {
                      previewContainerStyle(paintPreviewStyles(value));
                    }}
                    onCommit={(value) => {
                      if (!componentPath && !isGradientPaint(value)) {
                        handleFieldChange("backgroundColor", value);
                      }
                      patchContainerStyle(
                        (prev) =>
                          patchTailwindClasses(prev, {
                            property: "background",
                            value: toBackgroundPaintUtility(value),
                          }),
                        { backgroundPaint: value },
                      );
                    }}
                    onClear={() => {
                      previewContainerStyle({
                        "background-color": "",
                        "background-image": "",
                      });
                      if (!componentPath) {
                        handleFieldChange("backgroundColor", undefined);
                      }
                      patchContainerStyle(
                        (prev) =>
                          patchTailwindClasses(prev, {
                            property: "background",
                            value: "",
                          }),
                        { backgroundPaint: "" },
                      );
                    }}
                    palette={THEME_PALETTE_COLORS}
                  />
                </div>
              </InspectorGroup>
            ))}

            {/* 5. Borders & Corners */}
            {renderInspectorDesignModule("border", visibleModules, () => (
              <BorderRadiusInspectorModule
                expanded={sectionsExpanded.borders}
                onToggle={() => toggleSection("borders")}
                disabled={disabled || sourceStyleLocked}
                borderWidth={effectiveBorderWidthLength}
                borderStyle={String(effectiveBorderStyle)}
                borderColor={String(effectiveBorderColor)}
                radius={effectiveBorderRadiusLengths}
                palette={THEME_PALETTE_COLORS}
                onBorderWidthPreview={(cssValue) =>
                  previewContainerStyle({ "border-width": cssValue })
                }
                onBorderWidthCommit={(cssValue, numericValue) => {
                  if (!componentPath && numericValue !== null) {
                    handleFieldChange("borderWidth", numericValue);
                  }
                  commitContainerProperty(
                    "border-width",
                    inspectorLengthUtility("border", cssValue),
                    "borderWidth",
                    cssValue,
                  );
                }}
                onBorderStyleChange={(value) => {
                  previewContainerStyle({ "border-style": value });
                  commitContainerProperty(
                    "border-style",
                    `border-${value}`,
                    "borderStyle",
                    value,
                  );
                }}
                onBorderColorPreview={(value) =>
                  previewContainerStyle({ "border-color": value })
                }
                onBorderColorCommit={(value) =>
                  commitContainerProperty(
                    "border-color",
                    toBorderColorUtility(value),
                    "borderColor",
                    value,
                  )
                }
                onBorderColorClear={() => {
                  previewContainerStyle({ "border-color": "" });
                  commitContainerProperty(
                    "border-color",
                    "",
                    "borderColor",
                    "",
                  );
                }}
                onRadiusPreview={(corner, cssValue) => {
                  if (corner === "all") {
                    previewContainerStyle({ "border-radius": cssValue });
                    return;
                  }
                  previewContainerStyle({
                    [BORDER_RADIUS_CORNER_CONFIG[corner].cssProperty]: cssValue,
                  });
                }}
                onRadiusCommit={(corner, cssValue, numericValue) => {
                  if (
                    !componentPath &&
                    corner === "all" &&
                    numericValue !== null
                  ) {
                    handleFieldChange("borderRadius", numericValue);
                  }
                  if (corner === "all") {
                    patchContainerStyle(
                      (previous) =>
                        (
                          [
                            "border-radius-top-left",
                            "border-radius-top-right",
                            "border-radius-bottom-right",
                            "border-radius-bottom-left",
                          ] as const
                        ).reduce(
                          (className, property) =>
                            patchTailwindClasses(className, {
                              property,
                              value: "",
                            }),
                          patchTailwindClasses(previous, {
                            property: "border-radius",
                            value: inspectorLengthUtility("rounded", cssValue),
                          }),
                        ),
                      {
                        borderRadius: cssValue,
                        borderRadiusTopLeft: cssValue,
                        borderRadiusTopRight: cssValue,
                        borderRadiusBottomRight: cssValue,
                        borderRadiusBottomLeft: cssValue,
                      },
                    );
                    return;
                  }
                  const config = BORDER_RADIUS_CORNER_CONFIG[corner];
                  commitContainerProperty(
                    config.property,
                    inspectorLengthUtility(config.utility, cssValue),
                    config.optimisticKey,
                    cssValue,
                  );
                }}
              />
            ))}
          </InspectorModuleStaticSections>
        </div>
      ) : null}
    </div>
  );
});

function InspectorField({
  label,
  isFocused = false,
  children,
}: {
  label: string;
  isFocused?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-lg p-1.5 transition-all duration-150",
        isFocused && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <label
        className={cn(
          "text-[11px] font-medium transition-colors block",
          isFocused ? "text-primary font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
