import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { taxDal } from "@/lib/tax/dal/tax.dal";
import { taxWriteService } from "@/lib/tax/service/tax-write.service";
import { taxProviderRegistry } from "@/lib/tax/providers/tax-provider-registry.server";
import { getConfig } from "@/server/get-config";
import {
  createTaxProvinceInputSchema,
  createTaxRateInputSchema,
  createTaxRegionInputSchema,
  deleteTaxRatesInputSchema,
  deleteTaxRegionsInputSchema,
  getTaxRateInputSchema,
  getTaxRegionInputSchema,
  listTaxRegionsInputSchema,
  listTaxProvincesInputSchema,
  listTaxRatesInputSchema,
  listTaxRuleTargetsInputSchema,
  updateTaxRateInputSchema,
  updateTaxRegionInputSchema,
} from "@/lib/validations/tax";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listTaxRegions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listTaxRegionsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await taxDal.listPage(data);
      return ok("Tax regions fetched successfully", {
        taxRegions: page.taxRegions,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List tax regions error",
        error,
        "LIST_FAILED",
        "Failed to fetch tax regions",
      );
    }
  });

export const listTaxProvinces = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listTaxProvincesInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await taxDal.listProvincePage(data);
      return ok("Tax sub-regions fetched successfully", {
        taxRegions: page.taxRegions,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List tax sub-regions error",
        error,
        "LIST_FAILED",
        "Failed to fetch tax sub-regions",
      );
    }
  });

export const listTaxRates = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listTaxRatesInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await taxDal.listRatePage(data);
      return ok("Tax rates fetched successfully", {
        taxRates: page.taxRates,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List tax rates error",
        error,
        "LIST_FAILED",
        "Failed to fetch tax rates",
      );
    }
  });

export const listTaxRuleTargets = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listTaxRuleTargetsInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await taxDal.listRuleTargetPage(data);
      return ok("Tax rule targets fetched successfully", {
        items: page.items,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List tax rule targets error",
        error,
        "LIST_FAILED",
        "Failed to fetch tax rule targets",
      );
    }
  });

export const getTaxRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getTaxRegionInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const region = await taxDal.findDetail(data.id);
      return region
        ? ok("Tax region fetched successfully", region)
        : fail("Tax region not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get tax region error",
        error,
        "GET_FAILED",
        "Failed to fetch tax region",
      );
    }
  });

export const getTaxRate = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getTaxRateInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const rate = await taxDal.findRate(data.id);
      return rate
        ? ok("Tax rate fetched successfully", rate)
        : fail("Tax rate not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get tax rate error",
        error,
        "GET_FAILED",
        "Failed to fetch tax rate",
      );
    }
  });

export const listTaxRegionOptions = createServerFn({ method: "GET" })
  .middleware([commerceReadMiddleware])
  .handler(async () => {
    try {
      getConfig();
      await taxDal.ensureProviders(taxProviderRegistry.list());
      return ok("Tax options fetched successfully", {
        countries: await taxDal.listAvailableCountries(),
        providers: await taxDal.listProviders(),
      });
    } catch (error) {
      return failure(
        "List tax options error",
        error,
        "LIST_FAILED",
        "Failed to fetch tax options",
      );
    }
  });

export const createTaxRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createTaxRegionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.createRegion(data, context.user.id);
      return result.success
        ? ok("Tax region created successfully", result.data)
        : fail(result.message, {
            error: result.error,
            ...(result.errors ? { errors: result.errors } : {}),
          });
    } catch (error) {
      return failure(
        "Create tax region error",
        error,
        "CREATE_FAILED",
        "Failed to create tax region",
      );
    }
  });

export const createTaxProvince = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createTaxProvinceInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.createProvince(
        data,
        context.user.id,
      );
      return result.success
        ? ok("Province tax region created successfully", result.data)
        : fail(result.message, {
            error: result.error,
            ...(result.errors ? { errors: result.errors } : {}),
          });
    } catch (error) {
      return failure(
        "Create province tax region error",
        error,
        "CREATE_FAILED",
        "Failed to create province tax region",
      );
    }
  });

export const updateTaxRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateTaxRegionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.updateRegion(data);
      return result.success
        ? ok("Tax region updated successfully", result.data)
        : fail(result.message, {
            error: result.error,
            ...(result.errors ? { errors: result.errors } : {}),
          });
    } catch (error) {
      return failure(
        "Update tax region error",
        error,
        "UPDATE_FAILED",
        "Failed to update tax region",
      );
    }
  });

export const deleteTaxRegions = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteTaxRegionsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.deleteRegions(data.ids);
      if (!result.success) return fail(result.message, { error: result.error });
      return ok(
        `${result.data.deleted} tax region${result.data.deleted === 1 ? "" : "s"} deleted`,
        result.data,
      );
    } catch (error) {
      return failure(
        "Delete tax regions error",
        error,
        "DELETE_FAILED",
        "Failed to delete tax regions",
      );
    }
  });

export const createTaxRate = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createTaxRateInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.createRate(data, context.user.id);
      return result.success
        ? ok("Tax rate created successfully", result.data)
        : fail(result.message, {
            error: result.error,
            ...(result.errors ? { errors: result.errors } : {}),
          });
    } catch (error) {
      return failure(
        "Create tax rate error",
        error,
        "CREATE_FAILED",
        "Failed to create tax rate",
      );
    }
  });

export const updateTaxRate = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateTaxRateInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.updateRate(data);
      return result.success
        ? ok("Tax rate updated successfully", result.data)
        : fail(result.message, {
            error: result.error,
            ...(result.errors ? { errors: result.errors } : {}),
          });
    } catch (error) {
      return failure(
        "Update tax rate error",
        error,
        "UPDATE_FAILED",
        "Failed to update tax rate",
      );
    }
  });

export const deleteTaxRates = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteTaxRatesInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await taxWriteService.deleteRates(data.ids);
      if (!result.success) return fail(result.message, { error: result.error });
      return ok(
        `${result.data.deleted} tax rate${result.data.deleted === 1 ? "" : "s"} deleted`,
        result.data,
      );
    } catch (error) {
      return failure(
        "Delete tax rates error",
        error,
        "DELETE_FAILED",
        "Failed to delete tax rates",
      );
    }
  });
