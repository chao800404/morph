import type { ProductOptionDTO } from "./dto/product-option.dto";
import { MAX_GENERATED_VARIANTS } from "./variant-limits";
import type { ProductVariantDTO } from "./dto/product-variant.dto";

/**
 * Turning a product's variants into table rows.
 *
 * Pure, and separate from the card, because all three steps have off-by-one or
 * empty-input edges worth testing: a variant carries `optionValueIds` with no
 * indication of which option each id belongs to, and the list is paged in the
 * browser rather than by the server — `findDetail` already returns every
 * variant, so a second round trip per page would fetch data we hold.
 */

/** Rows per page, matching Medusa's variants table. */
export const VARIANT_PAGE_SIZE = 10;

/**
 * The value this variant takes on one option axis.
 *
 * `optionValueIds` is a flat list, so the option's own values are what identify
 * which entry belongs to it. Returns null when the variant predates the option,
 * which is possible because options can be added to a product later.
 */
export const variantOptionValue = (
  variant: ProductVariantDTO,
  option: ProductOptionDTO,
): string | null => {
  const owned = new Set(variant.optionValueIds);
  return option.values.find((value) => owned.has(value.id))?.value ?? null;
};

/** Case-insensitive match on the columns a reader can see. */
export const filterVariants = (
  variants: ProductVariantDTO[],
  query: string | undefined,
  options: ProductOptionDTO[],
): ProductVariantDTO[] => {
  const term = query?.trim().toLowerCase();
  if (!term) return variants;

  return variants.filter((variant) => {
    const haystack = [
      variant.title,
      variant.sku ?? "",
      ...options.map((option) => variantOptionValue(variant, option) ?? ""),
    ];
    return haystack.some((value) => value.toLowerCase().includes(term));
  });
};

/**
 * The orderings the variants table offers, in `DashboardSortKey` terms.
 *
 * `option:<id>` is one of the product's own axes. It has to be a template
 * string rather than a fixed union because which axes exist is a property of
 * the product, not of the table.
 */
export type VariantSortKey =
  | "name"
  | "createdAt"
  | "updatedAt"
  | `option:${string}`;

const OPTION_PREFIX = "option:";

export const optionSortKey = (optionId: string): VariantSortKey =>
  `${OPTION_PREFIX}${optionId}`;

/** The option id inside an `option:<id>` key, or null for the fixed keys. */
export const optionIdFromSortKey = (sortBy: string): string | null =>
  sortBy.startsWith(OPTION_PREFIX)
    ? sortBy.slice(OPTION_PREFIX.length) || null
    : null;

/**
 * Narrow a `?sortBy` to something this table can actually apply.
 *
 * An `option:` key is only valid while that axis is still on the product —
 * a bookmarked URL outlives the option it names, and silently sorting by
 * nothing would look like the control is broken.
 */
export const toVariantSortKey = (
  value: unknown,
  options: ProductOptionDTO[],
  fallback: VariantSortKey = "createdAt",
): VariantSortKey => {
  if (value === "name" || value === "createdAt" || value === "updatedAt") {
    return value;
  }
  if (typeof value !== "string") return fallback;

  const optionId = optionIdFromSortKey(value);
  return optionId && options.some((option) => option.id === optionId)
    ? optionSortKey(optionId)
    : fallback;
};

/**
 * Where a variant sits on one axis, as the author ordered that axis.
 *
 * Rank, not the value's text. The values of a Size option read s, m, l, x, xl;
 * sorting them as strings gives l, m, s, x, xl, which is not an order anyone
 * asked for. `rank` is exactly the sequence the author arranged in the option
 * library, and it is what the Options card already displays.
 *
 * Null when the variant predates the axis — possible because an option can be
 * added to a product that already has variants.
 */
const optionRank = (
  variant: ProductVariantDTO,
  ranks: Map<string, number>,
): number | null => {
  for (const id of variant.optionValueIds) {
    const rank = ranks.get(id);
    if (rank !== undefined) return rank;
  }
  return null;
};

/**
 * Order the rows.
 *
 * "name" sorts on the title, which is what the column is called; the shared
 * sort control's key vocabulary is fixed across the dashboard, so the table
 * maps rather than inventing a key. Titles compare with `localeCompare` so
 * "S / Black" and "s / black" land together.
 *
 * `options` is only read for an `option:` key, and is optional so the existing
 * callers that sort by title or date need not pass it.
 */
