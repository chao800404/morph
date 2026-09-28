import { priceListDal } from "@/lib/pricing/dal/price-list.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import {
  createPriceListInputSchema,
  listPriceListPricesInputSchema,
  listPriceListsInputSchema,
  priceListIdInputSchema,
  priceListPriceIdInputSchema,
  savePriceListPriceInputSchema,
  searchPriceListVariantsInputSchema,
  updatePriceListInputSchema,
} from "@/lib/validations/price-list";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";
import { priceListWriteService } from "@/lib/pricing/service/price-list-write.service";

export const listPriceLists = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listPriceListsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await priceListDal.listPage(input.data);
      return ok("Price lists fetched successfully", {
        priceLists: page.priceLists,
        pagination: paginationOf(page.total, input.data.page, input.data.limit),
      });
    } catch (error) {
      return failure(
        "List price lists error",
        error,
        "LIST_FAILED",
        "Failed to fetch price lists",
      );
    }
  });

export const getPriceList = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(priceListIdInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const priceList = await priceListDal.findById(input.data.id);
      return priceList
        ? ok("Price list fetched successfully", priceList)
        : fail("Price list not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get price list error",
        error,
        "GET_FAILED",
        "Failed to fetch price list",
      );
    }
  });

export const listPriceListPrices = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listPriceListPricesInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const priceList = await priceListDal.findById(input.data.priceListId);
      if (!priceList)
        return fail("Price list not found", { error: "NOT_FOUND" });
      const page = await priceListDal.listPricesPage(input.data);
      return ok("Price list prices fetched successfully", {
        prices: page.prices,
        pagination: paginationOf(page.total, input.data.page, input.data.limit),
      });
    } catch (error) {
      return failure(
        "List price list prices error",
        error,
        "LIST_FAILED",
        "Failed to fetch price list prices",
      );
    }
  });

export const searchPriceListVariants = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(searchPriceListVariantsInputSchema, data),
  )
  .middleware([productReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await productVariantDal.searchPage(input.data);
      return ok("Variants fetched successfully", result);
    } catch (error) {
      return failure(
        "Search price list variants error",
        error,
        "SEARCH_FAILED",
        "Failed to search variants",
      );
    }
  });

export const createPriceList = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createPriceListInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await priceListWriteService.create(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const updatePriceList = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updatePriceListInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await priceListWriteService.update(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const deletePriceList = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(priceListIdInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await priceListWriteService.archive(input.data.id);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const savePriceListPrice = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(savePriceListPriceInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await priceListWriteService.savePrice(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const removePriceListPrice = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(priceListPriceIdInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await priceListWriteService.removePrice(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });
