import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import {
  Command,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { useState } from "react";
export interface DataTableFilterOption<TValue extends string> {
  value: TValue;
  label: string;
}

export interface DataTableFilterDefinition<TValue extends string = string> {
  key: string;
  label: string;
  options: DataTableFilterOption<TValue>[];
  values: TValue[];
  multiple?: boolean;
  onValuesChange: (values: TValue[]) => void;
}

interface DataTableFiltersProps {
  filters: DataTableFilterDefinition[];
}

/**
 * Medusa-style filtering for DataTableCard.
 *
 * Add filter selects a field first. That creates a filter pill and opens its
 * multi-select value popover. Pills, value summaries and Clear all are owned by
 * the table layer so feature tables only declare their filter definitions.
 */
export const DataTableFilters = ({ filters }: DataTableFiltersProps) => {
  const [draftFilterKey, setDraftFilterKey] = useState<string>();
  const [openFilterKey, setOpenFilterKey] = useState<string>();
  const activeFilters = filters.filter(
    (filter) => filter.values.length > 0 || filter.key === draftFilterKey,
  );
  const availableFilters = filters.filter(
    (filter) =>
      filter.values.length === 0 && filter.key !== draftFilterKey,
  );

  const clearFilter = (filter: DataTableFilterDefinition) => {
    filter.onValuesChange([]);
    setDraftFilterKey((key) => (key === filter.key ? undefined : key));
    setOpenFilterKey((key) => (key === filter.key ? undefined : key));
  };

  return (
    <>
      {activeFilters.map((filter) => {
        const selectedOptions = filter.options.filter((option) =>
          filter.values.includes(option.value),
        );
        const valueLabel = selectedOptions.map((option) => option.label).join(", ");

        return (
          <Popover
            key={filter.key}
            open={openFilterKey === filter.key}
            onOpenChange={(open) => {
              if (
                !open &&
                draftFilterKey === filter.key &&
                filter.values.length === 0
              ) {
                return;
              }
              setOpenFilterKey(open ? filter.key : undefined);
            }}
          >
            <ButtonGroup>
              <PopoverTrigger asChild>
                <Button
                  variant="cardHeader"
                  size="xs"
                  className="gap-0 px-0"
                  aria-label={`${filter.label} filter`}
                >
                  <span className="px-2 font-medium">{filter.label}</span>
                  {filter.values.length > 0 ? (
                    <>
                      <ButtonGroupSeparator />
                      <span className="px-2 text-muted-foreground">is</span>
                      <ButtonGroupSeparator />
                      <span className="max-w-48 truncate px-2">
                        {valueLabel}
                      </span>
                    </>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <Button
                variant="cardHeader"
                size="icon"
                aria-label={`Remove ${filter.label} filter${valueLabel ? `: ${valueLabel}` : ""}`}
                onClick={() => clearFilter(filter)}
              >
                <X className="size-3.5" />
              </Button>
            </ButtonGroup>
            <PopoverContent align="start" className="w-56 p-1">
              <Command variant="embedded">
                <CommandList
                  role="listbox"
                  aria-label={`${filter.label} suggestions`}
                  aria-multiselectable="true"
                >
                  {filter.options.map((option) => {
                    const selected = filter.values.includes(option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        role="option"
                        aria-selected={selected}
                        onSelect={() => {
                          if (selected) {
                            filter.onValuesChange(
                              filter.values.filter(
                                (value) => value !== option.value,
                              ),
                            );
                            return;
                          }
                          filter.onValuesChange(
                            filter.multiple === false
                              ? [option.value]
                              : [...filter.values, option.value],
                          );
                        }}
                      >
                        <Check
                          className={cn(
                            "size-4",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {option.label}
                      </CommandItem>
                    );
                  })}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        );
      })}

      {availableFilters.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="cardHeader" size="xs">
              Add filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {availableFilters.map((filter) => (
              <DropdownMenuItem
                key={filter.key}
                onSelect={() => {
                  setDraftFilterKey(filter.key);
                  // Let Radix finish closing the field menu before opening the
                  // value popover; otherwise its outside-dismiss event closes
                  // both layers in the same interaction.
                  window.setTimeout(() => setOpenFilterKey(filter.key), 50);
                }}
              >
                {filter.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {filters.some((filter) => filter.values.length > 0) ? (
        <Button
          type="button"
          variant="destructive"
          size="xs"
          onClick={() => {
            filters.forEach((filter) => filter.onValuesChange([]));
            setDraftFilterKey(undefined);
            setOpenFilterKey(undefined);
          }}
        >
          Clear all
        </Button>
      ) : null}
    </>
  );
};
