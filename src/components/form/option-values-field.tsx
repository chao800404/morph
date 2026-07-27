import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { inputVariants } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, GripVertical, X } from "lucide-react";
import React, { useState } from "react";

/** A value that already exists on a shared option. */
export interface OptionValueChoice {
  id: string;
  value: string;
}

interface OptionValuesFieldProps {
  name: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string[];
  value?: string[];
  onChange?: (name: string, value: string[]) => void;
  className?: string;
  /**
   * Switches the field from typing to picking.
   *
   * The Options page creates values, so there it types freely. A product only
   * chooses among the values its option already has, so passing `choices`
   * turns the same field into a dropdown of those values and drops the text
   * input — one component, two modes, rather than two lookalike fields.
   */
  choices?: OptionValueChoice[];
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Refuses further picks once this many are selected. */
  maxSelected?: number;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export const OptionValuesField = (props: OptionValuesFieldProps) =>
  props.choices ? (
    <ChoiceValues
      name={props.name}
      choices={props.choices}
      selectedIds={props.selectedIds ?? []}
      onSelectionChange={props.onSelectionChange}
      maxSelected={props.maxSelected}
      placeholder={props.placeholder}
      searchPlaceholder={props.searchPlaceholder}
      emptyMessage={props.emptyMessage}
      className={props.className}
    />
  ) : (
    <FreeformValues {...props} />
  );

/**
 * Pick from an existing set. The chips live in the trigger and the choices in a
 * dropdown, so the field stays one row tall however many values exist — an
 * always-open list would repeat whatever table the values feed.
 */
const ChoiceValues = ({
  name,
  choices,
  selectedIds,
  onSelectionChange,
  maxSelected,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "Nothing found.",
  className,
}: {
  name: string;
  choices: OptionValueChoice[];
  selectedIds: string[];
  onSelectionChange?: (ids: string[]) => void;
  maxSelected?: number;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const atLimit =
    maxSelected !== undefined && selectedIds.length >= maxSelected;

  // Selection order follows `choices`, so the chips and anything derived from
  // them stay in the order the source defines rather than click order.
  const toggle = (id: string, selected: boolean) =>
    onSelectionChange?.(
      selected
        ? choices
            .filter((c) => c.id === id || selectedIds.includes(c.id))
            .map((c) => c.id)
        : selectedIds.filter((current) => current !== id),
    );

  const selected = choices.filter((choice) => selectedIds.includes(choice.id));

  return (
    <div className={cn("w-full", className)}>
      <input type="hidden" name={name} value={JSON.stringify(selectedIds)} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            role="combobox"
            aria-expanded={open}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen((current) => !current);
              }
            }}
            className={cn(
              inputVariants({ variant: "card", size: "md" }),
              "h-auto min-h-9 cursor-pointer flex-wrap items-center gap-2 py-2",
              "focus:border-ring focus:ring-ring/50 focus:ring-[3px] focus:outline-none",
            )}
          >
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {selected.length === 0 ? (
                <span className="text-sm text-muted-foreground/70">
                  {placeholder}
                </span>
              ) : (
                selected.map((choice) => (
                  <Badge
                    key={choice.id}
                    variant="secondary"
                    className="gap-1.5 px-2.5 py-1 text-xs font-medium bg-muted/80 hover:bg-muted text-foreground border border-border/40 select-none"
                  >
                    <span>{choice.value}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${choice.value}`}
                      // Removing a chip must not also open the dropdown.
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(choice.id, false);
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors rounded-xs p-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </div>
        </PopoverTrigger>

        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {choices.map((choice) => {
                  const checked = selectedIds.includes(choice.id);
                  return (
                    <CommandItem
                      key={choice.id}
                      value={choice.value}
                      // Staying open lets several be picked in one pass.
                      onSelect={() => toggle(choice.id, !checked)}
                      disabled={!checked && atLimit}
                    >
                      <Checkbox
                        checked={checked}
                        className="pointer-events-none"
                      />
                      <span className="flex-1">{choice.value}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

const FreeformValues = ({
  name,
  placeholder = "Type value and press Enter...",
  defaultValue = [],
  value: propValue,
  onChange,
  className,
}: OptionValuesFieldProps) => {
  const [values, setValues] = useState<string[]>(
    propValue || defaultValue || [],
  );
  const [inputValue, setInputValue] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const updateValues = (newValues: string[]) => {
    setValues(newValues);
    onChange?.(name, newValues);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (trimmed && !values.includes(trimmed)) {
        updateValues([...values, trimmed]);
        setInputValue("");
      }
    } else if (e.key === "Backspace" && !inputValue && values.length > 0) {
      updateValues(values.slice(0, -1));
    }
  };

  const handleRemove = (indexToRemove: number) => {
    updateValues(values.filter((_, idx) => idx !== indexToRemove));
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newValues = [...values];
    const item = newValues.splice(draggedIndex, 1)[0];
    newValues.splice(index, 0, item);
    setDraggedIndex(index);
    updateValues(newValues);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className={cn("space-y-4 w-full", className)}>
      {/* Hidden input for standard form submission */}
      <input type="hidden" name={name} value={JSON.stringify(values)} />

      {/* Tag Chips & Input Box */}
      <div className="space-y-2">
        <div
          className={cn(
            inputVariants({ variant: "card", size: "md" }),
            "h-auto min-h-9 flex-wrap gap-2 py-2",
            "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          )}
        >
          {values.map((item, idx) => (
            <Badge
              key={`${item}-${idx}`}
              variant="secondary"
              className="gap-1.5 px-2.5 py-1 text-xs font-medium bg-muted/80 hover:bg-muted text-foreground border border-border/40 select-none"
            >
              <span>{item}</span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="text-muted-foreground hover:text-foreground transition-colors rounded-xs p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={values.length === 0 ? placeholder : "Add value..."}
            className="flex-1 bg-transparent text-sm border-none outline-none min-w-[120px] text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
      </div>

      {/* Organize Rankings / Drag & Drop Reorder List */}
      {values.length > 0 && (
        <div
          className={cn(
            inputVariants({ variant: "card", size: "md" }),
            "block h-auto min-h-0 overflow-hidden p-0",
          )}
        >
          <div className="px-4 py-3 bg-muted/30 border-b border-border/40 text-sm font-medium text-foreground select-none">
            Organize rankings
          </div>
          <div className="divide-y divide-border/30">
            {values.map((item, idx) => (
              <div
                key={`rank-${item}-${idx}`}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  "flex items-center gap-4 px-4 py-3 text-sm font-medium transition-colors select-none",
                  "cursor-grab active:cursor-grabbing hover:bg-accent/40",
                  draggedIndex === idx ? "opacity-40 bg-accent/60" : "bg-transparent",
                )}
              >
                <GripVertical className="size-4 text-muted-foreground/60 shrink-0" />
                <span className="text-foreground flex-1">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
