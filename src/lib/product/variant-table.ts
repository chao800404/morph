import type { ProductOptionDTO } from "./dto/product-option.dto";
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

/** The orderings the variants table offers, in `DashboardSortKey` terms. */
export type VariantSortKey = "name" | "createdAt" | "updatedAt";

/**
 * Order the rows.
 *
 * "name" sorts on the title, which is what the column is called; the shared
 * sort control's key vocabulary is fixed across the dashboard, so the table
 * maps rather than inventing a key. Titles compare with `localeCompare` so
 * "S / Black" and "s / black" land together.
 */
export const sortVariants = (
  variants: ProductVariantDTO[],
  sortBy: VariantSortKey,
  sortOrder: "asc" | "desc",
): ProductVariantDTO[] => {
  const direction = sortOrder === "asc" ? 1 : -1;

  return [...variants].sort((a, b) => {
    if (sortBy === "name") return a.title.localeCompare(b.title) * direction;
    const left = new Date(a[sortBy]).getTime();
    const right = new Date(b[sortBy]).getTime();
    return (left - right) * direction;
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
