import { z } from "zod";
import { idSchema, idsSchema, listParamsSchema } from "./commerce";
import { metadataInputSchema } from "./product";

const countryCode = z
  .string()
  .trim()
  .length(2)
  .transform((value) => value.toLowerCase());
const provinceCode = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform((value) => value.toUpperCase());

export const taxRateRuleReferenceSchema = z.enum([
  "product",
  "product_type",
  "shipping_option",
]);
const taxRateRuleSchema = z.object({
  reference: taxRateRuleReferenceSchema,
  referenceId: idSchema("tax rule target"),
});

export const listTaxRegionsInputSchema = listParamsSchema(
  ["name", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);
export const listTaxProvincesInputSchema = listParamsSchema(
  ["code", "createdAt", "updatedAt"],
  { sortBy: "code", limit: 10 },
).extend({
  parentId: idSchema("tax region"),
  hasRates: z.enum(["yes", "no"]).optional(),
});
export const listTaxRatesInputSchema = listParamsSchema(
  ["name", "createdAt", "updatedAt"],
  { sortBy: "createdAt", limit: 10 },
).extend({
  taxRegionId: idSchema("tax region"),
  kind: z.enum(["default", "override"]),
});
export const listTaxRuleTargetsInputSchema = z.object({
  reference: taxRateRuleReferenceSchema,
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const getTaxRegionInputSchema = z.object({ id: idSchema("tax region") });
const defaultTaxRateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(100),
    rate: z.coerce.number().min(0).max(100).nullable(),
    isCombinable: z.boolean().default(false),
  })
  .optional();
export const createTaxRegionInputSchema = z.object({
  countryCode,
  providerId: z.string().trim().min(1).max(200).default("tp_system"),
  defaultTaxRate: defaultTaxRateSchema,
});
export const createTaxProvinceInputSchema = z.object({
  parentId: idSchema("tax region"),
  provinceCode,
  defaultTaxRate: defaultTaxRateSchema,
});
export const updateTaxRegionInputSchema = z.object({
  id: idSchema("tax region"),
  providerId: z.string().trim().min(1).max(200).nullable().optional(),
  metadata: metadataInputSchema.optional(),
});
export const deleteTaxRegionsInputSchema = idsSchema("tax region");

const taxRateInputShape = z.object({
  taxRegionId: idSchema("tax region"),
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(100),
  rate: z.coerce.number().min(0).max(100).nullable(),
  isDefault: z.boolean().default(false),
  isCombinable: z.boolean().default(false),
  rules: z.array(taxRateRuleSchema).max(500).default([]),
});

const validateTaxRateRules = (
  value: {
    isDefault?: boolean;
    rules?: Array<z.infer<typeof taxRateRuleSchema>>;
  },
  context: z.RefinementCtx,
) => {
  if (value.isDefault && value.rules?.length) {
    context.addIssue({
      code: "custom",
      path: ["rules"],
      message: "A default tax rate cannot have target rules",
    });
  }
  if (value.isDefault === false && !value.rules?.length) {
    context.addIssue({
      code: "custom",
      path: ["rules"],
      message:
        "An override must target a product, product type, or shipping option",
    });
  }
};

export const createTaxRateInputSchema =
  taxRateInputShape.superRefine(validateTaxRateRules);
export const updateTaxRateInputSchema = taxRateInputShape
  .partial()
  .extend({
    id: idSchema("tax rate"),
    taxRegionId: idSchema("tax region"),
    metadata: metadataInputSchema.optional(),
  })
  .superRefine(validateTaxRateRules);
export const deleteTaxRatesInputSchema = idsSchema("tax rate");
export const getTaxRateInputSchema = z.object({ id: idSchema("tax rate") });
