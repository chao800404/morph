import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import { Paintbrush } from "lucide-react";
import { useState } from "react";

import { InspectorColorField } from "./inspector-color-field";
import { InspectorDisclosureField } from "./inspector-disclosure-field";
import { InspectorModuleCard } from "./inspector-module-card";
import { InspectorSelectControl } from "./inspector-select-control";

export type BorderRadiusCorner =
  | "all"
  | "topLeft"
  | "topRight"
  | "bottomRight"
  | "bottomLeft";

type BorderRadiusInspectorModuleProps = {
  expanded: boolean;
  onToggle: () => void;
  disabled: boolean;
  borderWidth: number;
  borderStyle: string;
  borderColor: string;
  radius: Record<BorderRadiusCorner, number>;
  palette: readonly {
    label: string;
    value: string;
    preview: string;
  }[];
  onBorderWidthPreview: (value: number) => void;
  onBorderWidthCommit: (value: number) => void;
  onBorderStyleChange: (value: string) => void;
  onBorderColorPreview: (value: string) => void;
  onBorderColorCommit: (value: string) => void;
  onBorderColorClear: () => void;
  onRadiusPreview: (corner: BorderRadiusCorner, value: number) => void;
  onRadiusCommit: (corner: BorderRadiusCorner, value: number) => void;
};

function NumberField({
  label,
  ariaLabel,
  value,
  disabled,
  onPreview,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  disabled: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <ScrubbableNumberInput
        value={value}
        min={0}
        max={999}
        step={1}
        suffix="px"
        disabled={disabled}
        ariaLabel={ariaLabel}
        onValuePreview={onPreview}
        onValueChange={onCommit}
        className="h-7 min-w-0 flex-1 justify-end gap-1"
        inputClassName="h-6 min-w-0 text-right font-mono text-xs"
      />
    </div>
  );
}

export function BorderRadiusInspectorModule({
  expanded,
  onToggle,
  disabled,
  borderWidth,
  borderStyle,
  borderColor,
  radius,
  palette,
  onBorderWidthPreview,
  onBorderWidthCommit,
  onBorderStyleChange,
  onBorderColorPreview,
  onBorderColorCommit,
  onBorderColorClear,
  onRadiusPreview,
  onRadiusCommit,
}: BorderRadiusInspectorModuleProps) {
  const [radiusExpanded, setRadiusExpanded] = useState(false);

  return (
    <InspectorModuleCard
      title="Border & Radius"
      icon={<Paintbrush className="size-3.5" />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Border"
            ariaLabel="Border width"
            value={borderWidth}
            disabled={disabled}
            onPreview={onBorderWidthPreview}
            onCommit={onBorderWidthCommit}
          />
          <InspectorSelectControl
            label="Style"
            ariaLabel="Border style"
            value={borderStyle}
            options={["solid", "dashed", "dotted", "double", "none"]}
            disabled={disabled}
            onValueChange={onBorderStyleChange}
          />
        </div>

        <InspectorColorField
          label="Color"
          value={borderColor}
          disabled={disabled}
          onPreview={onBorderColorPreview}
          onCommit={onBorderColorCommit}
          onClear={onBorderColorClear}
          palette={palette}
        />

        <InspectorDisclosureField
          id="border-radius-corner-controls"
          expanded={radiusExpanded}
          onExpandedChange={setRadiusExpanded}
          expandLabel="Expand individual corner radii"
          collapseLabel="Collapse individual corner radii"
          field={
            <NumberField
              label="Radius"
              ariaLabel="Corner radius"
              value={radius.all}
              disabled={disabled}
              onPreview={(value) => onRadiusPreview("all", value)}
              onCommit={(value) => onRadiusCommit("all", value)}
            />
          }
        >
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["TL", "Top left corner radius", "topLeft"],
                ["TR", "Top right corner radius", "topRight"],
                ["BL", "Bottom left corner radius", "bottomLeft"],
                ["BR", "Bottom right corner radius", "bottomRight"],
              ] as const
            ).map(([label, ariaLabel, corner]) => (
              <NumberField
                key={corner}
                label={label}
                ariaLabel={ariaLabel}
                value={radius[corner]}
                disabled={disabled}
                onPreview={(value) => onRadiusPreview(corner, value)}
                onCommit={(value) => onRadiusCommit(corner, value)}
              />
            ))}
          </div>
        </InspectorDisclosureField>
      </div>
    </InspectorModuleCard>
  );
}
