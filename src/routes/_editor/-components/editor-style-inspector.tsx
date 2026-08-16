import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  findSourceLocation,
  getComponentFilePath,
  parseComponentSource,
  parseTailwindBackgroundColor,
  parseTailwindBorderRadius,
  parseTailwindFontFamily,
  parseTailwindFontSizeDetailed,
  parseTailwindFontWeight,
  parseTailwindLineHeight,
  parseTailwindPadding,
  parseTailwindTextAlign,
  updateTailwindClass,
} from "@/lib/storefront/ast/theme-ast-transformer";
import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ChevronUp,
  Code2,
  Image as ImageIcon,
  LayoutGrid,
  Link,
  Paintbrush,
  Palette,
  Sliders,
  Type,
  Unlink,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

type EditorSection =
  StorefrontThemeEditorDTO["templates"][number]["document"]["sections"][number];

type EditorStyleInspectorProps = {
  section: EditorSection;
  themeFiles?: StorefrontThemeFileDTO[];
  activeElementKey?: string | null;
  activeFieldKey?: string | null;
  onUpdateThemeFileStyle?: (
    filePath: string,
    elementName: string,
    updater: (prevClasses: string) => string,
  ) => void;
  onPropsChange: (next: Record<string, unknown>) => void;
  onToggleEnabled?: (enabled: boolean) => void;
  onJumpToCode?: (filePath: string, line?: number, column?: number) => void;
  disabled?: boolean;
};

const THEME_PALETTE_COLORS = [
  { label: "Stone 50", value: "#fafaf9", preview: "bg-[#fafaf9] border-stone-200" },
  { label: "Stone 100", value: "#f5f5f4", preview: "bg-[#f5f5f4] border-stone-300" },
  { label: "Cream", value: "#d8d0c3", preview: "bg-[#d8d0c3] border-stone-400" },
  { label: "Warm Tan", value: "#b7ad9d", preview: "bg-[#b7ad9d] border-stone-500" },
  { label: "Stone 800", value: "#292524", preview: "bg-[#292524] border-stone-700" },
  { label: "Stone 900", value: "#1c1917", preview: "bg-[#1c1917] border-stone-800" },
  { label: "White", value: "#ffffff", preview: "bg-white border-stone-200" },
  { label: "Black", value: "#000000", preview: "bg-black border-stone-800" },
];

