import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className="min-w-0 text-xs"
      >
        <span
          aria-hidden="true"
          className="shrink-0 text-[10px] text-muted-foreground"
        >
          {label}
        </span>
        <span className="ml-auto min-w-0 truncate text-right">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {formatOption(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
