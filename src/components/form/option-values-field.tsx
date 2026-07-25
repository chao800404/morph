import { Badge } from "@/components/ui/badge";
import { inputVariants } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GripVertical, X } from "lucide-react";
import React, { useState } from "react";

interface OptionValuesFieldProps {
  name: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string[];
  value?: string[];
  onChange?: (name: string, value: string[]) => void;
  className?: string;
}

export const OptionValuesField = ({
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
