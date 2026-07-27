import { OptionValuesField } from "@/components/form/option-values-field";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  normalizeProductOptionListParams,
  productOptionQueries,
} from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Dispatch } from "react";
import type { DraftAction, DraftOption } from "./use-product-draft";

/**
 * Options come from the shared library at /dashboard/products/options, so a
 * product picks existing options and narrows each to the values it sells.
 * Nothing here creates an option or a value: typing one would fork the library.
 */

const MAX_OPTIONS = 3;

export const OptionPicker = ({
  options,
  dispatch,
}: {
  options: DraftOption[];
  dispatch: Dispatch<DraftAction>;
}) => {
  const { data, isPending } = useQuery(
    productOptionQueries.list(normalizeProductOptionListParams()),
  );

  const library = data?.success ? (data.data?.options ?? []) : [];
  const chosenByOptionId = new Map(
    options.map((option) => [option.optionId, option]),
  );

  /** The field hands back the full selection, so add and remove are diffed. */
  const applyOptionIds = (optionIds: string[]) => {
    for (const option of options) {
      if (!optionIds.includes(option.optionId)) {
        dispatch({ type: "removeOption", key: option.key });
      }
    }
    for (const optionId of optionIds) {
      if (chosenByOptionId.has(optionId)) continue;
      const picked = library.find((option) => option.id === optionId);
      if (!picked) continue;
      dispatch({
        type: "addOption",
        option: {
          optionId: picked.id,
          title: picked.title,
          available: picked.values.map((value) => ({
            id: value.id,
            value: value.value,
          })),
          // Every value applies by default; unwanted ones are removed below.
          selectedValueIds: picked.values.map((value) => value.id),
        },
      });
    }
  };

  if (isPending) {
    return <Spinner className="size-4 text-muted-foreground" />;
  }

  if (library.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No options exist yet.{" "}
        <Link
          to="/dashboard/$parent/$slug"
          params={{ parent: "products", slug: "options" }}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Create one first
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <div className="space-y-1">
          <h3 className="font-medium text-foreground">Product options</h3>
          <p className="text-sm text-muted-foreground">
            Define the options for the product, e.g. color, size, etc.
          </p>
        </div>
        <OptionValuesField
          name="product-options"
          choices={library.map((option) => ({
            id: option.id,
            value: option.title,
          }))}
          selectedIds={options.map((option) => option.optionId)}
          onSelectionChange={applyOptionIds}
          maxSelected={MAX_OPTIONS}
          placeholder="Select options..."
          searchPlaceholder="Search options..."
          emptyMessage="No option found."
        />
      </div>

      {options.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="font-medium text-foreground">Values</h3>
            <p className="text-sm text-muted-foreground">
              Select which values to use for each option.
            </p>
          </div>

          {options.map((option) => (
            <div key={option.key} className="space-y-2">
              <Label htmlFor={`option-values-${option.key}`}>
                {option.title}
              </Label>
              <OptionValuesField
                name={`option-values-${option.key}`}
                choices={option.available}
                selectedIds={option.selectedValueIds}
                onSelectionChange={(valueIds) =>
                  dispatch({
                    type: "setOptionValues",
                    key: option.key,
                    valueIds,
                  })
                }
                placeholder={`Select ${option.title.toLowerCase()} values...`}
                searchPlaceholder="Search values..."
                emptyMessage="No value found."
              />
              {option.selectedValueIds.length === 0 && (
                <p className="text-sm text-destructive">
                  Select at least one value to generate variants.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
