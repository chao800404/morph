import {
  DEFAULT_ELEMENT_TARGET_KEY,
  resolveElementMeta,
  resolveElementTargetKey,
} from "@/lib/storefront/ast/element-target";
import {
  buildContentFieldOrder,
  orderContentBlocks,
  resolveContentFieldOrder,
  type ContentFieldOrderNode,
} from "@/lib/storefront/editor/content-field-order";
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
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  patchThemeLinkBinding,
  resolveThemeLinkBinding,
  type ThemeLinkBinding,
} from "@/lib/storefront/ast/theme-link-binding";
import {
  isExternalThemeLink,
  normalizeThemeLinkTarget,
  normalizeThemeLinkValue,
  type ThemeLinkValue,
} from "@/lib/storefront/theme-link";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { resolveThemeContentCapabilitiesFromFiles } from "@/lib/storefront/theme-content-capability-resolver";
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
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Checkbox } from "@/components/ui/checkbox";
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
import { inspectorControlSurface } from "./style-inspector/inspector-control-surface";
import { InspectorBreakpointIndicator } from "./style-inspector/inspector-breakpoint-indicator";
import { EditorMediaField } from "./editor-media-field";
import {
  InspectorLengthControl,
  inspectorLengthUtility,
  resolveInspectorLength,
  type InspectorLengthValue,
  type NumericInspectorLengthUnit,
} from "./style-inspector/inspector-length-control";
import {
  hasInspectorDesignModule,
  renderInspectorDesignModule,
} from "./style-inspector/inspector-module-registry";
import {
  BorderRadiusInspectorModule,
  type BorderRadiusCorner,
  type BorderWidthSide,
} from "./style-inspector/border-radius-inspector-module";
import {
  AppearanceInspectorModule,
  LayoutInspectorModule,
  PositionInspectorModule,
  SizingInspectorModule,
} from "./style-inspector/box-style-modules";
import {
  arrayRowFields,
  MAX_ARRAY_CONTENT_FIELD_ROWS,
} from "@/lib/storefront/theme-content-capabilities";
import { toast } from "sonner";
import {
  addArrayRowAtFieldPath,
  createMorphItemId,
  removeArrayRowAtFieldPath,
} from "@/lib/storefront/editor/reorder-array-items";
import {
  canPatchThemeInstanceStyleClasses,
  isRepeatedFieldPath,
  readThemeElementBaseClasses,
  readThemeInstanceStyleClasses,
  type ThemeInstanceStyleTarget,
} from "@/lib/storefront/editor/theme-instance-style-source";

type EditorSection =
  StorefrontThemeEditorDTO["templates"][number]["document"]["sections"][number];

export type InspectorPropsChangeOptions = {
  skipPreviewSync?: boolean;
};

type EditorStyleInspectorProps = {
  section: EditorSection;
  themeFiles?: StorefrontThemeFileDTO[];
  selection?: EditorSelectionDescriptor | null;
  /**
   * The preview's editable nodes, in document order. Used only to order the
   * Content fields when the component declares none of its own — see
   * `resolveContentFieldOrder`.
   */
  editableNodes?: readonly ContentFieldOrderNode[];
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
  onRepairThemeLinkBinding?: (
    filePath: string,
    fieldKey: string,
  ) => Promise<boolean> | boolean;
  /** Rewrites the source between the router's `<Link>` and a plain `<a>`. */
  onSwitchThemeLinkElement?: (
    filePath: string,
    fieldKey: string,
    target: "router" | "anchor",
  ) => Promise<boolean> | boolean;
  onPropsChange: (
    next: Record<string, unknown>,
    options?: InspectorPropsChangeOptions,
  ) => void;
  onJumpToCode?: (filePath: string, line?: number, column?: number) => void;
  /**
   * Which source of truth this render edits.
   *
   * Content fields write to the Page/Template Document; every other module
   * writes Tailwind classes into the Theme Source through the AST transformer.
   * Rule §2 keeps those apart, and one scrolling panel made them look like the
   * same kind of edit. The render is split rather than the component, so the
   * selection state both views depend on stays in one place.
   */
  view?: "styles" | "content";
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

const SPACING_LENGTH_STEPS = {
  px: 4,
  "%": 1,
  rem: 0.25,
  em: 0.25,
  vw: 1,
  vh: 1,
} satisfies Record<NumericInspectorLengthUnit, number>;

const SPECIALIZED_CONTENT_FIELD_KEYS = new Set([
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
]);

const DIRECT_CONTENT_FIELD_KEYS = [
  "eyebrow",
  "label",
  "heading",
  "description",
  "body",
  "actionLabel",
  "actionHref",
  "imageSrc",
  "imageAlt",
] as const;

const IMAGE_POSITION_OPTIONS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
] as const;
type ImagePosition = (typeof IMAGE_POSITION_OPTIONS)[number];

function imagePositionFromClassName(className: string): ImagePosition | null {
  const token = className
    .split(/\s+/)
    .map((value) => value.replace(/^.*:/, ""))
    .reverse()
    .find((value) =>
      IMAGE_POSITION_OPTIONS.some((position) => value === `object-${position}`),
    );
  return token ? (token.slice("object-".length) as ImagePosition) : null;
}

function normalizeImagePosition(value: unknown): ImagePosition {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (IMAGE_POSITION_OPTIONS.includes(normalized as ImagePosition)) {
    return normalized as ImagePosition;
  }
  if (normalized.includes("top")) return "top";
  if (normalized.includes("bottom")) return "bottom";
  if (normalized.includes("left")) return "left";
  if (normalized.includes("right")) return "right";
  return "center";
}

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