export const EditorStyleInspector = memo(function EditorStyleInspector({
  section,
  themeFiles,
  activeElementKey,
  activeFieldKey,
  onUpdateThemeFileStyle,
  onPropsChange,
  onToggleEnabled,
  onJumpToCode,
  disabled = false,
}: EditorStyleInspectorProps) {
  const [paddingLinked, setPaddingLinked] = useState(true);
  const [sectionsExpanded, setSectionsExpanded] = useState({
    content: true,
    layout: true,
    typography: true,
    fills: true,
    borders: false,
    tailwind: true,
  });

  const toggleSection = (key: keyof typeof sectionsExpanded) => {
    setSectionsExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [localProps, setLocalProps] = useState<Record<string, any>>(
    () => (section.props as Record<string, any>) ?? {},
  );

  useEffect(() => {
    setLocalProps((section.props as Record<string, any>) ?? {});
  }, [section.id]);

  const componentPath = getComponentFilePath(section.type, themeFiles);
  const targetElement = activeElementKey || "heading";
  const props = localProps;

  const componentFile = themeFiles?.find((f) => f.path === componentPath);
  const parsedMeta = componentFile?.content
    ? parseComponentSource(componentFile.content)
    : null;
  const targetElementMeta = parsedMeta?.elements[targetElement];
  const sectionElementMeta =
    parsedMeta?.elements["section"] ?? parsedMeta?.elements["root"];

  const isDynamicClassName = Boolean(
    targetElementMeta?.classNameOffsets?.isExpression,
  );
  const hasSyntaxError = parsedMeta ? !parsedMeta.parseOk : false;
  const sourceStyleLocked = hasSyntaxError || isDynamicClassName;

  // Code as SSOT: derive style values from the source code AST
  const targetClassName = targetElementMeta?.className || "";
  const sectionClassName = sectionElementMeta?.className || "";

  const fontSizeDetailed = parseTailwindFontSizeDetailed(targetClassName);
  const isComplexFontSize = fontSizeDetailed.type === "complex";
  const complexFontSizeRaw =
    fontSizeDetailed.type === "complex" ? fontSizeDetailed.raw : null;
  const effectiveFontSize =
    fontSizeDetailed.type === "exact"
      ? fontSizeDetailed.value
      : (typeof props.fontSize === "number" ? props.fontSize : 48);

  const effectiveFontFamily =
    parseTailwindFontFamily(targetClassName) ?? props.fontFamily ?? "serif";

  const effectiveFontWeight =
    parseTailwindFontWeight(targetClassName) ?? props.fontWeight ?? "normal";

  const effectiveTextAlign =
    parseTailwindTextAlign(targetClassName) ?? props.textAlign ?? "left";

  const effectiveLineHeight =
    parseTailwindLineHeight(targetClassName) ??
    (typeof props.lineHeight === "number" ? props.lineHeight : 1.1);

  const effectivePadding = parseTailwindPadding(sectionClassName);
  const effectivePaddingAll =
    effectivePadding.all ?? (typeof props.padding === "number" ? props.padding : 48);
  const effectivePaddingTop =
    effectivePadding.top ?? effectivePadding.y ?? effectivePaddingAll;
  const effectivePaddingBottom =
    effectivePadding.bottom ?? effectivePadding.y ?? effectivePaddingAll;
  const effectivePaddingLeft =
    effectivePadding.left ??
    effectivePadding.x ??
    (typeof props.paddingLeft === "number" ? props.paddingLeft : 24);
  const effectivePaddingRight =
    effectivePadding.right ??
    effectivePadding.x ??
    (typeof props.paddingRight === "number" ? props.paddingRight : 24);

  const effectiveBgColor =
    parseTailwindBackgroundColor(sectionClassName) ??
    props.backgroundColor ??
    "#fafaf9";

  const effectiveBorderRadius =
    parseTailwindBorderRadius(sectionClassName) ??
    (typeof props.borderRadius === "number" ? props.borderRadius : 0);

  const effectiveRawClassName =
    targetClassName || sectionClassName || props.className || props.customClass || "";

  const patchStyle = useCallback(
    (updater: (prevClasses: string) => string) => {
      if (!componentPath || sourceStyleLocked) return;
      onUpdateThemeFileStyle?.(componentPath, targetElement, updater);
    },
    [componentPath, targetElement, onUpdateThemeFileStyle, sourceStyleLocked],
  );

  const patchContainerStyle = useCallback(
    (updater: (prevClasses: string) => string) => {
      if (!componentPath || sourceStyleLocked) return;
      const targetKey = parsedMeta?.elements["section"]
        ? "section"
        : (parsedMeta?.elements["root"] ? "root" : targetElement);
      onUpdateThemeFileStyle?.(componentPath, targetKey, updater);
    },
    [
      componentPath,
      parsedMeta,
      targetElement,
      onUpdateThemeFileStyle,
      sourceStyleLocked,
    ],
  );

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      const next = {
        ...props,
        [field]: value,
      };
      setLocalProps(next);
      onPropsChange(next);
    },
    [props, onPropsChange],
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
                {section.type.replace(/-/g, " ")}
              </h4>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                {section.id.slice(0, 16)}...
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              checked={section.enabled !== false}
              onCheckedChange={onToggleEnabled}
              disabled={disabled}
              aria-label="Toggle section visibility"
            />
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
              <span className="truncate">
                Edit in Code ({targetElement})
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-28">
                {componentPath.split("/").pop()}
              </span>
            </Button>
          ) : (
            <div className="w-full flex items-center justify-between rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
              <span>Section has no source file</span>
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">CMS-only</span>
            </div>
          )}
        </div>
      </div>

      {/* Syntax Error Alert */}
      {hasSyntaxError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5 shadow-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
          <div className="space-y-1">
            <div className="font-semibold text-xs leading-none">TSX Syntax Errors in Source</div>
            <p className="text-[11px] opacity-90 leading-relaxed">
              {componentPath?.split("/").pop()} contains syntax errors. Visual style patching is paused until syntax is resolved in Code mode.
            </p>
          </div>
        </div>
      )}

      {/* Dynamic ClassName (Code-controlled) Banner */}
      {!hasSyntaxError && isDynamicClassName && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5 shadow-xs">
          <Code2 className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <div className="font-semibold text-xs leading-none">Code-Controlled ClassName ({targetElement})</div>
            <p className="text-[11px] opacity-90 leading-relaxed">
              This element uses a dynamic expression (e.g. <code>cn(...)</code>). Direct style patching is disabled to protect component logic.
            </p>
          </div>
        </div>
      )}

      {/* 1. Content & Text Fields */}
      <InspectorGroup
        title="Content & Fields"
        icon={<Sliders className="size-3.5" />}
        expanded={sectionsExpanded.content}
        onToggle={() => toggleSection("content")}
      >
        <div className="space-y-3">
          {"eyebrow" in props && (
            <InspectorField
              label="Eyebrow / Subtitle"
              isFocused={activeFieldKey === "eyebrow"}
            >
              <Input
                value={props.eyebrow ?? ""}
                onChange={(e) => handleFieldChange("eyebrow", e.target.value)}
                disabled={disabled}
                placeholder="Eyebrow text..."
                className="h-8 text-xs"
              />
            </InspectorField>
          )}

          {"label" in props && (
            <InspectorField
              label="Label"
              isFocused={activeFieldKey === "label"}
            >
              <Input
                value={props.label ?? ""}
                onChange={(e) => handleFieldChange("label", e.target.value)}
                disabled={disabled}
                placeholder="Section label..."
                className="h-8 text-xs"
              />
            </InspectorField>
          )}

          {"heading" in props && (
            <InspectorField
              label="Heading"
              isFocused={activeFieldKey === "heading"}
            >
              <Textarea
                rows={2}
                value={props.heading ?? ""}
                onChange={(e) => handleFieldChange("heading", e.target.value)}
                disabled={disabled}
                placeholder="Main headline..."
                className="min-h-16 text-xs resize-none"
              />
            </InspectorField>
          )}

          {"description" in props && (
            <InspectorField
              label="Description"
              isFocused={activeFieldKey === "description"}
            >
              <Textarea
                rows={3}
                value={props.description ?? ""}
                onChange={(e) =>
                  handleFieldChange("description", e.target.value)
                }
                disabled={disabled}
                placeholder="Body description..."
                className="min-h-20 text-xs resize-none"
              />
            </InspectorField>
          )}

          {"body" in props && (
            <InspectorField
              label="Body text"
              isFocused={activeFieldKey === "body"}
            >
              <Textarea
                rows={3}
                value={props.body ?? ""}
                onChange={(e) => handleFieldChange("body", e.target.value)}
                disabled={disabled}
                placeholder="Section body text..."
                className="min-h-20 text-xs resize-none"
              />
            </InspectorField>
          )}

          {"actionLabel" in props && (
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
                    value={props.actionLabel ?? ""}
                    onChange={(e) =>
                      handleFieldChange("actionLabel", e.target.value)
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
                    value={props.actionHref ?? ""}
                    onChange={(e) =>
                      handleFieldChange("actionHref", e.target.value)
                    }
                    disabled={disabled}
                    placeholder="/collections/all"
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {"imageSrc" in props && (
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
                {"imagePosition" in props && (
                  <Select
                    value={props.imagePosition ?? "center"}
                    onValueChange={(val) =>
                      handleFieldChange("imagePosition", val)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-6 w-24 text-[10px]">
                      <SelectValue placeholder="Position" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="top">Top</SelectItem>
                      <SelectItem value="bottom">Bottom</SelectItem>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Input
                value={props.imageSrc ?? ""}
                onChange={(e) => handleFieldChange("imageSrc", e.target.value)}
                disabled={disabled}
                placeholder="Image URL path..."
                className="h-7 text-xs font-mono"
              />
              {"imageAlt" in props && (
                <Input
                  value={props.imageAlt ?? ""}
                  onChange={(e) =>
                    handleFieldChange("imageAlt", e.target.value)
                  }
                  disabled={disabled}
                  placeholder="Alt text description"
                  className="h-7 text-xs"
                />
              )}
            </div>
          )}
        </div>
      </InspectorGroup>

      {/* 2. Layout & Spacing (Figma style) */}
      <InspectorGroup
        title="Layout & Spacing"
        icon={<LayoutGrid className="size-3.5" />}
        expanded={sectionsExpanded.layout}
        onToggle={() => toggleSection("layout")}
      >
        <div className="space-y-3">
          {/* Padding */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Padding</span>
              <button
                type="button"
                onClick={() => setPaddingLinked(!paddingLinked)}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                title={paddingLinked ? "Unlink padding sides" : "Link padding"}
              >
                {paddingLinked ? (
                  <Link className="size-3" />
                ) : (
                  <Unlink className="size-3" />
                )}
              </button>
            </div>

            {paddingLinked ? (
              <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
                <span className="text-[11px] text-muted-foreground">All</span>
                <ScrubbableNumberInput
                  value={effectivePaddingAll}
                  min={0}
                  max={160}
                  step={4}
                  suffix="px"
                  disabled={disabled || sourceStyleLocked}
                  ariaLabel="Section padding in pixels"
                  onValueChange={(val) => {
                    if (sourceStyleLocked) return;
                    if (!componentPath) handleFieldChange("padding", val);
                    patchContainerStyle((prev) =>
                      updateTailwindClass(
                        updateTailwindClass(
                          updateTailwindClass(
                            updateTailwindClass(
                              updateTailwindClass(
                                prev,
                                /\bp-\[.*?\]|\bp-\d+\b/,
                                `p-[${val}px]`,
                              ),
                              /\bpt-\[.*?\]|\bpt-\d+\b/,
                              "",
                            ),
                            /\bpb-\[.*?\]|\bpb-\d+\b/,
                            "",
                          ),
                          /\bpl-\[.*?\]|\bpl-\d+\b/,
                          "",
                        ),
                        /\bpr-\[.*?\]|\bpr-\d+\b/,
                        "",
                      ),
                    );
                  }}
                  className="h-6 flex-1"
                  inputClassName="h-6 text-xs text-right font-mono"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">T</span>
                  <ScrubbableNumberInput
                    value={effectivePaddingTop}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    disabled={disabled || sourceStyleLocked}
                    ariaLabel="Top padding"
                    onValueChange={(val) => {
                      if (sourceStyleLocked) return;
                      if (!componentPath) handleFieldChange("paddingTop", val);
                      patchContainerStyle((prev) =>
                        updateTailwindClass(
                          prev,
                          /\bpt-\[.*?\]|\bpt-\d+\b/,
                          `pt-[${val}px]`,
                        ),
                      );
                    }}
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">B</span>
                  <ScrubbableNumberInput
                    value={effectivePaddingBottom}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    disabled={disabled || sourceStyleLocked}
                    ariaLabel="Bottom padding"
                    onValueChange={(val) => {
                      if (sourceStyleLocked) return;
                      if (!componentPath)
                        handleFieldChange("paddingBottom", val);
                      patchContainerStyle((prev) =>
                        updateTailwindClass(
                          prev,
                          /\bpb-\[.*?\]|\bpb-\d+\b/,
                          `pb-[${val}px]`,
                        ),
                      );
                    }}
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">L</span>
                  <ScrubbableNumberInput
                    value={effectivePaddingLeft}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    disabled={disabled || sourceStyleLocked}
                    ariaLabel="Left padding"
                    onValueChange={(val) => {
                      if (sourceStyleLocked) return;
                      if (!componentPath)
                        handleFieldChange("paddingLeft", val);
                      patchContainerStyle((prev) =>
                        updateTailwindClass(
                          prev,
                          /\bpl-\[.*?\]|\bpl-\d+\b/,
                          `pl-[${val}px]`,
                        ),
                      );
                    }}
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">R</span>
                  <ScrubbableNumberInput
                    value={effectivePaddingRight}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    disabled={disabled || sourceStyleLocked}
                    ariaLabel="Right padding"
                    onValueChange={(val) => {
                      if (sourceStyleLocked) return;
                      if (!componentPath)
                        handleFieldChange("paddingRight", val);
                      patchContainerStyle((prev) =>
                        updateTailwindClass(
                          prev,
                          /\bpr-\[.*?\]|\bpr-\d+\b/,
                          `pr-[${val}px]`,
                        ),
                      );
                    }}
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Alignment */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Alignment</span>
            <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
              <Button
                type="button"
                variant={effectiveTextAlign === "left" ? "secondary" : "ghost"}
                size="icon"
                className="size-6 shadow-none"
                disabled={disabled || sourceStyleLocked}
                onClick={() => {
                  if (sourceStyleLocked) return;
                  if (!componentPath) handleFieldChange("textAlign", "left");
                  patchStyle((prev) =>
                    updateTailwindClass(prev, /text-(left|center|right)/, "text-left"),
                  );
                }}
              >
                <AlignLeft className="size-3" />
              </Button>
              <Button
                type="button"
                variant={effectiveTextAlign === "center" ? "secondary" : "ghost"}
                size="icon"
                className="size-6 shadow-none"
                disabled={disabled || sourceStyleLocked}
                onClick={() => {
                  if (sourceStyleLocked) return;
                  if (!componentPath) handleFieldChange("textAlign", "center");
                  patchStyle((prev) =>
                    updateTailwindClass(prev, /text-(left|center|right)/, "text-center"),
                  );
                }}
              >
                <AlignCenter className="size-3" />
              </Button>
              <Button
                type="button"
                variant={effectiveTextAlign === "right" ? "secondary" : "ghost"}
                size="icon"
                className="size-6 shadow-none"
                disabled={disabled || sourceStyleLocked}
                onClick={() => {
                  if (sourceStyleLocked) return;
                  if (!componentPath) handleFieldChange("textAlign", "right");
                  patchStyle((prev) =>
                    updateTailwindClass(prev, /text-(left|center|right)/, "text-right"),
                  );
                }}
              >
                <AlignRight className="size-3" />
              </Button>
            </div>
          </div>
        </div>
      </InspectorGroup>

      {/* 3. Typography */}
      <InspectorGroup
        title="Typography"
        icon={<Type className="size-3.5" />}
        expanded={sectionsExpanded.typography}
        onToggle={() => toggleSection("typography")}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Font</label>
              <Select
                value={effectiveFontFamily}
                onValueChange={(val) => {
                  if (sourceStyleLocked) return;
                  if (!componentPath) handleFieldChange("fontFamily", val);
                  patchStyle((prev) =>
                    updateTailwindClass(prev, /font-(serif|sans|mono)/, `font-${val}`),
                  );
                }}
                disabled={disabled || sourceStyleLocked}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Font family" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="serif">Serif (Editorial)</SelectItem>
                  <SelectItem value="sans">Sans-serif (Modern)</SelectItem>
                  <SelectItem value="mono">Monospace</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Weight</label>
              <Select
                value={effectiveFontWeight}
                onValueChange={(val) => {
                  if (sourceStyleLocked) return;
                  if (!componentPath) handleFieldChange("fontWeight", val);
                  const weightClass =
                    val === "300"
                      ? "font-light"
                      : val === "normal"
                        ? "font-normal"
                        : val === "medium"
                          ? "font-medium"
                          : "font-bold";
                  patchStyle((prev) =>
                    updateTailwindClass(
                      prev,
                      /font-(light|normal|medium|semibold|bold)/,
                      weightClass,
                    ),
                  );
                }}
                disabled={disabled || sourceStyleLocked}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Weight" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="300">Light (300)</SelectItem>
                  <SelectItem value="normal">Regular (400)</SelectItem>
                  <SelectItem value="medium">Medium (500)</SelectItem>
                  <SelectItem value="bold">Bold (700)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between rounded-lg border bg-background px-2.5 py-1">
              <span className="text-[11px] text-muted-foreground">Size</span>
              {isComplexFontSize ? (
                <span
                  className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground truncate max-w-[80px]"
                  title={`Controlled in code: ${complexFontSizeRaw}`}
                >
                  Custom
                </span>
              ) : (
                <ScrubbableNumberInput
                  value={effectiveFontSize}
                  min={12}
                  max={120}
                  step={2}
                  suffix="px"
                  disabled={disabled || sourceStyleLocked}
                  ariaLabel="Heading font size"
                  onValueChange={(val) => {
                    if (sourceStyleLocked) return;
                    if (!componentPath) handleFieldChange("fontSize", val);
                    patchStyle((prev) =>
                      updateTailwindClass(
                        prev,
                        /text-\[.*\]|text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)/,
                        `text-[${val}px]`,
                      ),
                    );
                  }}
                  className="h-6 w-16"
                  inputClassName="h-6 text-xs text-right font-mono"
                />
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background px-2.5 py-1">
              <span className="text-[11px] text-muted-foreground">Line H</span>
              <ScrubbableNumberInput
                value={effectiveLineHeight}
                min={0.8}
                max={2.5}
                step={0.05}
                disabled={disabled || sourceStyleLocked}
                ariaLabel="Line height multiplier"
                onValueChange={(val) => {
                  if (sourceStyleLocked) return;
                  if (!componentPath) handleFieldChange("lineHeight", val);
                  patchStyle((prev) =>
                    updateTailwindClass(
                      prev,
                      /\bleading-\[.*?\]|\bleading-(none|tight|snug|normal|relaxed|loose)\b/,
                      `leading-[${val}]`,
                    ),
                  );
                }}
                className="h-6 w-16"
                inputClassName="h-6 text-xs text-right font-mono"
              />
            </div>
          </div>
        </div>
      </InspectorGroup>

      {/* 4. Fills & Background */}
      <InspectorGroup
        title="Fills & Background"
        icon={<Palette className="size-3.5" />}
        expanded={sectionsExpanded.fills}
        onToggle={() => toggleSection("fills")}
      >
        <div className="space-y-3">
          {/* Quick Palette Chips */}
          <div>
            <label className="text-[10px] text-muted-foreground">
              Theme Palette
            </label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {THEME_PALETTE_COLORS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    if (sourceStyleLocked) return;
                    if (!componentPath)
                      handleFieldChange("backgroundColor", item.value);
                    patchContainerStyle((prev) =>
                      updateTailwindClass(
                        prev,
                        /\bbg-\[.*?\]|\bbg-(white|black|stone|slate|zinc|gray)(-\d+)?\b/,
                        `bg-[${item.value}]`,
                      ),
                    );
                  }}
                  className={cn(
                    "size-6 rounded-md border shadow-xs transition-transform hover:scale-110",
                    item.preview,
                    effectiveBgColor === item.value &&
                      "ring-2 ring-primary ring-offset-1",
                  )}
                  title={item.label}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <Input
              type="text"
              value={effectiveBgColor}
              onChange={(e) => {
                if (sourceStyleLocked) return;
                const val = e.target.value;
                if (!componentPath) handleFieldChange("backgroundColor", val);
                patchContainerStyle((prev) =>
                  updateTailwindClass(
                    prev,
                    /\bbg-\[.*?\]|\bbg-(white|black|stone|slate|zinc|gray)(-\d+)?\b/,
                    `bg-[${val}]`,
                  ),
                );
              }}
              disabled={disabled || sourceStyleLocked}
              placeholder="#ffffff"
              className="h-7 text-xs font-mono"
            />
            <input
              type="color"
              value={
                effectiveBgColor.startsWith("#") ? effectiveBgColor : "#fafaf9"
              }
              onChange={(e) => {
                if (sourceStyleLocked) return;
                const val = e.target.value;
                if (!componentPath) handleFieldChange("backgroundColor", val);
                patchContainerStyle((prev) =>
                  updateTailwindClass(
                    prev,
                    /\bbg-\[.*?\]|\bbg-(white|black|stone|slate|zinc|gray)(-\d+)?\b/,
                    `bg-[${val}]`,
                  ),
                );
              }}
              disabled={disabled || sourceStyleLocked}
              className="size-7 cursor-pointer rounded border p-0.5 bg-transparent"
            />
          </div>
        </div>
      </InspectorGroup>

      {/* 5. Borders & Corners */}
      <InspectorGroup
        title="Border & Radius"
        icon={<Paintbrush className="size-3.5" />}
        expanded={sectionsExpanded.borders}
        onToggle={() => toggleSection("borders")}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border bg-background px-2.5 py-1">
            <span className="text-[11px] text-muted-foreground">Radius</span>
            <ScrubbableNumberInput
              value={effectiveBorderRadius}
              min={0}
              max={48}
              step={2}
              suffix="px"
              disabled={disabled || sourceStyleLocked}
              ariaLabel="Corner radius"
              onValueChange={(val) => {
                if (sourceStyleLocked) return;
                if (!componentPath) handleFieldChange("borderRadius", val);
                patchContainerStyle((prev) =>
                  updateTailwindClass(
                    prev,
                    /\brounded-\[.*?\]|\brounded-(none|sm|md|lg|xl|2xl|3xl|full)\b/,
                    `rounded-[${val}px]`,
                  ),
                );
              }}
              className="h-6 w-20"
              inputClassName="h-6 text-xs text-right font-mono"
            />
          </div>
        </div>
      </InspectorGroup>

      {/* 6. Tailwind CSS Classes */}
      <InspectorGroup
        title="Tailwind CSS Classes"
        icon={<Code2 className="size-3.5" />}
        expanded={sectionsExpanded.tailwind}
        onToggle={() => toggleSection("tailwind")}
      >
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Direct Tailwind utility classes applied to this section container.
          </p>
          <Textarea
            value={effectiveRawClassName}
            onChange={(e) => {
              if (sourceStyleLocked) return;
              const nextClasses = e.target.value;
              if (componentPath) {
                patchStyle(() => nextClasses);
              } else {
                handleFieldChange("className", nextClasses);
              }
            }}
            disabled={disabled || sourceStyleLocked}
            placeholder="e.g. py-24 bg-stone-900 text-white rounded-2xl shadow-xl"
            rows={3}
            className="font-mono text-xs resize-none"
          />
        </div>
      </InspectorGroup>
    </div>
  );
});

function InspectorGroup({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-background overflow-hidden shadow-xs">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-foreground hover:bg-accent/40"
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span>{title}</span>
        </div>
        {expanded ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded && <div className="border-t px-3 py-3">{children}</div>}
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
