import type { ReactNode } from "react";
import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import type { PatchTailwindOptions } from "@/lib/storefront/ast/tailwind-token-engine";
import { cn } from "@/lib/utils";
import { Box, LayoutGrid, Move, Sparkles } from "lucide-react";
import { InspectorModuleCard } from "./inspector-module-card";
import { inspectorControlSurface } from "./inspector-control-surface";
import { InspectorSelectControl } from "./inspector-select-control";
import {
  InspectorLengthControl,
  inspectorLengthUtility,
  resolveInspectorLength,
} from "./inspector-length-control";

type CommitStyle = (
  property: PatchTailwindOptions["property"],
  utility: string,
  optimisticKey: string,
  optimisticValue: string | number,
) => void;

type SharedProps = {
  expanded: boolean;
  onToggle: () => void;
  computed: Record<string, string> | null | undefined;
  disabled: boolean;
  onPreview: (styles: Record<string, string>) => void;
  onCommit: CommitStyle;
  children?: ReactNode;
};

const px = (value?: string) => {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
};

function NumberControl({
  label,
  ariaLabel,
  value,
  min = -10_000,
  max = 10_000,
  step = 1,
  suffix = "px",
  disabled,
  onPreview,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled: boolean;
  onPreview: (value: number) => void;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className={cn(
        inspectorControlSurface,
        "flex h-8 min-w-0 items-center gap-1 px-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
      )}
    >
      <span className="min-w-4 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <ScrubbableNumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        ariaLabel={ariaLabel}
        disabled={disabled}
        onValuePreview={onPreview}
        onValueChange={onChange}
        className="h-7 min-w-0 flex-1 justify-end gap-1"
        inputClassName="h-7 min-w-0 flex-1 px-0 text-right font-mono text-xs"
      />
    </div>
  );
}

export function LayoutInspectorModule(props: SharedProps) {
  const display =
    props.computed?.display === "none"
      ? "hidden"
      : props.computed?.display || "block";
  const direction = props.computed?.flexDirection || "row";
  const supportsFlow = display === "flex" || display === "inline-flex";
  const supportsGap =
    supportsFlow || display === "grid" || display === "inline-grid";
  return (
    <InspectorModuleCard
      title="Layout"
      icon={<LayoutGrid className="size-3.5" />}
      expanded={props.expanded}
      onToggle={props.onToggle}
    >
      <div className="space-y-3">
        <InspectorSelectControl
          label="Display"
          ariaLabel="Element display"
          value={display}
          options={[
            "block",
            "inline-block",
            "flex",
            "inline-flex",
            "grid",
            "inline-grid",
            "hidden",
          ]}
          disabled={props.disabled}
          onValueChange={(value) => {
            props.onPreview({ display: value === "hidden" ? "none" : value });
            props.onCommit(
              "display",
              value === "hidden" ? "hidden" : value,
              "display",
              value,
            );
          }}
        />
        {supportsFlow ? (
          <InspectorSelectControl
            label="Direction"
            ariaLabel="Element flow direction"
            value={direction}
            options={["row", "row-reverse", "column", "column-reverse"]}
            disabled={props.disabled}
            onValueChange={(value) => {
              props.onPreview({ "flex-direction": value });
              props.onCommit(
                "flex-direction",
                "flex-" + value.replace("column", "col"),
                "flexDirection",
                value,
              );
            }}
          />
        ) : null}
        {supportsGap ? (
          <NumberControl
            label="Gap"
            ariaLabel="Layout gap"
            value={px(props.computed?.gap)}
            min={0}
            max={512}
            disabled={props.disabled}
            onPreview={(value) => props.onPreview({ gap: `${value}px` })}
            onChange={(value) =>
              props.onCommit("gap", `gap-[${value}px]`, "gap", value)
            }
          />
        ) : null}
        {props.children}
      </div>
    </InspectorModuleCard>
  );
}

