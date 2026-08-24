import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import { Select, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import {
  tokenizeTailwindClasses,
  type TailwindPropertyFamily,
} from "@/lib/storefront/ast/tailwind-token-engine";
import {
  InspectorSelectContent,
  InspectorSelectItem,
  InspectorSelectTrigger,
} from "./inspector-select-control";
import { inspectorControlSegmentSurface } from "./inspector-control-surface";
import { InspectorControlRow } from "./inspector-control-row";

export type InspectorLengthUnit =
  | "auto"
  | "none"
  | "px"
  | "%"
  | "rem"
  | "em"
  | "vw"
  | "vh";
export type NumericInspectorLengthUnit = Exclude<
  InspectorLengthUnit,
  "auto" | "none"
>;

export type InspectorLengthValue =
  | { unit: "auto"; value: null }
  | { unit: "none"; value: null }
  | { unit: NumericInspectorLengthUnit; value: number };

export type InspectorLengthSource = {
  property: TailwindPropertyFamily;
  prefix: string;
};

const NUMERIC_UNITS: readonly NumericInspectorLengthUnit[] = [
  "px",
  "%",
  "rem",
  "em",
  "vw",
  "vh",
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseNumericLength(value: string): InspectorLengthValue | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*(px|%|rem|em|vw|vh)$/i);
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  return {
    unit: match[2].toLowerCase() as NumericInspectorLengthUnit,
    value: round(number),
  };
}

function parseUtilityLength(
  utility: string,
  prefix: string,
  computedValue?: string,
  allowAuto = false,
  allowNone = false,
): InspectorLengthValue | null {
  if (allowAuto && utility === `${prefix}-auto`) {
    return { unit: "auto", value: null };
  }
  if (allowNone && utility === `${prefix}-none`) {
    return { unit: "none", value: null };
  }
  if (utility === `${prefix}-full`) return { unit: "%", value: 100 };
  if (utility === `${prefix}-screen`) {
    return { unit: prefix === "h" ? "vh" : "vw", value: 100 };
  }
  const negative = utility.startsWith("-");
  const normalizedUtility = negative ? utility.slice(1) : utility;
  const arbitraryPrefix = prefix + "-[";
  if (
    normalizedUtility.startsWith(arbitraryPrefix) &&
    normalizedUtility.endsWith("]")
  ) {
    const parsed = parseNumericLength(
      normalizedUtility.slice(arbitraryPrefix.length, -1).replaceAll("_", " "),
    );
    if (!parsed || parsed.value === null) return parsed;
    return negative ? { ...parsed, value: -parsed.value } : parsed;
  }
  const computed = Number.parseFloat(computedValue ?? "");
  return Number.isFinite(computed)
    ? { unit: "px", value: negative ? -round(computed) : round(computed) }
    : null;
}

function variantsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function resolveInspectorLength({
  className,
  sources,
  targetVariants,
  computedValue,
  optimisticValue,
  fallbackValue = 0,
  fallbackUnit = "px",
  allowAuto = false,
  allowNone = false,
  autoWhenUnset = false,
  noneWhenUnset = false,
}: {
  className?: string;
  sources: readonly InspectorLengthSource[];
  targetVariants: readonly string[];
  computedValue?: string;
  optimisticValue?: string | number;
  fallbackValue?: number;
  fallbackUnit?: NumericInspectorLengthUnit;
  allowAuto?: boolean;
  allowNone?: boolean;
  autoWhenUnset?: boolean;
  noneWhenUnset?: boolean;
}): InspectorLengthValue {
  if (typeof optimisticValue === "string") {
    if (allowAuto && optimisticValue === "auto") {
      return { unit: "auto", value: null };
    }
    if (allowNone && optimisticValue === "none") {
      return { unit: "none", value: null };
    }
    const parsed = parseNumericLength(optimisticValue);
    if (parsed) return parsed;
  } else if (typeof optimisticValue === "number") {
    return { unit: fallbackUnit, value: round(optimisticValue) };
  }

  const tokens = tokenizeTailwindClasses(className);
  for (const variants of [targetVariants, []] as const) {
    if (
      variants.length === 0 &&
      targetVariants.length === 0 &&
      variants !== targetVariants
    ) {
      continue;
    }
    for (const source of sources) {
      const token = tokens.find(
        (candidate) =>
          candidate.propertyFamily === source.property &&
          variantsEqual(candidate.variants, variants),
      );
      if (!token) continue;
      const parsed = parseUtilityLength(
        token.utility,
        source.prefix,
        computedValue,
        allowAuto,
        allowNone,
      );
      if (parsed) return parsed;
    }
  }

  if (allowAuto && autoWhenUnset) return { unit: "auto", value: null };
  if (allowNone && noneWhenUnset) return { unit: "none", value: null };
  return { unit: fallbackUnit, value: round(fallbackValue) };
}

