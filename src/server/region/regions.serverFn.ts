import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { regionDal } from "@/lib/region/dal/region.dal";
import { regionWriteService } from "@/lib/region/service/region-write.service";
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
  .validator((data: unknown) => parseInput(listRegionsInputSchema, data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
  .validator((data: unknown) => parseInput(getRegionInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
    parseInput(listAssignableCountriesInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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

export const listRegionPaymentProviders = createServerFn({ method: "GET" })
  .middleware([commerceReadMiddleware])
  .handler(async () => {
    try {
      const providers = await regionDal.listEnabledPaymentProviders();
      return ok("Payment providers fetched successfully", { providers });
    } catch (error) {
      return failure(
        "List region payment providers error",
        error,
        "LIST_FAILED",
        "Failed to fetch payment providers",
      );
    }
  });

export const createRegion = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createRegionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await regionWriteService.create(data);
      if (!result.success) {
        return fail(result.message, {
          error: result.error,
          errors: result.errors,
        });
      }
      return ok(`Region "${data.name}" created`, result.data);
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
  .validator((data: unknown) => parseInput(updateRegionInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await regionWriteService.update(data);
      if (!result.success) {
        return fail(result.message, {
          error: result.error,
          errors: result.errors,
        });
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
  .validator((data: unknown) => parseInput(deleteRegionsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    try {
      // The countries are released back to the picker, not deleted with the
      // region — see `regionDal.softDelete`.
      const result = await regionWriteService.deleteMany(data.ids);
      if (!result.success) {
        return fail(result.message, { error: result.error });
      }
      return ok(
        `${result.data.deleted} region${result.data.deleted === 1 ? "" : "s"} deleted`,
        result.data,
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