export function SizingInspectorModule(
  props: SharedProps & {
    sourceClassName: string;
    targetVariants: readonly string[];
    optimisticWidth?: string | number;
    optimisticHeight?: string | number;
    optimisticMinWidth?: string | number;
    optimisticMinHeight?: string | number;
    optimisticMaxWidth?: string | number;
    optimisticMaxHeight?: string | number;
  },
) {
  const width = resolveInspectorLength({
    className: props.sourceClassName,
    sources: [{ property: "width", prefix: "w" }],
    targetVariants: props.targetVariants,
    computedValue: props.computed?.width,
    optimisticValue: props.optimisticWidth,
    allowAuto: true,
    autoWhenUnset: true,
  });
  const height = resolveInspectorLength({
    className: props.sourceClassName,
    sources: [{ property: "height", prefix: "h" }],
    targetVariants: props.targetVariants,
    computedValue: props.computed?.height,
    optimisticValue: props.optimisticHeight,
    allowAuto: true,
    autoWhenUnset: true,
  });
  const minWidth = resolveInspectorLength({
    className: props.sourceClassName,
    sources: [{ property: "min-width", prefix: "min-w" }],
    targetVariants: props.targetVariants,
    computedValue: props.computed?.minWidth,
    optimisticValue: props.optimisticMinWidth,
  });
  const minHeight = resolveInspectorLength({
    className: props.sourceClassName,
    sources: [{ property: "min-height", prefix: "min-h" }],
    targetVariants: props.targetVariants,
    computedValue: props.computed?.minHeight,
    optimisticValue: props.optimisticMinHeight,
  });
  const maxWidth = resolveInspectorLength({
    className: props.sourceClassName,
    sources: [{ property: "max-width", prefix: "max-w" }],
    targetVariants: props.targetVariants,
    computedValue: props.computed?.maxWidth,
    optimisticValue: props.optimisticMaxWidth,
    allowNone: true,
    noneWhenUnset: true,
  });
  const maxHeight = resolveInspectorLength({
    className: props.sourceClassName,
    sources: [{ property: "max-height", prefix: "max-h" }],
    targetVariants: props.targetVariants,
    computedValue: props.computed?.maxHeight,
    optimisticValue: props.optimisticMaxHeight,
    allowNone: true,
    noneWhenUnset: true,
  });
  return (
    <InspectorModuleCard
      title="Sizing"
      icon={<Box className="size-3.5" />}
      expanded={props.expanded}
      onToggle={props.onToggle}
    >
      <div className="grid grid-cols-2 gap-2">
        <InspectorLengthControl
          label="W"
          ariaLabel="Element width"
          value={width}
          computedValue={props.computed?.width}
          allowAuto
          min={0}
          max={10_000}
          disabled={props.disabled}
          onPreview={(cssValue) => props.onPreview({ width: cssValue })}
          onCommit={(cssValue) =>
            props.onCommit(
              "width",
              inspectorLengthUtility("w", cssValue),
              "width",
              cssValue,
            )
          }
        />
        <InspectorLengthControl
          label="H"
          ariaLabel="Element height"
          value={height}
          computedValue={props.computed?.height}
          allowAuto
          min={0}
          max={10_000}
          disabled={props.disabled}
          onPreview={(cssValue) => props.onPreview({ height: cssValue })}
          onCommit={(cssValue) =>
            props.onCommit(
              "height",
              inspectorLengthUtility("h", cssValue),
              "height",
              cssValue,
            )
          }
        />
        <InspectorLengthControl
          label="Min W"
          ariaLabel="Element minimum width"
          value={minWidth}
          computedValue={props.computed?.minWidth}
          min={0}
          max={10_000}
          disabled={props.disabled}
          onPreview={(cssValue) => props.onPreview({ "min-width": cssValue })}
          onCommit={(cssValue) =>
            props.onCommit(
              "min-width",
              inspectorLengthUtility("min-w", cssValue),
              "minWidth",
              cssValue,
            )
          }
        />
        <InspectorLengthControl
          label="Min H"
          ariaLabel="Element minimum height"
          value={minHeight}
          computedValue={props.computed?.minHeight}
          min={0}
          max={10_000}
          disabled={props.disabled}
          onPreview={(cssValue) => props.onPreview({ "min-height": cssValue })}
          onCommit={(cssValue) =>
            props.onCommit(
              "min-height",
              inspectorLengthUtility("min-h", cssValue),
              "minHeight",
              cssValue,
            )
          }
        />
        <InspectorLengthControl
          label="Max W"
          ariaLabel="Element maximum width"
          value={maxWidth}
          computedValue={props.computed?.maxWidth}
          allowNone
          min={0}
          max={10_000}
          disabled={props.disabled}
          onPreview={(cssValue) => props.onPreview({ "max-width": cssValue })}
          onCommit={(cssValue) =>
            props.onCommit(
              "max-width",
              inspectorLengthUtility("max-w", cssValue),
              "maxWidth",
              cssValue,
            )
          }
        />
        <InspectorLengthControl
          label="Max H"
          ariaLabel="Element maximum height"
          value={maxHeight}
          computedValue={props.computed?.maxHeight}
          allowNone
          min={0}
          max={10_000}
          disabled={props.disabled}
          onPreview={(cssValue) => props.onPreview({ "max-height": cssValue })}
          onCommit={(cssValue) =>
            props.onCommit(
              "max-height",
              inspectorLengthUtility("max-h", cssValue),
              "maxHeight",
              cssValue,
            )
          }
        />
      </div>
    </InspectorModuleCard>
  );
}