function repeatedItemStructuralVariants(
  itemPath: string | null,
  props: Record<string, unknown>,
): string[] {
  if (!itemPath) return [];
  const segments = itemPath.split(".");
  const indexSegment = segments.at(-1);
  if (!indexSegment || !/^\d+$/.test(indexSegment)) return [];
  const index = Number(indexSegment);
  const collection = getFieldPathValue(props, segments.slice(0, -1).join("."));
  if (!Array.isArray(collection) || index >= collection.length) return [];

  const variants = [index % 2 === 0 ? "odd" : "even"];
  if (index === 0) variants.push("first");
  if (index === collection.length - 1) variants.push("last");
  return variants;
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
export type InternalLinkPage = { path: string; label: string };

/**
 * Pages of this store, offered as destinations for an action link.
 *
 * Read from the same source route registry the Pages panel uses, so the list
 * cannot drift from the routes the Theme actually builds. Dynamic and splat
 * routes are left out: `/products/$id` needs params this panel has no way to
 * supply, so linking to the literal path would only produce a dead link.
 */
export function resolveInternalLinkPages(
  themeFiles: readonly { path: string; content: string }[] | undefined,
): InternalLinkPage[] {
  if (!themeFiles?.length) return [];
  const { routes } = buildThemeRouteRegistry(
    themeFiles.map((file) => ({ path: file.path, content: file.content })),
  );
  const seen = new Set<string>();
  return routes
    .filter(
      (route) =>
        route.kind === "route" &&
        !route.dynamic &&
        !route.isSplat &&
        !route.isPathless &&
        typeof route.path === "string" &&
        route.path.startsWith("/"),
    )
    .filter((route) => {
      if (seen.has(route.path)) return false;
      seen.add(route.path);
      return true;
    })
    .map((route) => ({
      path: route.path,
      label: route.path === "/" ? "Home" : route.path,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Resolve the destination binding used by the legacy, flattened action props.
 *
 * Older components expose `actionHref` directly, while newer components often
 * keep the destination under an `action` object. Try the direct field first so
 * both source shapes share the same binding diagnostics.
 */
function resolveLegacyActionLinkBinding(
  sourceCode: string | null | undefined,
): ThemeLinkBinding {
  const direct = resolveThemeLinkBinding(sourceCode, "actionHref");
  if (direct !== "unknown") return direct;
  return resolveThemeLinkBinding(sourceCode, "action");
}

function canRepairLegacyActionLinkBinding(
  sourceCode: string | null | undefined,
): boolean {
  if (typeof sourceCode !== "string") return false;
  return patchThemeLinkBinding(sourceCode, "actionHref").editable;
}

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
  editableNodes,
  activeComputedStyleRevision = 0,
  activeViewport = "mobile",
  onUpdateThemeFileStyle,
  onPreviewSelectionStyle,
  onPreviewSelectionField,
  onRepairThemeLinkBinding,
  onSwitchThemeLinkElement,
  onPropsChange,
  onJumpToCode,
  view = "styles",
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
    media: true,
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
  const lastSectionIdRef = useRef(section.id);
  const optimisticStyleRef = useRef<{
    key: string;
    revision: number;
    values: Record<string, string | number>;
  }>({ key: "", revision: 0, values: {} });

  // What the server last said this section holds. Kept so a change arriving
  // from elsewhere can be told apart from this component's own edits.
  const serverBaselineRef = useRef<Record<string, any>>(
    (section.props as Record<string, any>) ?? {},
  );

  useEffect(() => {
    const incoming = (section.props as Record<string, any>) ?? {};
    const baseline = serverBaselineRef.current;
    serverBaselineRef.current = incoming;

    // Switching sections replaces everything; there is no edit in progress
    // that belongs to the new one.
    if (section.id !== lastSectionIdRef.current) {
      lastSectionIdRef.current = section.id;
      localPropsRef.current = incoming;
      setLocalProps(incoming);
      return;
    }

    // Same section, new server state — a refetch, a reorder, an undo, or a
    // template swap that reused the id. Syncing only on `section.id` left the
    // local snapshot stale, and every field edit sends the *whole* object, so
    // the next keystroke wrote the stale values back over the change. OCC
    // cannot catch that: the generation is current and the payload looks
    // deliberate.
    //
    // Fields the user has locally diverged on are kept, because discarding
    // them would delete something being typed. Everything else rebases.
    const local = localPropsRef.current;
    const rebased: Record<string, any> = { ...incoming };
    for (const key of Object.keys(local)) {
      const isLocallyEdited = !Object.is(local[key], baseline[key]);
      if (isLocallyEdited) rebased[key] = local[key];
    }

    localPropsRef.current = rebased;
    setLocalProps(rebased);
  }, [section.id, section.props]);
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
  const activeSourceLocation = selection?.sourceLocation ?? null;
  // Shared with the AST patch and the live preview so the Inspector never
  // enables a control the patch cannot apply, and never disables one it could.
  const targetElement = resolveElementTargetKey({
    nodeId: activeNodeId,
    elementKey: activeElementKey,
    sourceLocation: activeSourceLocation,
  });
  const props = localProps;
  const selectedField = activeFieldKey ?? activeElementKey;
  const isSelectedNode = activeSelectionIsSection === false;
  // Selecting a section from the sidebar intentionally clears the transient
  // canvas descriptor. Treat that null/undefined descriptor as the section
  // context, otherwise the module resolver omits Content and the panel is
  // rendered empty even though the Document section has editable fields.
  const isSectionSelection = !isSelectedNode;
  const selectedKind = selection?.kind ?? "custom";
  // Restricted to this section: a selected parent can span several components,
  // and two instances of one component expose the same field names. Editing
  // through an unfiltered list would write to whichever instance came first.
  const descendantFields = (selection?.descendantFields ?? []).filter(
    (binding) => binding.sectionId === null || binding.sectionId === section.id,
  );
  const descendantFieldKeys = new Set(
    descendantFields.map((binding) => binding.fieldKey),
  );
  const showField = (...keys: string[]) =>
    !isSelectedNode ||
    keys.includes(selectedField ?? "") ||
    keys.some((key) => descendantFieldKeys.has(key)) ||
    (activeFieldPath
      ? keys.includes(activeFieldPath.split(".").pop() ?? "")
      : false);
  const fieldValue = (key: string): unknown =>
    activeFieldPath && activeFieldPath.endsWith("." + key)
      ? getFieldPathValue(props, activeFieldPath)
      : props[key];
  const nestedFieldPath = (key: string): string | null => {
    if (!isSelectedNode) return null;
    const descendantPath = descendantFields.find(
      (binding) => binding.fieldKey === key,
    )?.fieldPath;
    if (descendantPath) return descendantPath;
    const nestedDescendantPath = descendantFields.find((binding) =>
      binding.fieldPath?.includes("."),
    )?.fieldPath;
    if (nestedDescendantPath) {
      const prefix = nestedDescendantPath.slice(
        0,
        nestedDescendantPath.lastIndexOf("."),
      );
      const siblingPath = `${prefix}.${key}`;
      if (getFieldPathValue(props, siblingPath) !== undefined) {
        return siblingPath;
      }
    }
    if (!activeFieldPath || !activeFieldPath.includes(".")) return null;
    const prefix = activeFieldPath.slice(0, activeFieldPath.lastIndexOf("."));
    return prefix + "." + key;
  };
  const selectedFieldValue = (key: string): unknown => {
    const path = nestedFieldPath(key);
    const value = path ? getFieldPathValue(props, path) : props[key];
    // Canvas inline editing updates the selected preview descriptor before the
    // debounced Document refetch reaches this panel. Prefer that value for the
    // selected text control so the Inspector converges immediately.
    if (
      isSelectedNode &&
      selectedField === key &&
      selection?.contentValue !== null &&
      selection?.contentValue !== undefined
    ) {
      return selection.contentValue;
    }
    if (value !== undefined) return value;
    return isSelectedNode && selectedField === key
      ? selection?.contentValue
      : undefined;
  };
  const contentFieldInputKey = (fieldKey: string) =>
    `${fieldKey}:${
      isSelectedNode && selectedField === fieldKey
        ? (selection?.contentValue ?? "")
        : ""
    }`;
  const optimisticValue = (key: string): number | string | undefined =>
    optimisticStyleRef.current.values[key];
  const optimisticNumber = (key: string): number | undefined => {
    const value = optimisticStyleRef.current.values[key];
    return typeof value === "number" ? value : undefined;
  };

  const componentFile = themeFiles?.find((f) => f.path === componentPath);
  const legacyActionLinkBinding = useMemo(
    () => resolveLegacyActionLinkBinding(componentFile?.content),
    [componentFile?.content],
  );
  const canRepairLegacyActionLink = useMemo(
    () => canRepairLegacyActionLinkBinding(componentFile?.content),
    [componentFile?.content],
  );
  const parsedMeta = useMemo(
    () =>
      componentFile?.content
        ? parseComponentSource(componentFile.content, componentFile.path)
        : null,
    [componentFile?.content, componentFile?.path],
  );
  const internalLinkPages = useMemo(
    () => resolveInternalLinkPages(themeFiles),
    [themeFiles],
  );

  const themeContentCapability = useMemo(() => {
    // Resolved from the workspace rather than the manifest alone so a component
    // that declares its own `contentFields` is editable without being
    // registered anywhere. Server validation resolves the same way, so the form
    // and what the server accepts cannot diverge.
    if (!themeFiles) return null;
    const { capabilities } =
      resolveThemeContentCapabilitiesFromFiles(themeFiles);
    // Falls back to the component's own source path so a component that was
    // never registered anywhere — the case co-located declaration exists to
    // support — still resolves what it declares.
    return (
      (section.componentRef ? capabilities[section.componentRef] : null) ??
      (componentPath ? capabilities[componentPath] : null) ??
      null
    );
  }, [componentPath, section.componentRef, themeFiles]);
  const declaredContentFields = Object.entries(
    themeContentCapability?.fields ?? {},
  );
  /**
   * Where each content control belongs in the panel.
   *
   * A component that declares `contentFields` has stated the order it wants, so
   * that wins; otherwise the preview's document order decides. With neither,
   * the map is empty and the panel keeps the order the JSX below is written in.
   */
  const contentFieldOrder = useMemo(
    () =>
      resolveContentFieldOrder({
        declaredKeys: Object.keys(themeContentCapability?.fields ?? {}),
        documentOrder: buildContentFieldOrder(editableNodes, section.id),
      }),
    [themeContentCapability, editableNodes, section.id],
  );
  /**
   * A control can stand for several field keys (an action is a label plus an
   * href). It sorts by whichever of them the order actually knows about.
   */
  const contentOrderKey = (...keys: string[]) =>
    keys.find((key) => contentFieldOrder.has(key)) ?? keys[0] ?? "";
  const isDeclaredContentField = (fieldKey: string) =>
    Boolean(themeContentCapability?.fields[fieldKey]);
  const declaredContentFieldLabel = (fieldKey: string, fallback: string) =>
    themeContentCapability?.fields[fieldKey]?.label ?? fallback;
  const declaredContentFieldMaxLength = (fieldKey: string) => {
    const definition = themeContentCapability?.fields[fieldKey];
    return definition &&
      (definition.type === "text" ||
        definition.type === "textarea" ||
        definition.type === "url")
      ? definition.maxLength
      : undefined;
  };
  const contentFieldDisplayValue = (fieldKey: string): unknown => {
    const value = selectedFieldValue(fieldKey);
    if (value !== undefined) return value;
    return isDeclaredContentField(fieldKey)
      ? (parsedMeta?.defaultProps[fieldKey] ?? "")
      : undefined;
  };
  const hasDirectContentField = DIRECT_CONTENT_FIELD_KEYS.some(
    (fieldKey) =>
      Object.prototype.hasOwnProperty.call(props, fieldKey) ||
      descendantFieldKeys.has(fieldKey) ||
      isDeclaredContentField(fieldKey),
  );
  const hasSelectedContentField = Boolean(
    isSelectedNode &&
    activeFieldPath &&
    selectedField &&
    !SPECIALIZED_CONTENT_FIELD_KEYS.has(selectedField),
  );
  const hasSelectedSpecializedContentField = Boolean(
    isSelectedNode &&
    selectedField &&
    DIRECT_CONTENT_FIELD_KEYS.some((fieldKey) => fieldKey === selectedField),
  );
  const hasEditableContent =
    declaredContentFields.length > 0 ||
    descendantFields.length > 0 ||
    hasDirectContentField ||
    hasSelectedContentField ||
    hasSelectedSpecializedContentField;
  const targetElementMeta =
    resolveElementMeta(parsedMeta, targetElement) ??
    (activeSelectionIsSection === false
      ? undefined
      : parsedMeta?.elements[DEFAULT_ELEMENT_TARGET_KEY]);
  const sectionElementMeta =
    parsedMeta?.elements["section"] ?? parsedMeta?.elements["root"];
  const activeRepeatedItemPath = repeatedItemRootPath(activeFieldPath);
  const activeStructuralVariants = repeatedItemStructuralVariants(
    activeRepeatedItemPath,
    props,
  );
  const activeStructuralVariantKey = activeStructuralVariants.join(":");
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
      isSection: isSectionSelection,
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
  if (descendantFields.length > 0) {
    visibleModules.add("content");
    if (
      descendantFieldKeys.has("imageSrc") ||
      descendantFieldKeys.has("imageAlt")
    ) {
      visibleModules.add("media");
    }
  }

  // Code as SSOT: derive style values from the source code AST
  const targetClassName =
    instanceStyleClassName ??
    editableBaseClassName ??
    targetElementMeta?.className ??
    "";
  const effectiveImagePosition = normalizeImagePosition(
    activeComputedStyle?.objectPosition ??
      imagePositionFromClassName(targetClassName) ??
      selectedFieldValue("imagePosition") ??
      "center",
  );
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
      allowAuto: true,
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
      allowAuto: true,
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
      allowAuto: true,
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
      allowAuto: true,
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
      allowAuto: true,
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
  const effectiveBorderWidthLengths = {
    all: resolveInspectorLength({
      className: containerClassName,
      sources: [{ property: "border-width", prefix: "border" }],
      targetVariants,
      computedValue: containerComputedStyle?.borderTopWidth,
      optimisticValue: optimisticValue("borderWidth"),
      fallbackValue: effectiveBorderWidth,
    }),
    top: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-width-top", prefix: "border-t" },
        { property: "border-width", prefix: "border" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderTopWidth,
      optimisticValue: optimisticValue("borderWidthTop"),
      fallbackValue:
        parsePx(containerComputedStyle?.borderTopWidth) ?? effectiveBorderWidth,
    }),
    bottom: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-width-bottom", prefix: "border-b" },
        { property: "border-width", prefix: "border" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderBottomWidth,
      optimisticValue: optimisticValue("borderWidthBottom"),
      fallbackValue:
        parsePx(containerComputedStyle?.borderBottomWidth) ??
        effectiveBorderWidth,
    }),
    left: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-width-left", prefix: "border-l" },
        { property: "border-width", prefix: "border" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderLeftWidth,
      optimisticValue: optimisticValue("borderWidthLeft"),
      fallbackValue:
        parsePx(containerComputedStyle?.borderLeftWidth) ??
        effectiveBorderWidth,
    }),
    right: resolveInspectorLength({
      className: containerClassName,
      sources: [
        { property: "border-width-right", prefix: "border-r" },
        { property: "border-width", prefix: "border" },
      ],
      targetVariants,
      computedValue: containerComputedStyle?.borderRightWidth,
      optimisticValue: optimisticValue("borderWidthRight"),
      fallbackValue:
        parsePx(containerComputedStyle?.borderRightWidth) ??
        effectiveBorderWidth,
    }),
  } satisfies Record<BorderWidthSide, InspectorLengthValue>;
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
        activeVariants: activeStructuralVariants,
      }),
    [activeViewport, activeStructuralVariantKey],
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
    ThemeInstanceStyleTarget | undefined => {
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
    (field: string, value: unknown, options?: InspectorPropsChangeOptions) => {
      const currentProps = localPropsRef.current;
      const descendantPath = selection?.descendantFields?.find(
        (binding) =>
          binding.fieldKey === field &&
          (binding.sectionId === null || binding.sectionId === section.id),
      )?.fieldPath;
      const targetPath = activeFieldPath?.endsWith("." + field)
        ? activeFieldPath
        : descendantPath;
      const next = targetPath
        ? setFieldPathValue(currentProps, targetPath, value)
        : { ...currentProps, [field]: value };
      localPropsRef.current = next;
      setLocalProps(next);
      if (options) {
        onPropsChange(next, options);
      } else {
        onPropsChange(next);
      }
    },
    [activeFieldPath, onPropsChange, section.id, selection?.descendantFields],
  );
  /**
   * Applies a row mutation to the whole repeated field at once.
   *
   * Rows are written as one value rather than path by path: adding or removing
   * shifts every index after it, so a per-path write would address the wrong
   * rows the moment the list changed length.
   */
  const mutateArrayRows = useCallback(
    (
      mutate: (
        props: Record<string, unknown>,
      ) => ReturnType<typeof addArrayRowAtFieldPath<Record<string, unknown>>>,
    ) => {
      const result = mutate(localPropsRef.current);
      if (!result.editable) {
        const message =
          result.reason === "max-rows"
            ? "This list is already at its maximum number of entries."
            : result.reason === "min-rows"
              ? "This list requires at least one more entry than that."
              : "That entry could not be changed.";
        toast.warning(message);
        return;
      }
      localPropsRef.current = result.value;
      setLocalProps(result.value);
      onPropsChange(result.value);
    },
    [onPropsChange],
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

  const handleTextFieldBlur = useCallback(
    (field: string, displayedValue: unknown, nextValue: string) => {
      if (nextValue === String(displayedValue ?? "")) return;
      handleFieldChange(field, nextValue);
    },
    [handleFieldChange],
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
      {view === "styles" && visibleModules.has("source-style") && (
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

      {view === "content" && !hasEditableContent ? (
        <div className="rounded-xl border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            This element has no editable content.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Text, images and links declared by the component appear here. Use
            Styles to change how this element looks.
          </p>
        </div>
      ) : null}

      {/* 1. Content & Text Fields */}
      {view === "content" &&
        hasEditableContent &&
        (visibleModules.has("content") || visibleModules.has("media")) && (
          <InspectorGroup
            title="Content & Fields"
            icon={<Sliders className="size-3.5" />}
            expanded={sectionsExpanded.content}
            onToggle={() => toggleSection("content")}
          >
            <div className="w-full min-w-0 space-y-3">
              {orderContentBlocks(
                [
                  ...declaredContentFields
                  .filter(
                    ([fieldKey]) =>
                      !SPECIALIZED_CONTENT_FIELD_KEYS.has(fieldKey) &&
                      (!isSelectedNode || selectedField === fieldKey),
                  )
                    .map(([fieldKey, definition]) => ({
                      key: fieldKey,
                      node: ((): React.ReactNode => {
                  const value = contentFieldDisplayValue(fieldKey);
                  const label =
                    definition.label ?? fieldKey.replace(/[-_]/g, " ");
                  const previewAndCommitTextValue = (nextValue: string) => {
                    onPreviewSelectionField?.(
                      fieldKey,
                      nestedFieldPath(fieldKey),
                      nextValue,
                    );
                    handleFieldChange(fieldKey, nextValue, {
                      skipPreviewSync: true,
                    });
                  };

                  if (definition.type === "image" || definition.type === "video") {
                    return (
                      <EditorMediaField
                        key={fieldKey}
                        label={label}
                        description={definition.description}
                        mediaType={definition.type}
                        value={value}
                        allowExternal={definition.allowExternal !== false}
                        allowAsset={definition.allowAsset !== false}
                        disabled={disabled}
                        isFocused={activeFieldKey === fieldKey}
                        onChange={(next) => handleFieldChange(fieldKey, next)}
                      />
                    );
                  }

                  if (definition.type === "array") {
                    const rows: Record<string, unknown>[] = Array.isArray(value)
                      ? (value as Record<string, unknown>[])
                      : [];
                    const resolvedRowFields = arrayRowFields(definition);
                    // A list whose row shape never resolved is shown as such
                    // rather than as an empty list: the difference is whether the
                    // Theme is misdeclared or simply has no entries yet.
                    if (!resolvedRowFields) {
                      return (
                        <p
                          key={fieldKey}
                          className={cn(
                            inspectorFieldHintClassName,
                            "leading-relaxed",
                          )}
                        >
                          {label} cannot be edited: its row component could not
                          be resolved.
                        </p>
                      );
                    }
                    const rowFields = Object.entries(resolvedRowFields);
                    const minRows = definition.minRows ?? 0;
                    const maxRows =
                      definition.maxRows ?? MAX_ARRAY_CONTENT_FIELD_ROWS;
                    return (
                      <div key={fieldKey} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span
                            className={cn(
                              inspectorFieldLabelClassName,
                              "text-muted-foreground capitalize",
                            )}
                          >
                            {label}
                          </span>
                          <span className={inspectorFieldHintClassName}>
                            {rows.length}
                          </span>
                        </div>
                        {rows.length === 0 ? (
                          <p
                            className={cn(
                              inspectorFieldHintClassName,
                              "leading-relaxed",
                            )}
                          >
                            No entries yet.
                          </p>
                        ) : null}
                        {rows.map((row, index) => (
                          <div
                            key={
                              typeof row?.id === "string"
                                ? row.id
                                : `${fieldKey}-${index}`
                            }
                            className={cn(
                              inspectorContentCardClassName,
                              "bg-muted/30",
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <p
                                className={cn(
                                  inspectorFieldHintClassName,
                                  "font-mono",
                                )}
                              >
                                {index + 1}
                              </p>
                              <button
                                type="button"
                                disabled={disabled || rows.length <= minRows}
                                onClick={() =>
                                  mutateArrayRows((current) =>
                                    removeArrayRowAtFieldPath(
                                      current,
                                      `${fieldKey}.${index}`,
                                      definition,
                                    ),
                                  )
                                }
                                className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40"
                              >
                                Remove
                              </button>
                            </div>
                            {rowFields.map(([rowKey, rowDefinition]) => {
                              const rowLabel =
                                rowDefinition.label ??
                                rowKey.replace(/[-_]/g, " ");
                              // Brings its own header and several controls, so it
                              // replaces the single-control row rather than
                              // sitting inside it.
                              if (rowDefinition.type === "link") {
                                return (
                                  <InspectorLinkField
                                    key={rowKey}
                                    label={rowLabel}
                                    description={rowDefinition.description}
                                    value={normalizeThemeLinkValue(
                                      row?.[rowKey],
                                    )}
                                    pages={internalLinkPages}
                                    binding={resolveThemeLinkBinding(
                                      componentFile?.content,
                                      rowKey,
                                    )}
                                    onSwitchBinding={
                                      componentPath && onSwitchThemeLinkElement
                                        ? (target) =>
                                            void onSwitchThemeLinkElement(
                                              componentPath,
                                              rowKey,
                                              target,
                                            )
                                        : undefined
                                    }
                                    disabled={disabled}
                                    onChange={(next) =>
                                      handleNestedFieldChange(
                                        `${fieldKey}.${index}.${rowKey}`,
                                        next,
                                      )
                                    }
                                  />
                                );
                              }
                              if (
                                rowDefinition.type === "image" ||
                                rowDefinition.type === "video"
                              ) {
                                return (
                                  <EditorMediaField
                                    key={rowKey}
                                    label={rowLabel}
                                    description={rowDefinition.description}
                                    mediaType={rowDefinition.type}
                                    value={row?.[rowKey]}
                                    allowExternal={rowDefinition.allowExternal !== false}
                                    allowAsset={rowDefinition.allowAsset !== false}
                                    disabled={disabled}
                                    onChange={(next) =>
                                      handleNestedFieldChange(
                                        `${fieldKey}.${index}.${rowKey}`,
                                        next,
                                      )
                                    }
                                  />
                                );
                              }
                              return (
                                <InspectorField key={rowKey} label={rowLabel}>
                                  {rowDefinition.type === "textarea" ? (
                                    <Textarea
                                      key={contentFieldInputKey(rowKey)}
                                      defaultValue={String(row?.[rowKey] ?? "")}
                                      maxLength={rowDefinition.maxLength}
                                      onInput={(event) =>
                                        handleNestedFieldChange(
                                          `${fieldKey}.${index}.${rowKey}`,
                                          event.currentTarget.value,
                                        )
                                      }
                                      disabled={disabled}
                                      className="min-h-16 text-xs"
                                    />
                                  ) : (
                                    <Input
                                      type={
                                        rowDefinition.type === "url"
                                          ? "url"
                                          : rowDefinition.type === "number"
                                            ? "number"
                                            : "text"
                                      }
                                      defaultValue={String(row?.[rowKey] ?? "")}
                                      maxLength={
                                        rowDefinition.type === "text" ||
                                        rowDefinition.type === "url"
                                          ? rowDefinition.maxLength
                                          : undefined
                                      }
                                      onInput={(event) =>
                                        handleNestedFieldChange(
                                          `${fieldKey}.${index}.${rowKey}`,
                                          rowDefinition.type === "number"
                                            ? Number(event.currentTarget.value)
                                            : event.currentTarget.value,
                                        )
                                      }
                                      disabled={disabled}
                                      className="h-8 text-xs"
                                    />
                                  )}
                                </InspectorField>
                              );
                            })}
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={disabled || rows.length >= maxRows}
                          onClick={() =>
                            mutateArrayRows((current) =>
                              addArrayRowAtFieldPath(
                                current,
                                fieldKey,
                                definition,
                                {
                                  createId: createMorphItemId,
                                },
                              ),
                            )
                          }
                          className="w-full rounded-lg border border-dashed py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          Add entry
                        </button>
                        {definition.description ? (
                          <p
                            className={cn(
                              inspectorFieldHintClassName,
                              "leading-relaxed",
                            )}
                          >
                            {definition.description}
                          </p>
                        ) : null}
                      </div>
                    );
                  }

                  if (definition.type === "boolean") {
                    return (
                      <InspectorSelectControl
                        key={fieldKey}
                        label={label}
                        ariaLabel={label}
                        value={value === true ? "true" : "false"}
                        onValueChange={(nextValue) => {
                          onPreviewSelectionField?.(
                            fieldKey,
                            nestedFieldPath(fieldKey),
                            nextValue,
                          );
                          handleFieldChange(fieldKey, nextValue === "true");
                        }}
                        options={["true", "false"]}
                        formatOption={(option) =>
                          option === "true" ? "True" : "False"
                        }
                        disabled={disabled}
                      />
                    );
                  }

                  if (definition.type === "link") {
                    return (
                      <InspectorLinkField
                        key={fieldKey}
                        label={label}
                        description={definition.description}
                        value={normalizeThemeLinkValue(value)}
                        pages={internalLinkPages}
                        binding={resolveThemeLinkBinding(
                          componentFile?.content,
                          fieldKey,
                        )}
                        disabled={disabled}
                        isFocused={activeFieldKey === fieldKey}
                        onChange={(next) => handleFieldChange(fieldKey, next)}
                        onSwitchBinding={
                          componentPath && onSwitchThemeLinkElement
                            ? (target) =>
                                void onSwitchThemeLinkElement(
                                  componentPath,
                                  fieldKey,
                                  target,
                                )
                            : undefined
                        }
                      />
                    );
                  }

                  if (definition.type === "select") {
                    return (
                      <InspectorSelectControl
                        key={fieldKey}
                        label={label}
                        ariaLabel={label}
                        value={String(value ?? definition.options[0]?.value)}
                        onValueChange={(nextValue) => {
                          onPreviewSelectionField?.(
                            fieldKey,
                            nestedFieldPath(fieldKey),
                            nextValue,
                          );
                          handleFieldChange(fieldKey, nextValue);
                        }}
                        options={definition.options.map(
                          (option) => option.value,
                        )}
                        formatOption={(value) =>
                          definition.options.find(
                            (option) => option.value === value,
                          )?.label ?? value
                        }
                        disabled={disabled}
                      />
                    );
                  }

                  return (
                    <InspectorField
                      key={fieldKey}
                      label={label}
                      isFocused={activeFieldKey === fieldKey}
                    >
                      {definition.type === "textarea" ? (
                        <Textarea
                          rows={3}
                          defaultValue={String(value ?? "")}
                          maxLength={definition.maxLength}
                          onInput={(event) => {
                            previewAndCommitTextValue(
                              event.currentTarget.value,
                            );
                          }}
                          disabled={disabled}
                          className="min-h-20 resize-none text-xs"
                        />
                      ) : definition.type === "number" ? (
                        <Input
                          type="number"
                          defaultValue={typeof value === "number" ? value : ""}
                          min={definition.min}
                          max={definition.max}
                          step={definition.step}
                          onInput={(event) => {
                            onPreviewSelectionField?.(
                              fieldKey,
                              nestedFieldPath(fieldKey),
                              event.currentTarget.value,
                            );
                          }}
                          onBlur={(event) => {
                            const rawValue = event.currentTarget.value.trim();
                            if (!rawValue) return;
                            const parsed = Number(rawValue);
                            if (Number.isFinite(parsed)) {
                              handleFieldChange(fieldKey, parsed);
                            }
                          }}
                          disabled={disabled}
                          className="h-8 text-xs"
                        />
                      ) : (
                        <Input
                          type={definition.type === "url" ? "url" : "text"}
                          defaultValue={String(value ?? "")}
                          maxLength={definition.maxLength}
                          onInput={(event) => {
                            previewAndCommitTextValue(
                              event.currentTarget.value,
                            );
                          }}
                          disabled={disabled}
                          className="h-8 text-xs"
                        />
                      )}
                      {definition.description ? (
                        <p
                          className={cn(
                            inspectorFieldHintClassName,
                            "leading-relaxed",
                          )}
                        >
                          {definition.description}
                        </p>
                      ) : null}
                    </InspectorField>
                  );
                      })(),
                    })),
              { key: contentOrderKey("eyebrow"), node: showField("eyebrow") &&
                ("eyebrow" in props ||
                  descendantFieldKeys.has("eyebrow") ||
                  isDeclaredContentField("eyebrow")) && (
                  <InspectorField
                    label={declaredContentFieldLabel(
                      "eyebrow",
                      "Eyebrow / Subtitle",
                    )}
                    isFocused={activeFieldKey === "eyebrow"}
                  >
                    <Input
                      key={contentFieldInputKey("eyebrow")}
                      defaultValue={String(
                        contentFieldDisplayValue("eyebrow") ?? "",
                      )}
                      maxLength={declaredContentFieldMaxLength("eyebrow")}
                      onInput={(e) =>
                        onPreviewSelectionField?.(
                          "eyebrow",
                          nestedFieldPath("eyebrow"),
                          e.currentTarget.value,
                        )
                      }
                      onBlur={(e) =>
                        handleTextFieldBlur(
                          "eyebrow",
                          contentFieldDisplayValue("eyebrow"),
                          e.currentTarget.value,
                        )
                      }
                      disabled={disabled}
                      placeholder="Eyebrow text..."
                      className="h-8 text-xs"
                    />
                  </InspectorField>
                ) },
              { key: contentOrderKey("label"), node: showField("label") &&
                ("label" in props ||
                  descendantFieldKeys.has("label") ||
                  isDeclaredContentField("label") ||
                  (isSelectedNode && selectedField === "label")) && (
                  <InspectorField
                    label={declaredContentFieldLabel("label", "Label")}
                    isFocused={activeFieldKey === "label"}
                  >
                    <Input
                      key={contentFieldInputKey("label")}
                      defaultValue={String(
                        contentFieldDisplayValue("label") ?? "",
                      )}
                      maxLength={declaredContentFieldMaxLength("label")}
                      onInput={(e) =>
                        onPreviewSelectionField?.(
                          "label",
                          nestedFieldPath("label"),
                          e.currentTarget.value,
                        )
                      }
                      onBlur={(e) =>
                        handleTextFieldBlur(
                          "label",
                          contentFieldDisplayValue("label"),
                          e.currentTarget.value,
                        )
                      }
                      disabled={disabled}
                      placeholder="Section label..."
                      className="h-8 text-xs"
                    />
                  </InspectorField>
                ) },
              { key: contentOrderKey("heading"), node: showField("heading") &&
                ("heading" in props ||
                  descendantFieldKeys.has("heading") ||
                  isDeclaredContentField("heading")) && (
                  <InspectorField
                    label={declaredContentFieldLabel("heading", "Heading")}
                    isFocused={activeFieldKey === "heading"}
                  >
                    <Textarea
                      key={contentFieldInputKey("heading")}
                      rows={2}
                      defaultValue={String(
                        contentFieldDisplayValue("heading") ?? "",
                      )}
                      maxLength={declaredContentFieldMaxLength("heading")}
                      onInput={(e) =>
                        onPreviewSelectionField?.(
                          "heading",
                          nestedFieldPath("heading"),
                          e.currentTarget.value,
                        )
                      }
                      onBlur={(e) =>
                        handleTextFieldBlur(
                          "heading",
                          contentFieldDisplayValue("heading"),
                          e.currentTarget.value,
                        )
                      }
                      disabled={disabled}
                      placeholder="Main headline..."
                      className="min-h-16 text-xs resize-none"
                    />
                  </InspectorField>
                ) },
              { key: contentOrderKey("description", "body"), node: showField("description", "body") &&
                ("description" in props ||
                  descendantFieldKeys.has("description") ||
                  isDeclaredContentField("description")) && (
                  <InspectorField
                    label={declaredContentFieldLabel(
                      "description",
                      "Description",
                    )}
                    isFocused={activeFieldKey === "description"}
                  >
                    <Textarea
                      key={contentFieldInputKey("description")}
                      rows={3}
                      defaultValue={String(
                        contentFieldDisplayValue("description") ?? "",
                      )}
                      maxLength={declaredContentFieldMaxLength("description")}
                      onInput={(e) =>
                        onPreviewSelectionField?.(
                          "description",
                          nestedFieldPath("description"),
                          e.currentTarget.value,
                        )
                      }
                      onBlur={(e) =>
                        handleTextFieldBlur(
                          "description",
                          contentFieldDisplayValue("description"),
                          e.currentTarget.value,
                        )
                      }
                      disabled={disabled}
                      placeholder="Body description..."
                      className="min-h-20 text-xs resize-none"
                    />
                  </InspectorField>
                ) },
              { key: contentOrderKey("body", "description"), node: showField("body", "description") &&
                ("body" in props ||
                  hasActiveRepeatedBody ||
                  descendantFieldKeys.has("body") ||
                  isDeclaredContentField("body")) && (
                  <InspectorField
                    label={declaredContentFieldLabel("body", "Body text")}
                    isFocused={activeFieldKey === "body"}
                  >
                    <Textarea
                      key={contentFieldInputKey("body")}
                      rows={3}
                      defaultValue={String(
                        hasActiveRepeatedBody
                          ? (contentFieldDisplayValue("body") ?? "")
                          : (contentFieldDisplayValue("body") ?? ""),
                      )}
                      maxLength={declaredContentFieldMaxLength("body")}
                      onInput={(e) =>
                        onPreviewSelectionField?.(
                          "body",
                          nestedFieldPath("body"),
                          e.currentTarget.value,
                        )
                      }
                      onBlur={(e) =>
                        handleTextFieldBlur(
                          "body",
                          contentFieldDisplayValue("body"),
                          e.currentTarget.value,
                        )
                      }
                      disabled={disabled}
                      placeholder="Section body text..."
                      className="min-h-20 text-xs resize-none"
                    />
                  </InspectorField>
                ) },
              { key: contentOrderKey("actionLabel", "actionHref", "action"), node: showField("actionLabel", "actionHref", "action") &&
                ("actionLabel" in props ||
                  descendantFieldKeys.has("actionLabel")) && (
                  <div
                    className={cn(
                      inspectorContentCardClassName,
                      activeFieldKey === "actionLabel" ||
                        activeFieldKey === "actionHref" ||
                        activeElementKey === "action"
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                        : "bg-muted/20",
                    )}
                  >
                    {/* Header carries the destination switch the way Media Image
                      carries its position select: the card's one mode control
                      sits beside the title, not inside the field grid. */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Link className="size-3 text-muted-foreground" />
                        <span>Action Button</span>
                      </span>
                      {legacyActionLinkBinding !== "unknown" ? (
                        <LinkDestinationKindSwitch
                          binding={legacyActionLinkBinding}
                          disabled={disabled || !componentPath}
                          onSwitch={(target) => {
                            if (!componentPath) return;
                            void onSwitchThemeLinkElement?.(
                              componentPath,
                              "actionHref",
                              target,
                            );
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <div className={inspectorFieldControlGroupClassName}>
                        <label
                          className={cn(
                            inspectorFieldLabelClassName,
                            "text-muted-foreground",
                          )}
                        >
                          Label
                        </label>
                        <Input
                          key={contentFieldInputKey("actionLabel")}
                          defaultValue={String(
                            selectedFieldValue("actionLabel") ?? "",
                          )}
                          onInput={(e) =>
                            onPreviewSelectionField?.(
                              "actionLabel",
                              nestedFieldPath("actionLabel"),
                              e.currentTarget.value,
                            )
                          }
                          onBlur={(e) =>
                            handleTextFieldBlur(
                              "actionLabel",
                              selectedFieldValue("actionLabel"),
                              e.currentTarget.value,
                            )
                          }
                          disabled={disabled}
                          placeholder="Button text"
                          className="h-7 text-xs"
                        />
                      </div>
                      {legacyActionLinkBinding === "unknown" ? (
                        <div className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-[10px] leading-relaxed text-muted-foreground">
                          <p className="font-medium text-foreground">
                            Link destination is not connected to the editable
                            field.
                          </p>
                          <p className="mt-1">
                            This component has a hardcoded or unsupported link.
                            Bind it to{" "}
                            <code className="rounded bg-muted px-1 font-mono text-[10px]">
                              to={"{"}actionHref{"}"}
                            </code>{" "}
                            (or{" "}
                            <code className="rounded bg-muted px-1 font-mono text-[10px]">
                              href={"{"}actionHref{"}"}
                            </code>{" "}
                            ) to enable the correct control here.
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {componentPath &&
                            canRepairLegacyActionLink &&
                            onRepairThemeLinkBinding ? (
                              <Button
                                type="button"
                                variant="secondary"
                                size="xs"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() =>
                                  void onRepairThemeLinkBinding(
                                    componentPath,
                                    "actionHref",
                                  )
                                }
                              >
                                <Link className="mr-1 size-3" />
                                Connect actionHref
                              </Button>
                            ) : null}
                            {componentPath && onJumpToCode ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => onJumpToCode(componentPath)}
                              >
                                <Code2 className="mr-1 size-3" />
                                Edit in Code
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : legacyActionLinkBinding === "router" ? (
                        <div className={inspectorFieldControlGroupClassName}>
                          <label
                            className={cn(
                              inspectorFieldLabelClassName,
                              "text-muted-foreground",
                            )}
                          >
                            Page
                          </label>
                          <Select
                            value={
                              internalLinkPages.some(
                                (page) =>
                                  page.path ===
                                  String(
                                    selectedFieldValue("actionHref") ?? "",
                                  ),
                              )
                                ? String(selectedFieldValue("actionHref"))
                                : ""
                            }
                            onValueChange={(value) =>
                              handleFieldChange("actionHref", value)
                            }
                            disabled={
                              disabled || internalLinkPages.length === 0
                            }
                          >
                            <InspectorSelectTrigger className="h-7 w-full">
                              <SelectValue
                                placeholder={
                                  internalLinkPages.length === 0
                                    ? "No pages yet"
                                    : "Choose a page"
                                }
                              />
                            </InspectorSelectTrigger>
                            <InspectorSelectContent>
                              {internalLinkPages.map((page) => (
                                <InspectorSelectItem
                                  key={page.path}
                                  value={page.path}
                                >
                                  {page.label}
                                </InspectorSelectItem>
                              ))}
                            </InspectorSelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className={inspectorFieldControlGroupClassName}>
                          <label
                            className={cn(
                              inspectorFieldLabelClassName,
                              "text-muted-foreground",
                            )}
                          >
                            Link path / URL
                          </label>
                          <Input
                            key={contentFieldInputKey("actionHref")}
                            defaultValue={String(
                              selectedFieldValue("actionHref") ?? "",
                            )}
                            onBlur={(e) =>
                              handleTextFieldBlur(
                                "actionHref",
                                selectedFieldValue("actionHref"),
                                e.currentTarget.value,
                              )
                            }
                            disabled={disabled}
                            placeholder="/about or https://example.com"
                            className="h-7 text-xs font-mono"
                            aria-label="Action Button path or URL"
                          />
                        </div>
                      )}
                    </div>

                    {legacyActionLinkBinding !== "unknown" ? (
                      <div>
                        <div className={inspectorFieldControlGroupClassName}>
                          <label
                            className={cn(
                              inspectorFieldLabelClassName,
                              "text-muted-foreground",
                            )}
                          >
                            Open in
                          </label>
                          <Select
                            value={normalizeThemeLinkTarget(
                              selectedFieldValue("actionTarget"),
                            )}
                            onValueChange={(value) =>
                              handleFieldChange("actionTarget", value)
                            }
                            disabled={disabled}
                          >
                            <InspectorSelectTrigger className="h-7 w-full">
                              <SelectValue placeholder="Same tab" />
                            </InspectorSelectTrigger>
                            <InspectorSelectContent>
                              <InspectorSelectItem value="_self">
                                Same tab
                              </InspectorSelectItem>
                              <InspectorSelectItem value="_blank">
                                New tab
                              </InspectorSelectItem>
                            </InspectorSelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) },
              { key: contentOrderKey("imageSrc", "imageAlt", "image"), node: showField("imageSrc", "imageAlt", "image") &&
                selectedFieldValue("imageSrc") !== undefined && (
                  <div className="space-y-2">
                    <EditorMediaField
                      key={contentFieldInputKey("imageSrc")}
                      label={declaredContentFieldLabel("imageSrc", "Media Image")}
                      mediaType="image"
                      value={selectedFieldValue("imageSrc")}
                      isFocused={
                        activeFieldKey === "imageSrc" ||
                        activeElementKey === "image"
                      }
                      allowExternal={
                        themeContentCapability?.fields.imageSrc?.type !== "image" ||
                        themeContentCapability.fields.imageSrc.allowExternal !== false
                      }
                      allowAsset={
                        themeContentCapability?.fields.imageSrc?.type !== "image" ||
                        themeContentCapability.fields.imageSrc.allowAsset !== false
                      }
                      disabled={disabled}
                      onChange={(next) => {
                        const storedValue =
                          themeContentCapability?.fields.imageSrc?.type === "image"
                            ? next
                            : next.url;
                        const path = nestedFieldPath("imageSrc");
                        if (path) {
                          handleNestedFieldChange(path, storedValue);
                        } else {
                          handleFieldChange("imageSrc", storedValue);
                        }
                      }}
                    />
                    {selectedFieldValue("imageAlt") !== undefined && (
                      <InspectorField
                        label={declaredContentFieldLabel("imageAlt", "Alt text")}
                        isFocused={activeFieldKey === "imageAlt"}
                      >
                        <Input
                          key={contentFieldInputKey("imageAlt")}
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
                              : handleFieldChange(
                                  "imageAlt",
                                  e.currentTarget.value,
                                )
                          }
                          disabled={disabled}
                          placeholder="Describe this image"
                          className="h-7 text-xs"
                        />
                      </InspectorField>
                    )}
                  </div>
                ) },
                ],
                contentFieldOrder,
              ).map(({ key, node }) =>
                node ? <Fragment key={key}>{node}</Fragment> : null,
              )}
              {isSelectedNode &&
                descendantFields.length === 0 &&
                activeFieldPath &&
                selectedField &&
                !isDeclaredContentField(selectedField) &&
                !SPECIALIZED_CONTENT_FIELD_KEYS.has(selectedField) &&
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
                      <InspectorField
                        key={key}
                        label={key.replace(/[-_]/g, " ")}
                      >
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
              {isSelectedNode &&
                descendantFields
                  .filter(
                    (binding) =>
                      !SPECIALIZED_CONTENT_FIELD_KEYS.has(binding.fieldKey),
                  )
                  .map((binding) => {
                    const value = binding.fieldPath
                      ? getFieldPathValue(props, binding.fieldPath)
                      : props[binding.fieldKey];
                    if (
                      value !== null &&
                      !["string", "number", "boolean"].includes(typeof value)
                    ) {
                      return null;
                    }
                    return (
                      <InspectorField
                        key={`${binding.fieldKey}:${binding.fieldPath ?? ""}`}
                        label={binding.fieldKey.replace(/[-_]/g, " ")}
                      >
                        <Textarea
                          key={contentFieldInputKey(binding.fieldKey)}
                          rows={2}
                          defaultValue={String(value ?? "")}
                          onInput={(event) =>
                            onPreviewSelectionField?.(
                              binding.fieldKey,
                              binding.fieldPath,
                              event.currentTarget.value,
                            )
                          }
                          onBlur={(event) =>
                            binding.fieldPath
                              ? handleNestedFieldChange(
                                  binding.fieldPath,
                                  event.currentTarget.value,
                                )
                              : handleFieldChange(
                                  binding.fieldKey,
                                  event.currentTarget.value,
                                )
                          }
                          disabled={disabled}
                          className="min-h-16 resize-none text-xs"
                        />
                      </InspectorField>
                    );
                  })}
            </div>
          </InspectorGroup>
        )}

      {view === "styles" &&
      (hasInspectorDesignModule(visibleModules) ||
        visibleModules.has("media")) ? (
        <div
          data-inspector-module="Styles"
          className="relative rounded-xl bg-background shadow-xs overflow-hidden"
        >
          <InspectorBreakpointIndicator viewport={activeViewport} />
          {visibleModules.has("media") && (
            <InspectorGroup
              title="Media"
              icon={<ImageIcon className="size-3.5" />}
              expanded={sectionsExpanded.media}
              onToggle={() => toggleSection("media")}
            >
              <div className="grid grid-cols-2 gap-2">
                <InspectorSelectControl
                  label="Position"
                  ariaLabel="Object position"
                  value={effectiveImagePosition}
                  options={[...IMAGE_POSITION_OPTIONS]}
                  formatOption={(value) =>
                    value.charAt(0).toUpperCase() + value.slice(1)
                  }
                  onValueChange={(value) => {
                    previewStyle({ "object-position": value });
                    nestedFieldPath("imagePosition")
                      ? handleNestedFieldChange(
                          nestedFieldPath("imagePosition")!,
                          value,
                        )
                      : handleFieldChange("imagePosition", value);
                    patchStyle((prev) =>
                      patchTailwindClasses(prev, {
                        property: "object-position",
                        value: "object-" + value,
                      }),
                    );
                  }}
                  disabled={disabled || sourceStyleLocked}
                />
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
                  options={["cover", "contain", "fill", "none", "scale-down"]}
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
                    targetClassName.match(/aspect-\[([^\]]+)\]/)?.[1] ?? "auto"
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
                        value === "auto" ? "auto" : value.replace("/", " / "),
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
            </InspectorGroup>
          )}
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
                            steps={SPACING_LENGTH_STEPS}
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
                            steps={SPACING_LENGTH_STEPS}
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
                            steps={SPACING_LENGTH_STEPS}
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
                            steps={SPACING_LENGTH_STEPS}
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
                            steps={SPACING_LENGTH_STEPS}
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
                            allowAuto
                            steps={SPACING_LENGTH_STEPS}
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
                                              "m",
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
                            allowAuto
                            steps={SPACING_LENGTH_STEPS}
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
                            allowAuto
                            steps={SPACING_LENGTH_STEPS}
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
                            allowAuto
                            steps={SPACING_LENGTH_STEPS}
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
                            allowAuto
                            steps={SPACING_LENGTH_STEPS}
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
                        min={effectiveFontSizeLength.unit === "px" ? 1 : 0.05}
                        max={effectiveFontSizeLength.unit === "px" ? 240 : 15}
                        step={effectiveFontSizeLength.unit === "px" ? 1 : 0.05}
                        disabled={disabled || sourceStyleLocked}
                        onPreview={(cssValue) =>
                          previewStyle({ "font-size": cssValue })
                        }
                        onCommit={(cssValue, numericValue) => {
                          if (sourceStyleLocked || numericValue === null)
                            return;
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
                borderWidth={effectiveBorderWidthLengths}
                borderStyle={String(effectiveBorderStyle)}
                borderColor={String(effectiveBorderColor)}
                radius={effectiveBorderRadiusLengths}
                palette={THEME_PALETTE_COLORS}
                onBorderWidthPreview={(side, cssValue) => {
                  if (side === "all") {
                    previewContainerStyle({
                      "border-top-width": cssValue,
                      "border-bottom-width": cssValue,
                      "border-left-width": cssValue,
                      "border-right-width": cssValue,
                    });
                    return;
                  }
                  previewContainerStyle({
                    [`border-${side}-width`]: cssValue,
                  });
                }}
                onBorderWidthCommit={(side, cssValue, numericValue) => {
                  if (side === "all") {
                    if (!componentPath && numericValue !== null) {
                      handleFieldChange("borderWidth", numericValue);
                    }
                    patchContainerStyle(
                      (prev) =>
                        patchTailwindClasses(
                          patchTailwindClasses(
                            patchTailwindClasses(
                              patchTailwindClasses(
                                patchTailwindClasses(prev, {
                                  property: "border-width",
                                  value: inspectorLengthUtility(
                                    "border",
                                    cssValue,
                                  ),
                                }),
                                { property: "border-width-top", value: "" },
                              ),
                              { property: "border-width-bottom", value: "" },
                            ),
                            { property: "border-width-left", value: "" },
                          ),
                          { property: "border-width-right", value: "" },
                        ),
                      {
                        borderWidth: cssValue,
                        borderWidthTop: cssValue,
                        borderWidthBottom: cssValue,
                        borderWidthLeft: cssValue,
                        borderWidthRight: cssValue,
                      },
                    );
                    return;
                  }

                  const sideConfig = {
                    top: {
                      property: "border-width-top",
                      prefix: "border-t",
                      optimisticKey: "borderWidthTop",
                    },
                    bottom: {
                      property: "border-width-bottom",
                      prefix: "border-b",
                      optimisticKey: "borderWidthBottom",
                    },
                    left: {
                      property: "border-width-left",
                      prefix: "border-l",
                      optimisticKey: "borderWidthLeft",
                    },
                    right: {
                      property: "border-width-right",
                      prefix: "border-r",
                      optimisticKey: "borderWidthRight",
                    },
                  } as const;
                  const config = sideConfig[side];
                  patchContainerStyle(
                    (prev) =>
                      patchTailwindClasses(prev, {
                        property: config.property,
                        value: inspectorLengthUtility(config.prefix, cssValue),
                      }),
                    { [config.optimisticKey]: cssValue },
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

/**
 * One typography token for every field label in the Content & Fields module.
 *
 * Rule 19.3: a module's field names must share a token. Hand-writing a size per
 * control is what produced neighbouring labels at different sizes, so the size
 * lives here and `InspectorField` renders from the same value.
 */
const inspectorFieldLabelClassName = "text-[11px] font-medium block";

/** The label-to-control gap shared by simple and compound content fields. */
const inspectorFieldControlGroupClassName = "space-y-1";

/** Secondary copy under a field: descriptions, hints and explanations. */
const inspectorFieldHintClassName = "text-[11px] text-muted-foreground";

/**
 * One inset for compound content fields.
 *
 * Direct fields use `InspectorField`'s 1.5 inset. Action, link and media
 * fields use this same inset so their controls do not become narrower just
 * because they are grouped in a card.
 */
const inspectorContentCardClassName =
  "w-full min-w-0 space-y-2 rounded-lg border p-1.5 transition-all";

/** One surface for a simple text/number/boolean content field. */
const inspectorContentFieldClassName =
  "w-full min-w-0 space-y-1 rounded-lg border bg-muted/20 p-1.5 shadow-xs transition-all duration-150";

/**
 * A boolean field, rendered with the shared Checkbox rather than a bare input.
 *
 * Rule 19: field controls take their visuals from the shared primitives, so
 * focus ring, disabled state and dark-mode treatment match every other control
 * instead of being re-invented per module.
 */
function InspectorToggleField({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <label
        htmlFor={id}
        className={cn(inspectorFieldHintClassName, "cursor-pointer")}
      >
        {label}
      </label>
    </div>
  );
}

/**
 * Chooses whether a link points inside the store or out of it.
 *
 * The choice is the element, not the value: `<Link>` resolves against this
 * Theme's routes and cannot leave the store, while `<a>` addresses anything.
 * Selecting a side therefore rewrites the component source, which is why this
 * is a pair of buttons rather than a field the author types into.
 */
function LinkDestinationKindSwitch({
  binding,
  disabled,
  onSwitch,
}: {
  binding: ThemeLinkBinding;
  disabled?: boolean;
  onSwitch: (target: "router" | "anchor") => void;
}) {
  const options = [
    { id: "router" as const, label: "In store" },
    { id: "anchor" as const, label: "External" },
  ];
  return (
    <div
      role="group"
      aria-label="Link destination kind"
      className={cn(
        inspectorControlSurface,
        "flex h-7 shrink-0 items-center gap-0.5 p-0.5",
      )}
    >
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="xs"
          variant="ghost"
          className={cn(
            "h-6 rounded-sm px-2 text-[10px] font-medium",
            binding === option.id
              ? "bg-background text-foreground shadow-sm hover:bg-background"
              : "text-muted-foreground",
          )}
          disabled={disabled || binding === option.id}
          onClick={() => onSwitch(option.id)}
          title={
            option.id === "router"
              ? "Render with the router's <Link> and choose a page"
              : "Render with a plain <a> and enter any address"
          }
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Editor for one `type: "link"` content field.
 *
 * The source element decides which destination control is valid: a plain
 * `<a href>` gets a free-form path/URL input, while TanStack `<Link to>` gets a
 * picker backed by this Theme's static route registry. When source analysis is
 * unavailable, retain the legacy value-driven toggle for compatibility.
 */
function InspectorLinkField({
  label,
  description,
  value,
  pages,
  binding = "unknown",
  disabled,
  isFocused,
  onChange,
  onSwitchBinding,
}: {
  label: string;
  description?: string;
  value: ThemeLinkValue;
  pages: readonly InternalLinkPage[];
  /** How the component sends this destination to the page. */
  binding?: ThemeLinkBinding;
  disabled?: boolean;
  isFocused?: boolean;
  onChange: (next: ThemeLinkValue) => void;
  /** Rewrites the element between `<Link>` and `<a>`. */
  onSwitchBinding?: (target: "router" | "anchor") => void;
}) {
  const isExternal = isExternalThemeLink(value.href);
  const inferredMode: "internal" | "external" = isExternal
    ? "external"
    : "internal";
  // `unknown` is possible while a source file is missing or has syntax the
  // lightweight AST scanner cannot parse. Keep the previous control in that
  // case instead of silently changing a user's editor workflow.
  const [fallbackMode, setFallbackMode] = useState<"internal" | "external">(
    inferredMode,
  );
  const mode =
    binding === "router"
      ? "internal"
      : binding === "anchor"
        ? "external"
        : fallbackMode;
  const showModeToggle = binding === "unknown";
  const patch = (changes: Partial<ThemeLinkValue>) =>
    onChange({ ...value, ...changes });

  return (
    <div
      className={cn(
        inspectorContentCardClassName,
        isFocused
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
          : "bg-muted/20",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Link className="size-3 text-muted-foreground" />
        <span>{label}</span>
      </div>

      {showModeToggle ? (
        <div className="flex gap-1">
          {(["internal", "external"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="xs"
              variant={mode === option ? "secondary" : "ghost"}
              className="h-6 flex-1 text-[10px]"
              disabled={disabled}
              onClick={() => setFallbackMode(option)}
            >
              {option === "internal" ? "This store" : "External URL"}
            </Button>
          ))}
        </div>
      ) : onSwitchBinding ? (
        // The element decides where the link may point, so switching sides
        // rewrites the source rather than only the stored value.
        <LinkDestinationKindSwitch
          binding={binding}
          disabled={disabled}
          onSwitch={onSwitchBinding}
        />
      ) : binding === "router" ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          This link is rendered by the router, so it can only point at a page of
          this store.
        </p>
      ) : null}

      {mode === "internal" ? (
        <Select
          value={
            pages.some((page) => page.path === value.href) ? value.href : ""
          }
          onValueChange={(next) => patch({ href: next })}
          disabled={disabled || pages.length === 0}
        >
          <InspectorSelectTrigger className="h-7 w-full">
            <SelectValue
              placeholder={
                pages.length === 0 ? "No pages yet" : "Choose a page"
              }
            />
          </InspectorSelectTrigger>
          <InspectorSelectContent>
            {pages.map((page) => (
              <InspectorSelectItem key={page.path} value={page.path}>
                {page.label}
              </InspectorSelectItem>
            ))}
          </InspectorSelectContent>
        </Select>
      ) : (
        <Input
          defaultValue={value.href}
          onBlur={(event) => patch({ href: event.currentTarget.value })}
          disabled={disabled}
          placeholder="/about or https://example.com"
          className="h-7 text-xs font-mono"
          aria-label={`${label} path or URL`}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className={inspectorFieldControlGroupClassName}>
          <label
            className={cn(
              inspectorFieldLabelClassName,
              "text-muted-foreground",
            )}
          >
            Open in
          </label>
          <Select
            value={normalizeThemeLinkTarget(value.target)}
            onValueChange={(next) =>
              patch({ target: next === "_blank" ? "_blank" : "_self" })
            }
            disabled={disabled}
          >
            <InspectorSelectTrigger className="h-7 w-full">
              <SelectValue placeholder="Same tab" />
            </InspectorSelectTrigger>
            <InspectorSelectContent>
              <InspectorSelectItem value="_self">Same tab</InspectorSelectItem>
              <InspectorSelectItem value="_blank">New tab</InspectorSelectItem>
            </InspectorSelectContent>
          </Select>
        </div>
        <div className={inspectorFieldControlGroupClassName}>
          <label
            className={cn(
              inspectorFieldLabelClassName,
              "text-muted-foreground",
            )}
          >
            Tooltip
          </label>
          <Input
            defaultValue={value.title ?? ""}
            onBlur={(event) => patch({ title: event.currentTarget.value })}
            disabled={disabled}
            placeholder="title"
            className="h-7 text-xs"
            aria-label={`${label} tooltip`}
          />
        </div>
      </div>

      <div className={inspectorFieldControlGroupClassName}>
        <label
          className={cn(inspectorFieldLabelClassName, "text-muted-foreground")}
        >
          Accessible name
        </label>
        <Input
          defaultValue={value.ariaLabel ?? ""}
          onBlur={(event) => patch({ ariaLabel: event.currentTarget.value })}
          disabled={disabled}
          placeholder="Describes the link when its text does not"
          className="h-7 text-xs"
          aria-label={`${label} accessible name`}
        />
      </div>

      {/* rel="noopener noreferrer" is added automatically for a new tab, so
          nofollow is the only part of rel an author decides. */}
      <InspectorToggleField
        label="Tell search engines not to follow (nofollow)"
        checked={value.nofollow === true}
        disabled={disabled}
        onCheckedChange={(next) => patch({ nofollow: next })}
      />

      {/* Browsers ignore download across origins, so it is only offered for a
          destination inside this store. */}
      {!isExternal ? (
        <InspectorToggleField
          label="Download instead of opening"
          checked={value.download === true}
          disabled={disabled}
          onCheckedChange={(next) => patch({ download: next })}
        />
      ) : null}

      {description ? (
        <p className={cn(inspectorFieldHintClassName, "leading-relaxed")}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

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
      data-slot="inspector-content-field"
      className={cn(
        inspectorContentFieldClassName,
        isFocused && "bg-primary/10 ring-1 ring-primary/40",
      )}
    >
      <label
        className={cn(
          inspectorFieldLabelClassName,
          "transition-colors",
          isFocused ? "text-primary font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </label>
      <div className="w-full min-w-0">{children}</div>
    </div>
  );
}