export const sortVariants = (
  variants: ProductVariantDTO[],
  sortBy: VariantSortKey,
  sortOrder: "asc" | "desc",
  options: ProductOptionDTO[] = [],
): ProductVariantDTO[] => {
  const direction = sortOrder === "asc" ? 1 : -1;
  const optionId = optionIdFromSortKey(sortBy);

  if (optionId) {
    const option = options.find((candidate) => candidate.id === optionId);
    // The axis is gone. Leaving the order untouched beats inventing one.
    if (!option) return [...variants];

    const ranks = new Map(
      option.values.map((value) => [value.id, value.rank] as const),
    );

    return [...variants].sort((a, b) => {
      const left = optionRank(a, ranks);
      const right = optionRank(b, ranks);
      // Variants with no value on this axis go last in *both* directions.
      // Folding them in with the direction would hide them at the top on one
      // click, and they are the rows most likely to need attention.
      if (left === null || right === null) {
        return left === right ? 0 : left === null ? 1 : -1;
      }
      return (left - right) * direction;
    });
  }

  return [...variants].sort((a, b) => {
    if (sortBy === "name") return a.title.localeCompare(b.title) * direction;
    const left = new Date(sortBy === "createdAt" ? a.createdAt : a.updatedAt);
    const right = new Date(sortBy === "createdAt" ? b.createdAt : b.updatedAt);
    return (left.getTime() - right.getTime()) * direction;
  });
};

/**
 * One page of rows, plus the footer's counts.
 *
 * A page beyond the end is clamped rather than left empty: the term can narrow
 * the list while `?page` still points at page 3.
 */
export const paginateVariants = (
  variants: ProductVariantDTO[],
  page: number,
  limit: number = VARIANT_PAGE_SIZE,
): {
  rows: ProductVariantDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
} => {
  const total = variants.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (current - 1) * limit;

  return {
    rows: variants.slice(start, start + limit),
    pagination: { page: current, limit, total, totalPages },
  };
};

export interface VariantCombination {
  /** Stable identity for a cell: its value ids, in option order. */
  key: string;
  /** What the generated variant is called, matching the create wizard. */
  title: string;
  valueIds: string[];
}

/**
 * The cells of the matrix that have no variant yet.
 *
 * Adding an option axis to a product multiplies the matrix, and the variants
 * that already exist only cover the old one. This is what fills the rest —
 * which is why it returns whole combinations rather than a count.
 *
 * Combinations are compared as sets: a variant stores its value ids without
 * recording which axis each came from, so ordering them would be guesswork.
 */
export const missingCombinations = (
  options: ProductOptionDTO[],
  variants: ProductVariantDTO[],
  limit: number = MAX_GENERATED_VARIANTS,
): VariantCombination[] => {
  const axes = options.filter((option) => option.values.length > 0);
  if (axes.length === 0) return [];

  let combinations: Array<Array<{ id: string; value: string }>> = [[]];
  for (const axis of axes) {
    combinations = combinations.flatMap((combination) =>
      axis.values.map((value) => [
        ...combination,
        { id: value.id, value: value.value },
      ]),
    );
    // Bail before the product of the axes becomes unusable rather than after.
    if (combinations.length > limit) return [];
  }

  const taken = variants.map((variant) => new Set(variant.optionValueIds));

  return combinations
    .filter(
      (combination) =>
        !taken.some(
          (ids) =>
            ids.size === combination.length &&
            combination.every((value) => ids.has(value.id)),
        ),
    )
    .map((combination) => ({
      key: combination.map((value) => value.id).join("|"),
      title: combination.map((value) => value.value).join(" / "),
      valueIds: combination.map((value) => value.id),
    }));
};

/**
 * The variants that would be lost by detaching these option axes.
 *
 * Removing an axis collapses the matrix — with Size gone, `12cm / red / s` and
 * `12cm / red / m` both become `12cm / red` — and there is no right answer for
 * which one keeps its price, stock and SKU. So they go, and this is what the
 * confirmation counts.
 */
export const variantsUsingOptions = (
  options: ProductOptionDTO[],
  variants: ProductVariantDTO[],
  removedOptionIds: string[],
): ProductVariantDTO[] => {
  const removed = new Set(removedOptionIds);
  const owned = new Set(
    options
      .filter((option) => removed.has(option.id))
      .flatMap((option) => option.values.map((value) => value.id)),
  );
  if (owned.size === 0) return [];

  return variants.filter((variant) =>
    variant.optionValueIds.some((id) => owned.has(id)),
  );
};
