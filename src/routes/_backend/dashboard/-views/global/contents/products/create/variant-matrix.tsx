import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";
import { useState, type Dispatch } from "react";
import type { DraftAction, DraftOption, DraftVariant } from "./use-product-draft";

/**
 * Every combination the chosen option values produce, one row each.
 *
 * The row order is the rank the storefront sells them in, so it is draggable;
 * unticking a row leaves that combination uncreated.
 */
export const VariantMatrix = ({
  options,
  variants,
  dispatch,
}: {
  options: DraftOption[];
  variants: DraftVariant[];
  dispatch: Dispatch<DraftAction>;
}) => {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);

  const axes = options.filter((option) => option.selectedValueIds.length > 0);

  const onDragOver = (event: React.DragEvent, key: string) => {
    event.preventDefault();
    if (draggedKey === null || draggedKey === key) return;
    dispatch({ type: "moveVariant", key: draggedKey, beforeKey: key });
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h3 className="font-medium text-foreground">Product variants</h3>
        <p className="text-sm text-muted-foreground">
          This ranking will affect the variants' order in your storefront.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60">
        <div className="flex items-center gap-4 border-b border-border/60 bg-muted/30 px-4 py-3">
          <Checkbox
            checked={variants.every((variant) => variant.included)}
            aria-label="Toggle all variants"
            onCheckedChange={(checked) =>
              dispatch({
                type: "toggleAllVariants",
                included: checked === true,
              })
            }
          />
          <span className="w-4" aria-hidden />
          {axes.map((option) => (
            <span
              key={option.key}
              className="flex-1 text-sm font-medium text-foreground"
            >
              {option.title}
            </span>
          ))}
        </div>

        <div className="divide-y divide-border/40">
          {variants.map((variant) => (
            <div
              key={variant.key}
              draggable
              onDragStart={() => setDraggedKey(variant.key)}
              onDragOver={(event) => onDragOver(event, variant.key)}
              onDragEnd={() => setDraggedKey(null)}
              className={cn(
                "flex items-center gap-4 px-4 py-3 transition-colors",
                draggedKey === variant.key
                  ? "bg-accent/60 opacity-40"
                  : "hover:bg-accent/20",
                !variant.included && "text-muted-foreground",
              )}
            >
              <Checkbox
                checked={variant.included}
                aria-label={`Include ${variant.key}`}
                onCheckedChange={(checked) =>
                  dispatch({
                    type: "toggleVariant",
                    key: variant.key,
                    included: checked === true,
                  })
                }
              />
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" />
              {variant.optionValues.map((value, index) => (
                <span
                  key={`${variant.key}-${index}`}
                  className="flex-1 text-sm"
                >
                  {value}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="rounded-lg border-l-2 border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Tip:</span> Variants left
        unchecked won't be created. You can always create and edit variants
        afterwards, but this list is the fastest way to set them up.
      </p>
    </div>
  );
};
