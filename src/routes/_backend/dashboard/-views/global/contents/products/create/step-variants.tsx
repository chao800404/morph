import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Dispatch } from "react";
import type { DraftAction, ProductDraft } from "./use-product-draft";

/**
 * Per-variant editing grid.
 *
 * Prices are typed in major units and converted on submit, so the column
 * headers name the currency rather than showing a symbol per cell.
 */
export const StepVariants = ({
  draft,
  dispatch,
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
}) => {
  const included = draft.variants.filter((variant) => variant.included);

  if (!draft.hasVariants) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-10">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-foreground">Variants</h2>
          <p className="text-sm text-muted-foreground">
            This product has no options, so a single default variant is created.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {draft.currencies.map((currency) => (
            <div key={currency} className="space-y-2">
              <Label htmlFor={`default-price-${currency}`}>
                Price {currency.toUpperCase()}
              </Label>
              <Input
                id={`default-price-${currency}`}
                variant="card"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={draft.defaultPrices[currency] ?? ""}
                onChange={(event) =>
                  dispatch({
                    type: "setDefaultPrice",
                    currency,
                    value: event.target.value,
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (included.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          No variants selected. Go back to Details, add at least one option with
          values, and tick the combinations you want to sell.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-foreground">Variants</h2>
        <p className="text-sm text-muted-foreground">
          {included.length} variant{included.length === 1 ? "" : "s"} will be
          created.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[160px]">Options</TableHead>
              <TableHead className="min-w-[180px]">Title</TableHead>
              <TableHead className="min-w-[140px]">SKU</TableHead>
              <TableHead className="w-32 text-center">
                Managed inventory
              </TableHead>
              <TableHead className="w-28 text-center">
                Allow backorder
              </TableHead>
              <TableHead className="w-28">Quantity</TableHead>
              {draft.currencies.map((currency) => (
                <TableHead key={currency} className="min-w-[120px]">
                  Price {currency.toUpperCase()}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {included.map((variant) => (
              <TableRow key={variant.key}>
                <TableCell className="text-muted-foreground">
                  {variant.key}
                </TableCell>
                <TableCell>
                  <Input
                    variant="card"
                    aria-label={`Title for ${variant.key}`}
                    value={variant.title}
                    onChange={(event) =>
                      dispatch({
                        type: "setVariantField",
                        key: variant.key,
                        field: "title",
                        value: event.target.value,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    variant="card"
                    aria-label={`SKU for ${variant.key}`}
                    value={variant.sku}
                    onChange={(event) =>
                      dispatch({
                        type: "setVariantField",
                        key: variant.key,
                        field: "sku",
                        value: event.target.value,
                      })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={variant.manageInventory}
                    aria-label={`Manage inventory for ${variant.key}`}
                    onCheckedChange={(checked) =>
                      dispatch({
                        type: "setVariantFlag",
                        key: variant.key,
                        field: "manageInventory",
                        value: checked === true,
                      })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={variant.allowBackorder}
                    aria-label={`Allow backorder for ${variant.key}`}
                    onCheckedChange={(checked) =>
                      dispatch({
                        type: "setVariantFlag",
                        key: variant.key,
                        field: "allowBackorder",
                        value: checked === true,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    variant="card"
                    type="number"
                    min="0"
                    aria-label={`Quantity for ${variant.key}`}
                    value={variant.inventoryQuantity}
                    onChange={(event) =>
                      dispatch({
                        type: "setVariantField",
                        key: variant.key,
                        field: "inventoryQuantity",
                        value: event.target.value,
                      })
                    }
                  />
                </TableCell>
                {draft.currencies.map((currency) => (
                  <TableCell key={currency}>
                    <Input
                      variant="card"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      aria-label={`Price ${currency.toUpperCase()} for ${variant.key}`}
                      value={variant.prices[currency] ?? ""}
                      onChange={(event) =>
                        dispatch({
                          type: "setVariantPrice",
                          key: variant.key,
                          currency,
                          value: event.target.value,
                        })
                      }
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
