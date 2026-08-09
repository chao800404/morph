import { Checkbox } from "@/components/ui/checkbox";
import {
  DataGrid,
  DataGridBody,
  DataGridBooleanCell,
  DataGridCell,
  DataGridHead,
  DataGridHeader,
  DataGridInput,
  DataGridReadonlyCell,
  DataGridRow,
} from "@/components/ui/data-grid";
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
  const displayedVariants = draft.hasVariants
    ? included
    : [draft.defaultVariant];
  const optionHeader = draft.hasVariants
    ? draft.options
        .filter((option) => option.selectedValueIds.length > 0)
        .map((option) => option.title)
        .join(" / ")
    : "";

  if (draft.hasVariants && included.length === 0) {
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
    <div className="flex size-full min-h-0 flex-col overflow-hidden">
      {!draft.hasVariants ? (
        <div className="border-b px-4 py-3">
          <p className="text-sm text-muted-foreground">
            This product has no options, so a single default variant is created.
          </p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <DataGrid>
          <DataGridHeader>
            <DataGridRow>
              <DataGridHead className="min-w-[180px]">
                {optionHeader || "Options"}
              </DataGridHead>
              <DataGridHead className="min-w-[200px]">Title</DataGridHead>
              <DataGridHead className="min-w-[160px]">SKU</DataGridHead>
              <DataGridHead className="w-36 text-center">
                Managed inventory
              </DataGridHead>
              <DataGridHead className="w-32 text-center">
                Allow backorder
              </DataGridHead>
              <DataGridHead className="w-32">Quantity</DataGridHead>
              {currencies.map((currency) => (
                <DataGridHead key={currency.code} className="min-w-[140px]">
                  Price {currency.code.toUpperCase()}
                </DataGridHead>
              ))}
            </DataGridRow>
          </DataGridHeader>
          <DataGridBody>
            {displayedVariants.map((variant) => (
              <DataGridRow key={variant.key}>
                <DataGridCell>
                  <DataGridReadonlyCell>
                    {variant.optionValues.join(" / ") || "Default"}
                  </DataGridReadonlyCell>
                </DataGridCell>
                <DataGridCell>
                  <DataGridInput
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
                </DataGridCell>
                <DataGridCell>
                  <DataGridInput
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
                </DataGridCell>
                <DataGridCell>
                  <DataGridBooleanCell>
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
                  </DataGridBooleanCell>
                </DataGridCell>
                <DataGridCell>
                  <DataGridBooleanCell>
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
                  </DataGridBooleanCell>
                </DataGridCell>
                <DataGridCell>
                  <DataGridInput
                    type="number"
                    min="0"
                    disabled={!variant.manageInventory}
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
                </DataGridCell>
                {currencies.map((currency) => (
                  <DataGridCell key={currency.code}>
                    <DataGridInput
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
                  </DataGridCell>
                ))}
              </DataGridRow>
            ))}
          </DataGridBody>
        </DataGrid>
      </div>
    </div>
  );
};
