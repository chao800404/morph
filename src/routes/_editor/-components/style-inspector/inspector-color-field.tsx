import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type InspectorColorFieldProps = {
  label: string;
  value: string;
  disabled?: boolean;
  onPreview: (value: string) => void;
  onCommit: (value: string) => void;
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function toPickerColor(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .slice(1)
      .split("")
      .map((character) => character + character)
      .join("")}`;
  }
  return "#fafaf9";
}

export function InspectorColorField({
  label,
  value,
  disabled = false,
  onPreview,
  onCommit,
}: InspectorColorFieldProps) {
  const textInputRef = useRef<HTMLInputElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const confirmedValueRef = useRef(value);
  const skipNextCommitRef = useRef(false);

  useEffect(() => {
    const activeElement = document.activeElement;
    if (
      activeElement === textInputRef.current ||
      activeElement === pickerInputRef.current
    ) {
      return;
    }
    if (textInputRef.current) textInputRef.current.value = value;
    if (pickerInputRef.current) {
      pickerInputRef.current.value = toPickerColor(value);
    }
    confirmedValueRef.current = value;
  }, [value]);

  const restoreConfirmedValue = () => {
    if (textInputRef.current) {
      textInputRef.current.value = confirmedValueRef.current;
    }
    if (pickerInputRef.current) {
      pickerInputRef.current.value = toPickerColor(confirmedValueRef.current);
    }
  };

  const commitTextValue = () => {
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
      return;
    }
    const nextValue = textInputRef.current?.value.trim() ?? "";
    if (!HEX_COLOR_PATTERN.test(nextValue)) {
      restoreConfirmedValue();
      return;
    }
    confirmedValueRef.current = nextValue;
    if (pickerInputRef.current) {
      pickerInputRef.current.value = toPickerColor(nextValue);
    }
    onCommit(nextValue);
  };

  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center rounded-md border bg-background px-2",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {label}
      </span>
      <input
        ref={textInputRef}
        type="text"
        defaultValue={value}
        aria-label={`${label} color value`}
        onInput={(event) => {
          const nextValue = event.currentTarget.value.trim();
          if (HEX_COLOR_PATTERN.test(nextValue)) onPreview(nextValue);
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
        placeholder="#ffffff"
        className="ml-auto h-7 min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-xs outline-none"
      />
      <input
        ref={pickerInputRef}
        type="color"
        defaultValue={toPickerColor(value)}
        aria-label={`${label} color picker`}
        onInput={(event) => {
          const nextValue = event.currentTarget.value;
          if (textInputRef.current) textInputRef.current.value = nextValue;
          onPreview(nextValue);
        }}
        onBlur={(event) => {
          const nextValue = event.currentTarget.value;
          confirmedValueRef.current = nextValue;
          if (textInputRef.current) textInputRef.current.value = nextValue;
          onCommit(nextValue);
        }}
        disabled={disabled}
        className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
      />
    </div>
  );
}
