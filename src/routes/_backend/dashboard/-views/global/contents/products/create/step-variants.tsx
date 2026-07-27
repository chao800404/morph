import { createSurface } from "@/components/dialog/create-surface";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
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
  currencies,
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
  currencies: StoreCurrencyDTO[];
}) => {
  const included = draft.variants.filter((variant) => variant.included);

  if (!draft.hasVariants) {
    return (
      <div className={cn(createSurface.content, "flex w-full flex-col gap-6")}>
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-foreground">Variants</h2>
          <p className="text-sm text-muted-foreground">
            This product has no options, so a single default variant is created.
          </p>
        </div>

        <FieldsRenderer
          fields={currencies.map((currency) => ({
            type: "input" as const,
            name: `default-price-${currency.code}`,
            label: `Price ${currency.code.toUpperCase()}`,
            inputType: "number",
            placeholder:
              currency.decimalDigits > 0
                ? `0.${"0".repeat(currency.decimalDigits)}`
                : "0",
            value: draft.defaultPrices[currency.code] ?? "",
            colSpan: 1 as const,
          }))}
          className="grid-cols-1 sm:grid-cols-2"
          onChange={(name, value) => {
            const currency = name.replace("default-price-", "");
            if (typeof value === "string") {
              dispatch({ type: "setDefaultPrice", currency, value });
            }
          }}
        />
      </div>
    );
  }

  if (included.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          No variants selected. Go back to Details, pick an option with values,
          and tick the combinations you want to sell.
        </p>
      </div>
    );
  }

  return (
    <div className="relative z-50 flex w-full flex-col gap-4 px-5 pt-24 pb-10">
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
              {currencies.map((currency) => (
                <TableHead key={currency.code} className="min-w-[120px]">
                  Price {currency.code.toUpperCase()}
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
                {currencies.map((currency) => (
                  <TableCell key={currency.code}>
                    <Input
                      variant="card"
                      type="number"
                      min="0"
                      step={10 ** -currency.decimalDigits}
                      placeholder={
                        currency.decimalDigits > 0
                          ? `0.${"0".repeat(currency.decimalDigits)}`
                          : "0"
                      }
                      aria-label={`Price ${currency.code.toUpperCase()} for ${variant.key}`}
                      value={variant.prices[currency.code] ?? ""}
                      onChange={(event) =>
                        dispatch({
                          type: "setVariantPrice",
                          key: variant.key,
                          currency: currency.code,
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
