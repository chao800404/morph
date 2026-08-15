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
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { cn } from "@/lib/utils";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ChevronUp,
  Code2,
  Image as ImageIcon,
  Layers,
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
  onPropsChange: (next: Record<string, unknown>) => void;
  onToggleEnabled?: (enabled: boolean) => void;
  onJumpToCode?: (filePath: string, line?: number, column?: number) => void;
  disabled?: boolean;
};

export function getComponentFilePath(type: string): string {
  switch (type) {
    case "hero":
      return "src/components/Hero.tsx";
    case "editorial-intro":
      return "src/components/EditorialIntro.tsx";
    case "category-showcase":
      return "src/components/CategoryShowcase.tsx";
    case "image-with-text":
      return "src/components/Hero.tsx";
    case "principles":
    case "newsletter":
      return "src/pages/index.tsx";
    default:
      return "src/pages/index.tsx";
  }
}

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

  const handleFieldChange = useCallback(
    (key: string, value: unknown) => {
      const next = {
        ...localProps,
        [key]: value,
      };
      setLocalProps(next);
      onPropsChange(next);
    },
    [localProps, onPropsChange],
  );

  const props = localProps;

  const componentPath = getComponentFilePath(section.type);

  return (
    <div className="space-y-3 p-3">
      {/* Identity Header */}
      <div className="rounded-xl border bg-background p-3 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-wider text-foreground">
                {section.type}
              </p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {section.id}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {section.enabled !== false ? "Visible" : "Hidden"}
            </span>
            <Switch
              checked={section.enabled !== false}
              onCheckedChange={(checked) => {
                onToggleEnabled?.(checked);
              }}
              disabled={disabled}
              aria-label="Toggle section visibility"
            />
          </div>
        </div>

        {/* Jump to Source Code Bridge */}
        <div className="pt-2 border-t flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 w-full gap-1.5 text-xs font-medium justify-start"
            onClick={() => {
              if (section.type === "hero") {
                onJumpToCode?.(componentPath, 19, 11);
              } else {
                onJumpToCode?.(componentPath);
              }
            }}
            title={`Open ${componentPath} in Monaco Code Editor`}
          >
            <Code2 className="size-3.5 text-primary shrink-0" />
            <span className="truncate">Edit in Code</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate max-w-28">
              {componentPath.split("/").pop()}
            </span>
          </Button>
        </div>
      </div>

      {/* 1. Content & Text Fields */}
      <InspectorGroup
        title="Content & Fields"
        icon={<Sliders className="size-3.5" />}
        expanded={sectionsExpanded.content}
        onToggle={() => toggleSection("content")}
      >
        <div className="space-y-3">
          {"eyebrow" in props && (
            <InspectorField label="Eyebrow / Subtitle">
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
            <InspectorField label="Label">
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
            <InspectorField label="Heading">
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
            <InspectorField label="Description">
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
            <InspectorField label="Body text">
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
            <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
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
            <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
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
                  value={Number(props.padding ?? 48)}
                  min={0}
                  max={160}
                  step={4}
                  suffix="px"
                  ariaLabel="Section padding in pixels"
                  onValueChange={(val) => handleFieldChange("padding", val)}
                  className="h-6 flex-1"
                  inputClassName="h-6 text-xs text-right font-mono"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">T</span>
                  <ScrubbableNumberInput
                    value={Number(props.paddingTop ?? props.padding ?? 48)}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    ariaLabel="Top padding"
                    onValueChange={(val) => handleFieldChange("paddingTop", val)}
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">B</span>
                  <ScrubbableNumberInput
                    value={Number(props.paddingBottom ?? props.padding ?? 48)}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    ariaLabel="Bottom padding"
                    onValueChange={(val) =>
                      handleFieldChange("paddingBottom", val)
                    }
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">L</span>
                  <ScrubbableNumberInput
                    value={Number(props.paddingLeft ?? props.padding ?? 24)}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    ariaLabel="Left padding"
                    onValueChange={(val) =>
                      handleFieldChange("paddingLeft", val)
                    }
                    className="h-5 flex-1"
                    inputClassName="h-5 text-xs text-right font-mono"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">R</span>
                  <ScrubbableNumberInput
                    value={Number(props.paddingRight ?? props.padding ?? 24)}
                    min={0}
                    max={160}
                    step={4}
                    suffix="px"
                    ariaLabel="Right padding"
                    onValueChange={(val) =>
                      handleFieldChange("paddingRight", val)
                    }
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
                variant={props.textAlign === "left" || !props.textAlign ? "secondary" : "ghost"}
                size="icon"
                className="size-6 shadow-none"
                onClick={() => handleFieldChange("textAlign", "left")}
              >
                <AlignLeft className="size-3" />
              </Button>
              <Button
                type="button"
                variant={props.textAlign === "center" ? "secondary" : "ghost"}
                size="icon"
                className="size-6 shadow-none"
                onClick={() => handleFieldChange("textAlign", "center")}
              >
                <AlignCenter className="size-3" />
              </Button>
              <Button
                type="button"
                variant={props.textAlign === "right" ? "secondary" : "ghost"}
                size="icon"
                className="size-6 shadow-none"
                onClick={() => handleFieldChange("textAlign", "right")}
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
                value={props.fontFamily ?? "serif"}
                onValueChange={(val) => handleFieldChange("fontFamily", val)}
                disabled={disabled}
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
                value={props.fontWeight ?? "normal"}
                onValueChange={(val) => handleFieldChange("fontWeight", val)}
                disabled={disabled}
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
              <ScrubbableNumberInput
                value={Number(props.fontSize ?? 48)}
                min={12}
                max={120}
                step={2}
                suffix="px"
                ariaLabel="Heading font size"
                onValueChange={(val) => handleFieldChange("fontSize", val)}
                className="h-6 w-16"
                inputClassName="h-6 text-xs text-right font-mono"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-background px-2.5 py-1">
              <span className="text-[11px] text-muted-foreground">Line H</span>
              <ScrubbableNumberInput
                value={Number(props.lineHeight ?? 1.1)}
                min={0.8}
                max={2.5}
                step={0.05}
                ariaLabel="Line height multiplier"
                onValueChange={(val) => handleFieldChange("lineHeight", val)}
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
                  onClick={() => handleFieldChange("backgroundColor", item.value)}
                  className={cn(
                    "size-6 rounded-md border shadow-xs transition-transform hover:scale-110",
                    item.preview,
                    props.backgroundColor === item.value &&
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
              value={props.backgroundColor ?? "#fafaf9"}
              onChange={(e) =>
                handleFieldChange("backgroundColor", e.target.value)
              }
              disabled={disabled}
              placeholder="#ffffff"
              className="h-7 text-xs font-mono"
            />
            <input
              type="color"
              value={props.backgroundColor?.startsWith("#") ? props.backgroundColor : "#fafaf9"}
              onChange={(e) =>
                handleFieldChange("backgroundColor", e.target.value)
              }
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
              value={Number(props.borderRadius ?? 0)}
              min={0}
              max={48}
              step={2}
              suffix="px"
              ariaLabel="Corner radius"
              onValueChange={(val) => handleFieldChange("borderRadius", val)}
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
            value={props.className ?? props.customClass ?? ""}
            onChange={(e) => handleFieldChange("className", e.target.value)}
            placeholder="e.g. py-24 bg-stone-900 text-white rounded-2xl shadow-xl"
            rows={2}
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
