import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { inspectorControlSurface } from "./inspector-control-surface";

export function InspectorSelectTrigger({
  className,
  size = "sm",
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  return (
    <SelectTrigger
      size={size}
      className={cn(inspectorControlSurface, "min-w-0 text-xs", className)}
      {...props}
    />
  );
}

export function InspectorSelectContent({
  className,
  align = "end",
  sideOffset = 2,
  ...props
}: ComponentProps<typeof SelectContent>) {
  return (
    <SelectContent
      align={align}
      sideOffset={sideOffset}
      className={cn("min-w-24", className)}
      {...props}
    />
  );
}

export function InspectorSelectItem({
  className,
  ...props
}: ComponentProps<typeof SelectItem>) {
  return (
    <SelectItem
      className={cn("min-h-7 py-1 pr-7 pl-2 text-xs [&_svg]:size-3", className)}
      {...props}
    />
  );
}

type InspectorSelectControlProps = {
  label: string;
  ariaLabel: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  formatOption?: (value: string) => string;
  onValueChange: (value: string) => void;
};

export function InspectorSelectControl({
  label,
  ariaLabel,
  value,
  options,
  disabled,
  formatOption = (option) => option,
  onValueChange,
}: InspectorSelectControlProps) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <InspectorSelectTrigger aria-label={ariaLabel}>
        <span
          aria-hidden="true"
          className="shrink-0 text-xs text-muted-foreground"
        >
          {label}
        </span>
        <span className="ml-auto min-w-0 truncate text-right">
          <SelectValue />
        </span>
      </InspectorSelectTrigger>
      <InspectorSelectContent>
        {options.map((option) => (
          <InspectorSelectItem key={option} value={option}>
            {formatOption(option)}
          </InspectorSelectItem>
        ))}
      </InspectorSelectContent>
    </Select>
  );
}
