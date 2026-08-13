import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { taxDal } from "@/lib/tax/dal/tax.dal";
import {
  createTaxProvinceInputSchema,
  createTaxRateInputSchema,
  createTaxRegionInputSchema,
  deleteTaxRatesInputSchema,
  deleteTaxRegionsInputSchema,
  getTaxRateInputSchema,
  getTaxRegionInputSchema,
  listTaxRegionsInputSchema,
  updateTaxRateInputSchema,
  updateTaxRegionInputSchema,
} from "@/lib/validations/tax";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listTaxRegions = createServerFn({ method: "POST" })
  .validator((data: unknown) => listTaxRegionsInputSchema.parse(data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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

export const getTaxRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => getTaxRegionInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => getTaxRateInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
      await taxDal.ensureSystemProvider();
      return ok("Tax options fetched successfully", {
        countries: await taxDal.listAvailableCountries(),
        providers: await taxDal.listProviders(),
        ruleTargets: await taxDal.listRuleTargets(),
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
  .validator((data: unknown) => createTaxRegionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      await taxDal.ensureSystemProvider();
      const available = new Set(
        (await taxDal.listAvailableCountries()).map((country) => country.code),
      );
      if (!available.has(data.countryCode))
        return fail("A tax region already exists for this country", {
          errors: { countryCode: ["Select a country without a tax region"] },
        });
      const providers = new Set(
        (await taxDal.listProviders()).map((provider) => provider.id),
      );
      if (!providers.has(data.providerId))
        return fail("Tax provider is unavailable", {
          errors: { providerId: ["Select an enabled provider"] },
        });
      const id = crypto.randomUUID();
      await taxDal.createRegion({
        id,
        countryCode: data.countryCode,
        providerId: data.providerId,
        createdBy: context.user.id,
        defaultTaxRate: data.defaultTaxRate,
      });
      return ok("Tax region created successfully", { id });
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
  .validator((data: unknown) => createTaxProvinceInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const parent = await taxDal.findRegion(data.parentId);
      if (!parent || parent.parentId)
        return fail("Parent tax region not found", { error: "NOT_FOUND" });
      const detail = await taxDal.findDetail(parent.id);
      if (
        detail?.provinces.some(
          (province) => province.provinceCode === data.provinceCode,
        )
      )
        return fail("This province tax region already exists", {
          errors: { provinceCode: ["Province code must be unique"] },
        });
      const id = crypto.randomUUID();
      await taxDal.createRegion({
        id,
        countryCode: parent.countryCode,
        provinceCode: data.provinceCode,
        parentId: parent.id,
        providerId: null,
        createdBy: context.user.id,
        defaultTaxRate: data.defaultTaxRate,
      });
      return ok("Province tax region created successfully", { id });
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
  .validator((data: unknown) => updateTaxRegionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      if (!(await taxDal.findRegion(data.id)))
        return fail("Tax region not found", { error: "NOT_FOUND" });
      if (data.providerId) {
        const providers = new Set(
          (await taxDal.listProviders()).map((provider) => provider.id),
        );
        if (!providers.has(data.providerId)) {
          return fail("Tax provider is unavailable", {
            errors: { providerId: ["Select an enabled provider"] },
          });
        }
      }
      await taxDal.updateRegion(data.id, {
        providerId: data.providerId,
        metadata: data.metadata,
      });
      return ok("Tax region updated successfully", { id: data.id });
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
  .validator((data: unknown) => deleteTaxRegionsInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await taxDal.softDeleteRegions(data.ids);
      return ok(
        `${data.ids.length} tax region${data.ids.length === 1 ? "" : "s"} deleted`,
        { deleted: data.ids.length },
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
  .validator((data: unknown) => createTaxRateInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      if (!(await taxDal.findRegion(data.taxRegionId)))
        return fail("Tax region not found", { error: "NOT_FOUND" });
      const targets = await taxDal.listRuleTargets();
      const validTargets = new Map([
        ["product", new Set(targets.products.map((item) => item.id))],
        ["product_type", new Set(targets.productTypes.map((item) => item.id))],
        [
          "shipping_option",
          new Set(targets.shippingOptions.map((item) => item.id)),
        ],
      ]);
      if (
        data.rules.some(
          (rule) => !validTargets.get(rule.reference)?.has(rule.referenceId),
        )
      )
        return fail("One or more tax rule targets no longer exist", {
          errors: { rules: ["Refresh the page and select active targets"] },
        });
      const id = crypto.randomUUID();
      await taxDal.createRate({ id, ...data, createdBy: context.user.id });
      return ok("Tax rate created successfully", { id });
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
  .validator((data: unknown) => updateTaxRateInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      if (!(await taxDal.findRate(data.id)))
        return fail("Tax rate not found", { error: "NOT_FOUND" });
      if (data.rules) {
        const targets = await taxDal.listRuleTargets();
        const validTargets = new Map([
          ["product", new Set(targets.products.map((item) => item.id))],
          [
            "product_type",
            new Set(targets.productTypes.map((item) => item.id)),
          ],
          [
            "shipping_option",
            new Set(targets.shippingOptions.map((item) => item.id)),
          ],
        ]);
        if (
          data.rules.some(
            (rule) => !validTargets.get(rule.reference)?.has(rule.referenceId),
          )
        )
          return fail("One or more tax rule targets no longer exist", {
            errors: { rules: ["Refresh the page and select active targets"] },
          });
      }
      await taxDal.updateRate(data.id, data.taxRegionId, {
        name: data.name,
        code: data.code,
        rate: data.rate,
        isDefault: data.isDefault,
        isCombinable: data.isCombinable,
        metadata: data.metadata,
        rules: data.rules,
      });
      return ok("Tax rate updated successfully", { id: data.id });
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
  .validator((data: unknown) => deleteTaxRatesInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await taxDal.softDeleteRates(data.ids);
      return ok(
        `${data.ids.length} tax rate${data.ids.length === 1 ? "" : "s"} deleted`,
        { deleted: data.ids.length },
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