export function inspectorLengthCss(
  value: number,
  unit: NumericInspectorLengthUnit,
): string {
  return `${round(value)}${unit}`;
}

export function inspectorLengthUtility(
  prefix: string,
  cssValue: string,
): string {
  return cssValue === "auto" || cssValue === "none"
    ? `${prefix}-${cssValue}`
    : `${prefix}-[${cssValue}]`;
}

function valueForUnit(
  current: InspectorLengthValue,
  nextUnit: NumericInspectorLengthUnit,
  computedValue?: string,
): number {
  if (current.value !== null) return current.value;
  const computed = Number.parseFloat(computedValue ?? "");
  if (nextUnit === "px" && Number.isFinite(computed)) return round(computed);
  return nextUnit === "%" || nextUnit === "vw" || nextUnit === "vh" ? 100 : 1;
}

export function InspectorLengthControl({
  label,
  ariaLabel,
  value,
  computedValue,
  allowAuto = false,
  allowNone = false,
  allowedUnits = NUMERIC_UNITS,
  min = 0,
  max = 10_000,
  step = 1,
  steps,
  disabled,
  onPreview,
  onCommit,
  trailingAction,
  className = "",
}: {
  label: string;
  ariaLabel: string;
  value: InspectorLengthValue;
  computedValue?: string;
  allowAuto?: boolean;
  allowNone?: boolean;
  allowedUnits?: readonly NumericInspectorLengthUnit[];
  min?: number;
  max?: number;
  step?: number;
  steps?: Partial<Record<NumericInspectorLengthUnit, number>>;
  disabled: boolean;
  onPreview: (cssValue: string, numericValue: number | null) => void;
  onCommit: (cssValue: string, numericValue: number | null) => void;
  trailingAction?: ReactNode;
  className?: string;
}) {
  const keywordUnits: InspectorLengthUnit[] = [];
  if (allowAuto) keywordUnits.push("auto");
  if (allowNone) keywordUnits.push("none");
  const units: readonly InspectorLengthUnit[] = [
    ...keywordUnits,
    ...allowedUnits,
  ];

  return (
    <InspectorControlRow
      className={className}
      label={label}
      control={
        value.value === null ? (
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground mr-2">
            {value.unit === "auto" ? "Auto" : "None"}
          </span>
        ) : (
          <ScrubbableNumberInput
            value={value.value}
            min={min}
            max={max}
            step={steps?.[value.unit] ?? step}
            ariaLabel={ariaLabel}
            disabled={disabled}
            onValuePreview={(next) =>
              onPreview(inspectorLengthCss(next, value.unit), next)
            }
            onValueChange={(next) =>
              onCommit(inspectorLengthCss(next, value.unit), next)
            }
            className="h-7 min-w-0 flex-1 justify-end"
            inputClassName="h-7 min-w-0 flex-1 px-0 text-right font-mono text-xs mr-2"
          />
        )
      }
      unit={
        <Select
          value={value.unit}
          disabled={disabled}
          onValueChange={(nextValue) => {
            const nextUnit = nextValue as InspectorLengthUnit;
            if (nextUnit === "auto" || nextUnit === "none") {
              onPreview(nextUnit, null);
              onCommit(nextUnit, null);
              return;
            }
            const next = valueForUnit(value, nextUnit, computedValue);
            const cssValue = inspectorLengthCss(next, nextUnit);
            onPreview(cssValue, next);
            onCommit(cssValue, next);
          }}
        >
          <InspectorSelectTrigger
            aria-label={`${ariaLabel} unit`}
            className={cn(
              "h-7 w-auto min-w-0 shrink-0 gap-0 rounded-none border-0 px-2 text-xs shadow-none [&>svg]:hidden",
              inspectorControlSegmentSurface,
            )}
          >
            <SelectValue>{value.value === null ? "-" : value.unit}</SelectValue>
          </InspectorSelectTrigger>
          <InspectorSelectContent className="w-16 min-w-16">
            {units.map((unit) => (
              <InspectorSelectItem key={unit} value={unit}>
                {unit === "auto" ? "Auto" : unit === "none" ? "None" : unit}
              </InspectorSelectItem>
            ))}
          </InspectorSelectContent>
        </Select>
      }
      trailingAction={trailingAction}
    />
  );
}
