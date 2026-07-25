import { useReducer } from "react";

/**
 * Draft state for the multi-step product creation flow.
 *
 * This is local, short-lived state serving one subtree, so it stays in a
 * reducer rather than a store: nothing outside the wizard reads it, and it is
 * discarded when the route unmounts.
 */

export interface DraftOption {
  /** Stable key so React rows survive renaming. */
  key: string;
  title: string;
  values: string[];
}

export interface DraftVariant {
  /** `optionValues` joined, used as the row identity. */
  key: string;
  /** One value per option axis, in option order. */
  optionValues: string[];
  included: boolean;
  title: string;
  sku: string;
  manageInventory: boolean;
  allowBackorder: boolean;
  inventoryQuantity: string;
  /** Major units as typed; converted to minor units on submit. */
  prices: Record<string, string>;
}

export interface ProductDraft {
  title: string;
  subtitle: string;
  handle: string;
  description: string;
  collectionId: string;
  hasVariants: boolean;
  options: DraftOption[];
  currencies: string[];
  variants: DraftVariant[];
  /** Prices for the single default variant when `hasVariants` is false. */
  defaultPrices: Record<string, string>;
}

export type DraftAction =
  | { type: "setField"; field: "title" | "subtitle" | "handle" | "description" | "collectionId"; value: string }
  | { type: "setHasVariants"; value: boolean }
  | { type: "addOption" }
  | { type: "removeOption"; key: string }
  | { type: "setOptionTitle"; key: string; title: string }
  | { type: "setOptionValues"; key: string; values: string[] }
  | { type: "setCurrencies"; currencies: string[] }
  | { type: "toggleVariant"; key: string; included: boolean }
  | { type: "toggleAllVariants"; included: boolean }
  | {
      type: "setVariantField";
      key: string;
      field: "title" | "sku" | "inventoryQuantity";
      value: string;
    }
  | {
      type: "setVariantFlag";
      key: string;
      field: "manageInventory" | "allowBackorder";
      value: boolean;
    }
  | { type: "setVariantPrice"; key: string; currency: string; value: string }
  | { type: "setDefaultPrice"; currency: string; value: string };

export const buildVariantKey = (optionValues: string[]): string =>
  optionValues.join(" / ");

/** Cartesian product of the option values, in option order. */
const buildCombinations = (options: DraftOption[]): string[][] =>
  options
    .filter((option) => option.title.trim() !== "" && option.values.length > 0)
    .reduce<string[][]>(
      (combinations, option) =>
        combinations.flatMap((combination) =>
          option.values.map((value) => [...combination, value]),
        ),
      [[]],
    );

/**
 * Recompute the variant rows after the options change, keeping whatever the
 * user already typed for combinations that still exist.
 */
const syncVariants = (draft: ProductDraft): ProductDraft => {
  if (!draft.hasVariants) return { ...draft, variants: [] };

  const combinations = buildCombinations(draft.options);
  if (combinations.length === 1 && combinations[0].length === 0) {
    return { ...draft, variants: [] };
  }

  const previous = new Map(draft.variants.map((variant) => [variant.key, variant]));

  return {
    ...draft,
    variants: combinations.map((optionValues) => {
      const key = buildVariantKey(optionValues);
      const existing = previous.get(key);
      if (existing) return existing;
      return {
        key,
        optionValues,
        included: true,
        title: key,
        sku: "",
        manageInventory: true,
        allowBackorder: false,
        inventoryQuantity: "0",
        prices: {},
      };
    }),
  };
};

const mapVariant = (
  draft: ProductDraft,
  key: string,
  update: (variant: DraftVariant) => DraftVariant,
): ProductDraft => ({
  ...draft,
  variants: draft.variants.map((variant) =>
    variant.key === key ? update(variant) : variant,
  ),
});

const reducer = (draft: ProductDraft, action: DraftAction): ProductDraft => {
  switch (action.type) {
    case "setField":
      return { ...draft, [action.field]: action.value };

    case "setHasVariants":
      return syncVariants({
        ...draft,
        hasVariants: action.value,
        options:
          action.value && draft.options.length === 0
            ? [{ key: crypto.randomUUID(), title: "", values: [] }]
            : draft.options,
      });

    case "addOption":
      return syncVariants({
        ...draft,
        options: [
          ...draft.options,
          { key: crypto.randomUUID(), title: "", values: [] },
        ],
      });

    case "removeOption":
      return syncVariants({
        ...draft,
        options: draft.options.filter((option) => option.key !== action.key),
      });

    case "setOptionTitle":
      return syncVariants({
        ...draft,
        options: draft.options.map((option) =>
          option.key === action.key
            ? { ...option, title: action.title }
            : option,
        ),
      });

    case "setOptionValues":
      return syncVariants({
        ...draft,
        options: draft.options.map((option) =>
          option.key === action.key
            ? { ...option, values: action.values }
            : option,
        ),
      });

    case "setCurrencies":
      return { ...draft, currencies: action.currencies };

    case "toggleVariant":
      return mapVariant(draft, action.key, (variant) => ({
        ...variant,
        included: action.included,
      }));

    case "toggleAllVariants":
      return {
        ...draft,
        variants: draft.variants.map((variant) => ({
          ...variant,
          included: action.included,
        })),
      };

    case "setVariantField":
      return mapVariant(draft, action.key, (variant) => ({
        ...variant,
        [action.field]: action.value,
      }));

    case "setVariantFlag":
      return mapVariant(draft, action.key, (variant) => ({
        ...variant,
        [action.field]: action.value,
      }));

    case "setVariantPrice":
      return mapVariant(draft, action.key, (variant) => ({
        ...variant,
        prices: { ...variant.prices, [action.currency]: action.value },
      }));

    case "setDefaultPrice":
      return {
        ...draft,
        defaultPrices: {
          ...draft.defaultPrices,
          [action.currency]: action.value,
        },
      };
  }
};

const initialDraft: ProductDraft = {
  title: "",
  subtitle: "",
  handle: "",
  description: "",
  collectionId: "",
  hasVariants: false,
  options: [],
  currencies: ["twd"],
  variants: [],
  defaultPrices: {},
};

export const useProductDraft = () => useReducer(reducer, initialDraft);

/** Major units as typed, to the integer minor units the API stores. */
export const toMinorUnits = (value: string): number => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};
