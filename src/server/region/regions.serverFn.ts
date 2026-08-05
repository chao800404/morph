import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { regionDal } from "@/lib/region/dal/region.dal";
import {
  createRegionInputSchema,
  deleteRegionsInputSchema,
  getRegionInputSchema,
  listAssignableCountriesInputSchema,
  listRegionsInputSchema,
  updateRegionInputSchema,
} from "@/lib/validations/region";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listRegions = createServerFn({ method: "POST" })
  .validator((data: unknown) => listRegionsInputSchema.parse(data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await regionDal.listPage(data);
      return ok("Regions fetched successfully", {
        regions: page.regions,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List regions error",
        error,
        "LIST_FAILED",
        "Failed to fetch regions",
      );
    }
  });

export const getRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => getRegionInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const region = await regionDal.findDetail(data.id);
      if (!region) return fail("Region not found", { error: "NOT_FOUND" });
      return ok("Region fetched successfully", region);
    } catch (error) {
      return failure(
        "Get region error",
        error,
        "GET_FAILED",
        "Failed to fetch region",
      );
    }
  });

/**
 * The country picker's options.
 *
 * Seeds the catalogue first. The table starts empty because ICU data is only
 * reachable from the runtime, not from a SQL migration, and this is the first
 * place that needs it — see `regionDal.ensureCountryCatalog`.
 */
export const listAssignableCountries = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listAssignableCountriesInputSchema.parse(data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      await regionDal.ensureCountryCatalog();
      const countries = await regionDal.listAssignableCountries(
        data.regionId ?? null,
      );
      return ok("Countries fetched successfully", { countries });
    } catch (error) {
      return failure(
        "List assignable countries error",
        error,
        "LIST_FAILED",
        "Failed to fetch countries",
      );
    }
  });

export const createRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => createRegionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await regionDal.ensureCountryCatalog();

      // A country belongs to one region. Checked before inserting so the author
      // is told which country clashes, rather than losing the whole save to a
      // unique-index error.
      if (data.countries.length > 0) {
        const assignable = await regionDal.listAssignableCountries(null);
        const free = new Set(assignable.map((country) => country.iso2));
        const taken = data.countries.filter((code) => !free.has(code));
        if (taken.length > 0) {
          return fail(
            `${taken.join(", ").toUpperCase()} already belongs to another region`,
            { errors: { countries: ["Already served by another region"] } },
          );
        }
      }

      const id = crypto.randomUUID();
      await regionDal.create({
        id,
        name: data.name,
        currencyCode: data.currencyCode,
        automaticTaxes: data.automaticTaxes,
      });
      await regionDal.setCountries(id, data.countries);

      return ok(`Region "${data.name}" created`, { id });
    } catch (error) {
      return failure(
        "Create region error",
        error,
        "CREATE_FAILED",
        "Failed to create region",
      );
    }
  });

export const updateRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateRegionInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const existing = await regionDal.findById(data.id);
      if (!existing) return fail("Region not found", { error: "NOT_FOUND" });

      if (data.countries) {
        // Assignable already includes this region's own, so moving a country
        // between two of its own is not reported as a clash.
        const assignable = await regionDal.listAssignableCountries(data.id);
        const free = new Set(assignable.map((country) => country.iso2));
        const taken = data.countries.filter((code) => !free.has(code));
        if (taken.length > 0) {
          return fail(
            `${taken.join(", ").toUpperCase()} already belongs to another region`,
            { errors: { countries: ["Already served by another region"] } },
          );
        }
      }

      await regionDal.update(data.id, {
        name: data.name,
        currencyCode: data.currencyCode,
        automaticTaxes: data.automaticTaxes,
        metadata: data.metadata,
      });

      if (data.countries) {
        await regionDal.setCountries(data.id, data.countries);
      }

      return ok("Region updated successfully", { id: data.id });
    } catch (error) {
      return failure(
        "Update region error",
        error,
        "UPDATE_FAILED",
        "Failed to update region",
      );
    }
  });

export const deleteRegions = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteRegionsInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const existing = await regionDal.findByIds(data.ids);
      if (existing.length === 0) {
        return fail("No matching regions were found", { error: "NOT_FOUND" });
      }

      // The countries are released back to the picker, not deleted with the
      // region — see `regionDal.softDelete`.
      await regionDal.softDelete(existing.map((region) => region.id));

      return ok(
        `${existing.length} region${existing.length === 1 ? "" : "s"} deleted`,
        { deleted: existing.length },
      );
    } catch (error) {
      return failure(
        "Delete regions error",
        error,
        "DELETE_FAILED",
        "Failed to delete regions",
      );
    }
  });
