import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Checkbox } from "@/components/ui/checkbox";
import { inputVariants } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { FormField } from "@/lib/validations/form";
import { GripVertical } from "lucide-react";
import { useState, type Dispatch } from "react";
import type {
  DraftAction,
  DraftOption,
  DraftVariant,
} from "./use-product-draft";

const variantTipFields: FormField[] = [
  {
    type: "tip",
    name: "variant-creation-tip",
    description:
      "Variants left unchecked won’t be created. You can always create and edit variants afterwards, but this list is the fastest way to set them up.",
    colSpan: 1,
  },
];

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

      <div
        className={cn(
          inputVariants({ variant: "card", size: "md" }),
          "block h-auto min-h-0 overflow-hidden p-0",
        )}
      >
        <Table>
          <TableHeader variant="card">
            <TableRow>
              <TableHead className="w-12">
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
              </TableHead>
              <TableHead className="w-8" />
              {axes.map((option) => (
                <TableHead key={option.key}>{option.title}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) => (
              <TableRow
                key={variant.key}
                variant="card"
                draggable
                onDragStart={() => setDraggedKey(variant.key)}
                onDragOver={(event) => onDragOver(event, variant.key)}
                onDragEnd={() => setDraggedKey(null)}
                className={cn(
                  "h-11",
                  draggedKey === variant.key && "bg-accent/60 opacity-40",
                  !variant.included && "text-muted-foreground",
                )}
              >
                <TableCell>
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
                </TableCell>
                <TableCell>
                  <GripVertical className="size-4 cursor-grab text-muted-foreground/60 active:cursor-grabbing" />
                </TableCell>
                {variant.optionValues.map((value, index) => (
                  <TableCell key={`${variant.key}-${index}`}>{value}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <FieldsRenderer fields={variantTipFields} className="grid-cols-1 gap-0" />
    </div>
  );
};
