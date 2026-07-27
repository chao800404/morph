import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ProductVariantDTO } from "@/lib/product/dto/product-variant.dto";
import { Check, Trash2 } from "lucide-react";
import { useState } from "react";

/**
 * One editable variant.
 *
 * Edits are held locally and saved per row, so a typo in one variant cannot
 * abandon changes made to another. The Save button only appears once something
 * differs from what the server returned.
 */

/** Minor units to the major units shown in the field. */
const toMajor = (amount: number): string => (amount / 100).toFixed(2);

/** Major units as typed, back to the integer minor units the API stores. */
export const toMinor = (value: string): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};

export interface VariantEdit {
  title: string;
  sku: string;
  inventoryQuantity: string;
  manageInventory: boolean;
  allowBackorder: boolean;
  prices: Record<string, string>;
}

const toEdit = (variant: ProductVariantDTO): VariantEdit => ({
  title: variant.title,
  sku: variant.sku ?? "",
  inventoryQuantity: String(variant.inventoryQuantity),
  manageInventory: variant.manageInventory,
  allowBackorder: variant.allowBackorder,
  prices: Object.fromEntries(
    variant.prices.map((price) => [price.currencyCode, toMajor(price.amount)]),
  ),
});

export const VariantRow = ({
  variant,
  currencies,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: {
  variant: ProductVariantDTO;
  currencies: string[];
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (edit: VariantEdit) => void;
  onDelete: () => void;
}) => {
  const saved = toEdit(variant);
  const [edit, setEdit] = useState<VariantEdit>(saved);

  const dirty = JSON.stringify(edit) !== JSON.stringify(saved);
  const busy = isSaving || isDeleting;

  const set = <K extends keyof VariantEdit>(key: K, value: VariantEdit[K]) =>
    setEdit((current) => ({ ...current, [key]: value }));

  return (
    <TableRow className={busy ? "opacity-60" : undefined}>
      <TableCell>
        <Input
          variant="card"
          aria-label={`Title for ${variant.title}`}
          value={edit.title}
          disabled={busy}
          onChange={(event) => set("title", event.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          variant="card"
          aria-label={`SKU for ${variant.title}`}
          placeholder="—"
          value={edit.sku}
          disabled={busy}
          onChange={(event) => set("sku", event.target.value)}
        />
      </TableCell>
      <TableCell className="text-center">
        <Checkbox
          aria-label={`Manage inventory for ${variant.title}`}
          checked={edit.manageInventory}
          disabled={busy}
          onCheckedChange={(checked) =>
            set("manageInventory", checked === true)
          }
        />
      </TableCell>
      <TableCell className="text-center">
        <Checkbox
          aria-label={`Allow backorder for ${variant.title}`}
          checked={edit.allowBackorder}
          disabled={busy}
          onCheckedChange={(checked) => set("allowBackorder", checked === true)}
        />
      </TableCell>
      <TableCell>
        <Input
          variant="card"
          type="number"
          min="0"
          aria-label={`Quantity for ${variant.title}`}
          value={edit.inventoryQuantity}
          disabled={busy || !edit.manageInventory}
          onChange={(event) => set("inventoryQuantity", event.target.value)}
        />
      </TableCell>
      {currencies.map((currency) => (
        <TableCell key={currency}>
          <Input
            variant="card"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            aria-label={`Price ${currency.toUpperCase()} for ${variant.title}`}
            value={edit.prices[currency] ?? ""}
            disabled={busy}
            onChange={(event) =>
              set("prices", { ...edit.prices, [currency]: event.target.value })
            }
          />
        </TableCell>
      ))}
      <TableCell className="pr-6">
        <div className="flex items-center justify-end gap-1">
          {isSaving || isDeleting ? (
            <Spinner className="size-4" />
          ) : (
            <>
              {dirty && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Save ${variant.title}`}
                  onClick={() => onSave(edit)}
                >
                  <Check className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${variant.title}`}
                onClick={onDelete}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};
