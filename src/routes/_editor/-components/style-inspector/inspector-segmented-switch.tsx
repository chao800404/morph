import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { inspectorControlSurface } from "./inspector-control-surface";

export interface InspectorSegmentedOption<T extends string = string> {
  id: T;
  label: ReactNode;
  title?: string;
}

export function InspectorSegmentedSwitch<T extends string = string>({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
  className,
}: {
  value: T;
  options: readonly InspectorSegmentedOption<T>[];
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        inspectorControlSurface,
        "flex h-7 shrink-0 items-center gap-0.5 p-0.5",
        className,
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
            value === option.id
              ? "bg-background text-foreground shadow-sm hover:bg-background"
              : "text-muted-foreground",
          )}
          disabled={disabled || value === option.id}
          onClick={() => onChange(option.id)}
          title={option.title}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
