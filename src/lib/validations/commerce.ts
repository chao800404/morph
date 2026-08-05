import { z } from "zod";

/**
 * Input schemas shared by the commerce modules.
 *
 * Same contract as `validations/product.ts`: server functions treat their input
 * as `unknown` and parse it here, and actor fields (`createdBy` / `updatedBy`)
 * are deliberately absent — they come from the verified session, never from the
 * client.
 *
 * These exist because every list endpoint takes the same five parameters and
 * every delete takes the same one. Repeating them per resource is where the
 * limits drift apart, and the limits are load-bearing: `limit` caps one D1
 * page and `ids` caps one bulk write.
 */

/** A page of a list. `sortBy` differs per resource, so it is passed in. */
export const listParamsSchema = <const TSort extends readonly [string, ...string[]]>(
  sortBy: TSort,
  defaults: { sortBy: TSort[number]; limit?: number } = {
    sortBy: sortBy[0],
  },
) =>
  z.object({
    query: z.string().trim().max(200).nullish(),
    sortBy: z.enum(sortBy).default(defaults.sortBy),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).max(10_000).default(1),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(defaults.limit ?? 20),
  });

export const idSchema = (label: string) => z.uuid(`Invalid ${label} ID`);

/** Bulk selection. Capped at 100 — see rules.md on batch limits. */
export const idsSchema = (label: string) =>
  z.object({
    ids: z
      .array(idSchema(label))
      .min(1, `Select at least one ${label}`)
      .max(100),
  });

/** ISO 3166-1 alpha-2, stored lowercase so comparisons never need `lower()`. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .length(2, "Country code must be 2 letters")
  .regex(/^[a-z]{2}$/, "Country code must be 2 letters");

/**
 * A postal address, as every module that captures one defines it.
 *
 * Nullable throughout except the country: an address is entered over several
 * steps and a half-filled one still has to save, but a country is what decides
 * tax and shipping, so it is the one field a stored address cannot omit.
 */
export const addressInputSchema = z.object({
  company: z.string().trim().max(200).nullish(),
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  address1: z.string().trim().max(300).nullish(),
  address2: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(120).nullish(),
  countryCode: countryCodeSchema,
  province: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().max(40).nullish(),
  phone: z.string().trim().max(40).nullish(),
});
