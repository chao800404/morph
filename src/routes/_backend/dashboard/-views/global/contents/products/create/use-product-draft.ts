import { useReducer } from "react";

/**
 * Draft state for the multi-step product creation flow.
 *
 * This is local, short-lived state serving one subtree, so it stays in a
 * reducer rather than a store: nothing outside the wizard reads it, and it is
 * discarded when the route unmounts.
 */

export interface DraftOptionValue {
  id: string;
  value: string;
}

/**
 * An option the product will use, picked from the shared library.
 *
 * `available` is everything the library option offers; `selectedValueIds` is
 * the subset this product sells. The variant matrix is built from the
 * selection, not from the full list.
 */
export interface DraftOption {
  /** Stable key so React rows survive reordering. */
  key: string;
  optionId: string;
  title: string;
  available: DraftOptionValue[];
  selectedValueIds: string[];
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
  /** Type and tags are values, not ids: a new one is created on submit. */
  typeValue: string;
  tagValues: string[];
  categoryIds: string[];
  discountable: boolean;
  hasVariants: boolean;
  options: DraftOption[];
  currencies: string[];
  variants: DraftVariant[];
  /** Prices for the single default variant when `hasVariants` is false. */
  defaultPrices: Record<string, string>;
}

export type DraftAction =
  | {
      type: "setField";
      field:
        | "title"
        | "subtitle"
        | "handle"
        | "description"
        | "collectionId"
        | "typeValue";
      value: string;
    }
  | { type: "setTagValues"; values: string[] }
  | { type: "setCategoryIds"; ids: string[] }
  | { type: "setDiscountable"; value: boolean }
  | { type: "setHasVariants"; value: boolean }
  | { type: "addOption"; option: Omit<DraftOption, "key"> }
  | { type: "removeOption"; key: string }
  | { type: "setOptionValues"; key: string; valueIds: string[] }
  | { type: "setCurrencies"; currencies: string[] }
  | { type: "toggleVariant"; key: string; included: boolean }
  | { type: "toggleAllVariants"; included: boolean }
  | { type: "moveVariant"; key: string; beforeKey: string }
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
export const selectedValuesOf = (option: DraftOption): string[] =>
  option.available
    .filter((value) => option.selectedValueIds.includes(value.id))
    .map((value) => value.value);

const buildCombinations = (options: DraftOption[]): string[][] =>
  options
    .map(selectedValuesOf)
    .filter((values) => values.length > 0)
    .reduce<string[][]>(
      (combinations, values) =>
        combinations.flatMap((combination) =>
          values.map((value) => [...combination, value]),
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

  // Rebuilding resets a manual reorder: the combinations changed, so there is
  // no meaningful order to carry over.
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
      return syncVariants({ ...draft, hasVariants: action.value });

    case "addOption":
      // Adding the same library option twice would duplicate an axis.
      if (draft.options.some((o) => o.optionId === action.option.optionId)) {
        return draft;
      }
      return syncVariants({
        ...draft,
        options: [
          ...draft.options,
          { key: crypto.randomUUID(), ...action.option },
        ],
      });

    case "removeOption":
      return syncVariants({
        ...draft,
        options: draft.options.filter((option) => option.key !== action.key),
      });

    case "setOptionValues":
      return syncVariants({
        ...draft,
        options: draft.options.map((option) =>
          option.key === action.key
            ? { ...option, selectedValueIds: action.valueIds }
            : option,
        ),
      });

    case "setTagValues":
      return { ...draft, tagValues: action.values };

    case "setCategoryIds":
      return { ...draft, categoryIds: action.ids };

    case "setDiscountable":
      return { ...draft, discountable: action.value };

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

    // Rank is the storefront's display order, so the list itself is the input.
    case "moveVariant": {
      const from = draft.variants.findIndex((v) => v.key === action.key);
      const to = draft.variants.findIndex((v) => v.key === action.beforeKey);
      if (from === -1 || to === -1 || from === to) return draft;

      const variants = [...draft.variants];
      const [moved] = variants.splice(from, 1);
      variants.splice(to, 0, moved);
      return { ...draft, variants };
    }

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
  typeValue: "",
  tagValues: [],
  categoryIds: [],
  discountable: true,
  hasVariants: false,
  options: [],
  currencies: [],
  variants: [],
  defaultPrices: {},
};

export const useProductDraft = (currencies: string[]) =>
  useReducer(reducer, { ...initialDraft, currencies });
