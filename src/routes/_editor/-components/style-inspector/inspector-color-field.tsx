import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { inspectorControlSurface } from "./inspector-control-surface";
import { InspectorColorPickerPopover } from "./inspector-color-picker-popover";
import {
  isInspectorPaint,
  normalizeInspectorPaint,
} from "./inspector-paint-utils";

type InspectorColorPaletteOption = {
  label: string;
  value: string;
  preview: string;
};

type InspectorColorFieldProps = {
  label: string;
  value: string;
  disabled?: boolean;
  allowGradient?: boolean;
  onPreview: (value: string) => void;
  onCommit: (value: string) => void;
  onClear?: () => void;
  palette?: readonly InspectorColorPaletteOption[];
};

export function InspectorColorField({
  label,
  value,
  disabled = false,
  allowGradient = false,
  onPreview,
  onCommit,
  onClear,
  palette = [],
}: InspectorColorFieldProps) {
  const textInputRef = useRef<HTMLInputElement>(null);
  const swatchRef = useRef<HTMLSpanElement>(null);
  const clearIndicatorRef = useRef<HTMLSpanElement>(null);
  const confirmedValueRef = useRef(value);
  const skipNextCommitRef = useRef(false);

  const updateDraftDisplay = useCallback(
    (nextValue: string) => {
      if (textInputRef.current) textInputRef.current.value = nextValue;
      if (swatchRef.current) {
        swatchRef.current.style.background = isInspectorPaint(
          nextValue,
          allowGradient,
        )
          ? normalizeInspectorPaint(nextValue)
          : "transparent";
      }
      if (clearIndicatorRef.current) {
        clearIndicatorRef.current.hidden = nextValue.length > 0;
      }
    },
    [allowGradient],
  );

  useEffect(() => {
    if (document.activeElement === textInputRef.current) return;
    updateDraftDisplay(value);
    confirmedValueRef.current = value;
  }, [updateDraftDisplay, value]);

  const restoreConfirmedValue = () => {
    updateDraftDisplay(confirmedValueRef.current);
  };

  const commitValue = (nextValue: string) => {
    const normalized = normalizeInspectorPaint(nextValue);
    if (!isInspectorPaint(normalized, allowGradient)) {
      restoreConfirmedValue();
      return;
    }
    confirmedValueRef.current = normalized;
    updateDraftDisplay(normalized);
    onCommit(normalized);
  };

  const commitTextValue = () => {
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
      return;
    }
    commitValue(textInputRef.current?.value ?? "");
  };

  const clearColor = () => {
    confirmedValueRef.current = "";
    updateDraftDisplay("");
    onClear?.();
  };

  const previewValue = isInspectorPaint(value, allowGradient)
    ? value
    : "transparent";

  return (
    <div
      className={cn(
        inspectorControlSurface,
        "flex h-8 min-w-0 items-center px-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <input
        ref={textInputRef}
        type="text"
        defaultValue={value}
        aria-label={`${label} color value`}
        onInput={(event) => {
          const nextValue = event.currentTarget.value;
          updateDraftDisplay(nextValue);
          if (isInspectorPaint(nextValue, allowGradient)) {
            onPreview(normalizeInspectorPaint(nextValue));
          }
        }}
        onBlur={commitTextValue}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            restoreConfirmedValue();
            skipNextCommitRef.current = true;
            event.currentTarget.blur();
          }
        }}
        disabled={disabled}
        placeholder={allowGradient ? "#ffffff or gradient" : "#ffffff"}
        className="ml-auto h-7 min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-xs outline-none"
      />
      <InspectorColorPickerPopover
        label={label}
        value={value}
        disabled={disabled}
        allowGradient={allowGradient}
        palette={palette.map((item) => item.value)}
        onPreview={onPreview}
        onCommit={commitValue}
        onClear={onClear ? clearColor : undefined}
        onDraftChange={updateDraftDisplay}
        trigger={
          <button
            type="button"
            aria-label={`Open ${label} color picker`}
            className="relative size-6 shrink-0 overflow-hidden rounded border border-[#4a4a4f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              backgroundColor: "#1c1c1e",
              backgroundImage:
                "linear-gradient(45deg,#2c2c2f 25%,transparent 25%,transparent 75%,#2c2c2f 75%),linear-gradient(45deg,#2c2c2f 25%,#1c1c1e 25%,#1c1c1e 75%,#2c2c2f 75%)",
              backgroundPosition: "0 0, 4px 4px",
              backgroundSize: "8px 8px",
            }}
          >
            <span
              ref={swatchRef}
              data-inspector-color-swatch
              className="absolute inset-0"
              style={{ background: previewValue }}
            />
            <span
              ref={clearIndicatorRef}
              data-inspector-color-clear-indicator
              hidden={Boolean(value)}
              className="absolute left-0 top-1/2 h-px w-8 -translate-x-1 -translate-y-1/2 -rotate-45 bg-destructive"
            />
          </button>
        }
      />
    </div>
  );
}
