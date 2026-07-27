import { FieldsRenderer } from "@/components/form/fields-renderer";
import { Spinner } from "@/components/ui/spinner";
import {
  normalizeProductOptionListParams,
  productOptionQueries,
} from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import type { Dispatch } from "react";
import type { DraftAction, DraftOption } from "./use-product-draft";

/**
 * Options come from the shared library at /dashboard/product-options, so a
 * product picks existing options and narrows each to the values it sells.
 * Nothing here creates an option or a value: typing one would fork the library.
 */

const MAX_OPTIONS = 3;

/** `FieldsRenderer` also emits `File[]`, which these fields never produce. */
const isStringArray = (value: FormFieldValue | File[]): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

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
          to="/dashboard/$slug"
          params={{ slug: "product-options" }}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Create one first
        </Link>
        .
      </p>
    );
  }

  // One field list rather than hand-placed labels: the per-option value pickers
  // are dynamic, and building them as `fields` keeps their labels, spacing and
  // error text identical to every other form in the wizard.
  const optionField: FormField = {
    type: "option-values",
    name: "product-options",
    label: "Product options",
    description: "Define the options for the product, e.g. color, size, etc.",
    choices: library.map((option) => ({
      id: option.id,
      value: option.title,
    })),
    value: options.map((option) => option.optionId),
    maxSelected: MAX_OPTIONS,
    placeholder: "Select options...",
    searchPlaceholder: "Search options...",
    emptyMessage: "No option found.",
    colSpan: 1,
  };

  const valueFields: FormField[] = options.map((option) => ({
    type: "option-values",
    name: `option-values-${option.key}`,
    label: option.title,
    choices: option.available,
    value: option.selectedValueIds,
    error:
      option.selectedValueIds.length === 0
        ? "Select at least one value to generate variants"
        : undefined,
    placeholder: `Select ${option.title.toLowerCase()} values...`,
    searchPlaceholder: "Search values...",
    emptyMessage: "No value found.",
    colSpan: 1,
  }));

  const handleChange = (name: string, value: FormFieldValue | File[]) => {
    if (!isStringArray(value)) return;

    if (name === "product-options") {
      applyOptionIds(value);
      return;
    }

    const option = options.find(
      (candidate) => `option-values-${candidate.key}` === name,
    );
    if (option) {
      dispatch({ type: "setOptionValues", key: option.key, valueIds: value });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <FieldsRenderer
        fields={[optionField]}
        className="grid-cols-1"
        onChange={handleChange}
      />

      {valueFields.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="font-medium text-foreground">Values</h3>
            <p className="text-sm text-muted-foreground">
              Select which values to use for each option.
            </p>
          </div>

          <FieldsRenderer
            fields={valueFields}
            className="grid-cols-1 gap-y-6"
            onChange={handleChange}
          />
        </div>
      )}
    </div>
  );
};
