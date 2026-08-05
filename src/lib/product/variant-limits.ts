/**
 * How many variants one product may hold.
 *
 * The matrix is the product of every axis's values, so this is the number that
 * stops three modest options from generating thousands of D1 rows. Shared by
 * the create wizard's generator and the "fill the missing cells" page.
 */
export const MAX_GENERATED_VARIANTS = 200;
