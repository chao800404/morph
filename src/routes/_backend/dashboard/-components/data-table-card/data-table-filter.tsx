import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, X } from "lucide-react";

export interface DataTableFilterOption<TValue extends string> {
  value: TValue;
  label: string;
}

interface DataTableFilterProps<TValue extends string> {
  label: string;
  filterLabel: string;
  options: DataTableFilterOption<TValue>[];
  value?: TValue;
  onValueChange: (value: TValue | undefined) => void;
}

/**
 * A compact, URL-state-agnostic list filter.
 *
 * The feature owns the actual query state. This primitive owns the Add filter
 * menu and the removable active-filter chip so list cards share one interaction
 * and surface treatment.
 */
export const DataTableFilter = <TValue extends string>({
  label,
  filterLabel,
  options,
  value,
  onValueChange,
}: DataTableFilterProps<TValue>) => {
  const activeOption = options.find((option) => option.value === value);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="cardHeader" size="xs">
            {label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onValueChange(option.value)}
            >
              <Check
                className={
                  option.value === value
                    ? "size-4 opacity-100"
                    : "size-4 opacity-0"
                }
              />
              {option.label}
            </DropdownMenuItem>
          ))}
          {value && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onValueChange(undefined)}>
                Clear filter
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {activeOption && (
        <Button
          type="button"
          variant="cardHeader"
          size="xs"
          aria-label={`Remove ${filterLabel} filter: ${activeOption.label}`}
          onClick={() => onValueChange(undefined)}
        >
          {filterLabel}: {activeOption.label}
          <X className="size-3.5" />
        </Button>
      )}
    </>
  );
};
