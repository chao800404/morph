export const PRODUCT_OPTION_CREATED_WITHIN_VALUES = [
  "7d",
  "30d",
  "90d",
] as const;

export type ProductOptionCreatedWithin =
  (typeof PRODUCT_OPTION_CREATED_WITHIN_VALUES)[number];

export const getProductOptionCreatedWithinDays = (
  value: ProductOptionCreatedWithin,
): number => Number.parseInt(value, 10);
