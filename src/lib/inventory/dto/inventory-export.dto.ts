import { z } from "zod";

const textFilter = z.string().trim().min(1).max(200);
const textFilters = z.array(textFilter).min(1).max(100);
const idFilter = z.uuid();
const idFilters = z.array(idFilter).min(1).max(100);

export const inventoryExportFiltersSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    ids: idFilters.optional(),
    skus: textFilters.optional(),
    originCountries: textFilters.optional(),
    midCodes: textFilters.optional(),
    hsCodes: textFilters.optional(),
    materials: textFilters.optional(),
    requiresShipping: z.boolean().optional(),
    locationIds: idFilters.optional(),
    withDeleted: z.boolean().optional(),
    sortBy: z.enum([
      "name",
      "createdAt",
      "updatedAt",
      "sku",
      "originCountry",
      "midCode",
      "hsCode",
      "material",
    ]),
    sortOrder: z.enum(["asc", "desc"]),
  })
  .strict();

export type InventoryExportFilters = z.infer<
  typeof inventoryExportFiltersSchema
>;
