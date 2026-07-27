import { currencyDal } from "@/lib/currency/dal/currency.dal";
import {
  addStoreCurrenciesInputSchema,
  listCurrenciesInputSchema,
  removeStoreCurrenciesInputSchema,
  storeCurrencyCodeInputSchema,
  updateStoreGeneralInputSchema,
  updateStoreCurrencyInputSchema,
} from "@/lib/validations/currency";
import { createServerFn } from "@tanstack/react-start";
import {
  productAdminMiddleware,
  productReadMiddleware,
} from "../middleware/auth.middleware";

export const listAvailableCurrencies = createServerFn({ method: "POST" })
  .validator((data: unknown) => listCurrenciesInputSchema.parse(data ?? {}))
  .middleware([productReadMiddleware])
  .handler(async ({ data }) => ({
    success: true,
    message: "Currencies fetched successfully",
    data: await currencyDal.listAvailable(data.query),
  }));

export const getStoreCurrencySettings = createServerFn({ method: "GET" })
  .middleware([productReadMiddleware])
  .handler(async () => ({
    success: true,
    message: "Store currencies fetched successfully",
    data: await currencyDal.getStoreSettings(),
  }));

export const addStoreCurrencies = createServerFn({ method: "POST" })
  .validator((data: unknown) => addStoreCurrenciesInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await currencyDal.addSupported(
        [...new Set(data.codes)],
        data.taxInclusiveCodes,
      );
      return {
        success: true,
        message: `${data.codes.length} currencies added`,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to add currencies",
      };
    }
  });

export const removeStoreCurrency = createServerFn({ method: "POST" })
  .validator((data: unknown) => storeCurrencyCodeInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await currencyDal.removeSupported(data.code);
      return { success: true, message: "Currency removed" };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to remove currency",
      };
    }
  });

const parseCurrencyCodesFormData = (data: unknown) => {
  if (!(data instanceof FormData)) return data;
  const value = data.get("codes");
  if (typeof value !== "string") return { codes: [] };
  try {
    return { codes: JSON.parse(value) as unknown };
  } catch {
    return { codes: [] };
  }
};

export const removeStoreCurrencies = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    removeStoreCurrenciesInputSchema.parse(parseCurrencyCodesFormData(data)),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await currencyDal.removeSupportedMany(data.codes);
      return {
        success: true,
        message: `${data.codes.length} currencies removed`,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to remove currencies",
      };
    }
  });

export const setDefaultStoreCurrency = createServerFn({ method: "POST" })
  .validator((data: unknown) => storeCurrencyCodeInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await currencyDal.setDefault(data.code);
      return { success: true, message: "Default currency updated" };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update default currency",
      };
    }
  });

export const updateStoreCurrency = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateStoreCurrencyInputSchema.parse(data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await currencyDal.setTaxInclusive(data.code, data.isTaxInclusive);
      return { success: true, message: "Currency settings updated" };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update currency settings",
      };
    }
  });

const parseStoreGeneralFormData = (data: unknown) => {
  if (!(data instanceof FormData)) return data;
  return {
    name: data.get("name"),
    defaultCurrencyCode: data.get("defaultCurrencyCode"),
  };
};

export const updateStoreGeneral = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    updateStoreGeneralInputSchema.parse(parseStoreGeneralFormData(data)),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await currencyDal.updateStoreGeneral(
        data.name,
        data.defaultCurrencyCode,
      );
      return { success: true, message: "Store details updated" };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update store details",
      };
    }
  });
