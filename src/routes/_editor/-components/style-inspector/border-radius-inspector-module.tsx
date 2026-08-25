import { Paintbrush } from "lucide-react";
import { useState } from "react";

import { InspectorColorField } from "./inspector-color-field";
import { InspectorDisclosureField } from "./inspector-disclosure-field";
import {
  InspectorLengthControl,
  type InspectorLengthValue,
} from "./inspector-length-control";
import { InspectorModuleCard } from "./inspector-module-card";
import { InspectorSelectControl } from "./inspector-select-control";

export type BorderRadiusCorner =
  | "all"
  | "topLeft"
  | "topRight"
  | "bottomRight"
  | "bottomLeft";

export type BorderWidthSide = "all" | "top" | "bottom" | "left" | "right";

type BorderRadiusInspectorModuleProps = {
  expanded: boolean;
  onToggle: () => void;
  disabled: boolean;
  borderWidth: Record<BorderWidthSide, InspectorLengthValue>;
  borderStyle: string;
  borderColor: string;
  radius: Record<BorderRadiusCorner, InspectorLengthValue>;
  palette: readonly {
    label: string;
    value: string;
    preview: string;
  }[];
  onBorderWidthPreview: (
    side: BorderWidthSide,
    cssValue: string,
    numericValue: number | null,
  ) => void;
  onBorderWidthCommit: (
    side: BorderWidthSide,
    cssValue: string,
    numericValue: number | null,
  ) => void;
  onBorderStyleChange: (value: string) => void;
  onBorderColorPreview: (value: string) => void;
  onBorderColorCommit: (value: string) => void;
  onBorderColorClear: () => void;
  onRadiusPreview: (
    corner: BorderRadiusCorner,
    cssValue: string,
    numericValue: number | null,
  ) => void;
  onRadiusCommit: (
    corner: BorderRadiusCorner,
    cssValue: string,
    numericValue: number | null,
  ) => void;
};

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
  const [borderWidthExpanded, setBorderWidthExpanded] = useState(false);
  const [radiusExpanded, setRadiusExpanded] = useState(false);

  return (
    <InspectorModuleCard
      title="Border & Radius"
      icon={<Paintbrush className="size-3.5" />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        <InspectorDisclosureField
          id="border-width-side-controls"
          expanded={borderWidthExpanded}
          onExpandedChange={setBorderWidthExpanded}
          expandLabel="Expand individual border sides"
          collapseLabel="Collapse individual border sides"
          field={
            <InspectorLengthControl
              label="Border"
              ariaLabel="Border width"
              value={borderWidth.all}
              allowedUnits={["px", "rem", "em"]}
              disabled={disabled}
              onPreview={(cssValue, numericValue) =>
                onBorderWidthPreview("all", cssValue, numericValue)
              }
              onCommit={(cssValue, numericValue) =>
                onBorderWidthCommit("all", cssValue, numericValue)
              }
              className="flex-1"
            />
          }
        >
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["T", "Top border width", "top"],
                ["B", "Bottom border width", "bottom"],
                ["L", "Left border width", "left"],
                ["R", "Right border width", "right"],
              ] as const
            ).map(([label, ariaLabel, side]) => (
              <InspectorLengthControl
                key={side}
                label={label}
                ariaLabel={ariaLabel}
                value={borderWidth[side]}
                allowedUnits={["px", "rem", "em"]}
                disabled={disabled}
                onPreview={(cssValue, numericValue) =>
                  onBorderWidthPreview(side, cssValue, numericValue)
                }
                onCommit={(cssValue, numericValue) =>
                  onBorderWidthCommit(side, cssValue, numericValue)
                }
              />
            ))}
          </div>
        </InspectorDisclosureField>

        <InspectorSelectControl
          label="Style"
          ariaLabel="Border style"
          value={borderStyle}
          options={["solid", "dashed", "dotted", "double", "none"]}
          disabled={disabled}
          onValueChange={onBorderStyleChange}
        />

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
            <InspectorLengthControl
              label="Radius"
              ariaLabel="Corner radius"
              value={radius.all}
              disabled={disabled}
              onPreview={(cssValue, numericValue) =>
                onRadiusPreview("all", cssValue, numericValue)
              }
              onCommit={(cssValue, numericValue) =>
                onRadiusCommit("all", cssValue, numericValue)
              }
              className="flex-1"
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
              <InspectorLengthControl
                key={corner}
                label={label}
                ariaLabel={ariaLabel}
                value={radius[corner]}
                disabled={disabled}
                onPreview={(cssValue, numericValue) =>
                  onRadiusPreview(corner, cssValue, numericValue)
                }
                onCommit={(cssValue, numericValue) =>
                  onRadiusCommit(corner, cssValue, numericValue)
                }
              />
            ))}
          </div>
        </InspectorDisclosureField>
      </div>
    </InspectorModuleCard>
  );
}