export function PositionInspectorModule(props: SharedProps) {
  const position = props.computed?.position || "static";
  const positioned = position !== "static";
  return (
    <InspectorModuleCard
      title="Position"
      icon={<Move className="size-3.5" />}
      expanded={props.expanded}
      onToggle={props.onToggle}
    >
      <div className="space-y-3">
        <InspectorSelectControl
          label="Mode"
          ariaLabel="Element position mode"
          value={position}
          options={["static", "relative", "absolute", "fixed", "sticky"]}
          disabled={props.disabled}
          onValueChange={(value) => {
            props.onPreview({ position: value });
            props.onCommit("position", value, "position", value);
          }}
        />
        {positioned ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberControl
              label="X"
              ariaLabel="Element X position"
              value={px(props.computed?.left)}
              disabled={props.disabled}
              onPreview={(value) => props.onPreview({ left: `${value}px` })}
              onChange={(value) =>
                props.onCommit("left", `left-[${value}px]`, "left", value)
              }
            />
            <NumberControl
              label="Y"
              ariaLabel="Element Y position"
              value={px(props.computed?.top)}
              disabled={props.disabled}
              onPreview={(value) => props.onPreview({ top: `${value}px` })}
              onChange={(value) =>
                props.onCommit("top", `top-[${value}px]`, "top", value)
              }
            />
          </div>
        ) : null}
      </div>
    </InspectorModuleCard>
  );
}

export function AppearanceInspectorModule(props: SharedProps) {
  const opacity = Math.round(
    Number.parseFloat(props.computed?.opacity || "1") * 100,
  );
  return (
    <InspectorModuleCard
      title="Appearance"
      icon={<Sparkles className="size-3.5" />}
      expanded={props.expanded}
      onToggle={props.onToggle}
    >
      <div className="space-y-3">
        <NumberControl
          label="Opacity"
          ariaLabel="Element opacity"
          value={opacity}
          min={0}
          max={100}
          suffix="%"
          disabled={props.disabled}
          onPreview={(value) =>
            props.onPreview({ opacity: String(value / 100) })
          }
          onChange={(value) =>
            props.onCommit(
              "opacity",
              `opacity-[${value / 100}]`,
              "opacity",
              value,
            )
          }
        />
        <InspectorSelectControl
          label="Overflow"
          ariaLabel="Element overflow"
          value={props.computed?.overflow || "visible"}
          options={["visible", "hidden", "clip", "auto", "scroll"]}
          disabled={props.disabled}
          onValueChange={(value) => {
            props.onPreview({ overflow: value });
            props.onCommit("overflow", "overflow-" + value, "overflow", value);
          }}
        />
      </div>
    </InspectorModuleCard>
  );
}
