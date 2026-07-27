import { z } from "zod";

export const currencyCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{3}$/, "Currency code must be three lowercase letters");

export const listCurrenciesInputSchema = z
  .object({
    query: z.string().trim().max(100).optional(),
  })
  .default({});

export const addStoreCurrenciesInputSchema = z.object({
  codes: z.array(currencyCodeSchema).min(1).max(100),
  taxInclusiveCodes: z.array(currencyCodeSchema).max(100).default([]),
});

export const storeCurrencyCodeInputSchema = z.object({
  code: currencyCodeSchema,
});

export const removeStoreCurrenciesInputSchema = z.object({
  codes: z.array(currencyCodeSchema).min(1).max(100),
});

export const updateStoreCurrencyInputSchema =
  storeCurrencyCodeInputSchema.extend({
    isTaxInclusive: z.boolean(),
  });

export const updateStoreGeneralInputSchema = z.object({
  name: z.string().trim().min(1, "Store name is required").max(100),
  defaultCurrencyCode: currencyCodeSchema,
});
