import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { priceListDal } from "@/lib/pricing/dal/price-list.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import {
  batchPriceListPricesInputSchema,
  createPriceListInputSchema,
  savePriceListPriceInputSchema,
  updatePriceListInputSchema,
  updatePriceListPatchInputSchema,
} from "@/lib/validations/price-list";
import type { z } from "zod";

export type CreatePriceListInput = z.infer<typeof createPriceListInputSchema>;
export type UpdatePriceListInput = z.infer<typeof updatePriceListInputSchema>;
export type UpdatePriceListPatchInput = z.infer<
  typeof updatePriceListPatchInputSchema
>;
export type SavePriceListPriceInput = z.infer<
  typeof savePriceListPriceInputSchema
>;
export type BatchPriceCreateInput = z.infer<
  typeof batchPriceListPricesInputSchema
>["create"][number];
export type BatchPriceUpdateInput = z.infer<
  typeof batchPriceListPricesInputSchema
>["update"][number];
export type BatchPriceListPricesInput = z.infer<
  typeof batchPriceListPricesInputSchema
>;

export type PriceListPriceBatchResult =
  | {
      success: true;
      message: string;
      data: {
        created: Awaited<ReturnType<typeof priceListDal.findPricesByIds>>;
        updated: Awaited<ReturnType<typeof priceListDal.findPricesByIds>>;
        deleted: { ids: string[]; object: "price"; deleted: true };
      };
    }
  | {
      success: false;
      message: string;
      data: null;
      error?: string;
      errors?: Record<string, string[]>;
    };

export type PriceListWriteResult =
  | {
      success: true;
      message: string;
      data: { id?: string; priceListId?: string };
    }
  | {
      success: false;
      message: string;
      data: null;
      error?: string;
      errors?: Record<string, string[]>;
    };

type PriceListWriteFailure = Extract<PriceListWriteResult, { success: false }>;

const failed = (
  message: string,
  error: string,
  errors?: Record<string, string[]>,
): PriceListWriteFailure => ({
  success: false,
  message,
  data: null,
  error,
  ...(errors ? { errors } : {}),
});

const isoOrNull = (value: string | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const groupIdsExist = async (ids: string[]) => {
  const groups = await priceListDal.activeCustomerGroups(ids);
  return groups.length === ids.length;
};

const regionIdsExist = async (ids: string[]) => {
  const regions = await regionDal.findByIds(ids);
  return regions.length === ids.length;
};

const validateSchedule = (startsAt: string | null, endsAt: string | null) => {
  if (startsAt && !Number.isFinite(new Date(startsAt).getTime())) {
    return failed("Invalid start date", "INVALID_REQUEST", {
      startsAt: ["Enter a valid start date"],
    });
  }
  if (endsAt && !Number.isFinite(new Date(endsAt).getTime())) {
    return failed("Invalid end date", "INVALID_REQUEST", {
      endsAt: ["Enter a valid end date"],
    });
  }
  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
    return failed("End date must be after the start date", "INVALID_REQUEST", {
      endsAt: ["End date must be after the start date"],
    });
  }
  return null;
};

/** Shared by dashboard server functions and the Medusa-style Admin REST API. */
export const priceListWriteService = {
  async create(data: CreatePriceListInput): Promise<PriceListWriteResult> {
    try {
      if (!(await groupIdsExist(data.customerGroupIds))) {
        return failed(
          "One or more customer groups were not found",
          "CUSTOMER_GROUP_NOT_FOUND",
        );
      }
      if (!(await regionIdsExist(data.regionIds))) {
        return failed(
          "One or more regions were not found",
          "REGION_NOT_FOUND",
        );
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await priceListDal.create({
        ...data,
        id,
        startsAt: isoOrNull(data.startsAt) ?? null,
        endsAt: isoOrNull(data.endsAt) ?? null,
        now,
      });
      return {
        success: true,
        message: "Price list created successfully",
        data: { id },
      };
    } catch (error) {
      console.error("Create price list error:", error);
      return failed(
        error instanceof Error ? error.message : "Failed to create price list",
        "CREATE_FAILED",
      );
    }
  },

  async update(data: UpdatePriceListInput): Promise<PriceListWriteResult> {
    return this.updatePatch(data);
  },

  async updatePatch(
    data: UpdatePriceListPatchInput,
  ): Promise<PriceListWriteResult> {
    try {
      const current = await priceListDal.findById(data.id);
      if (!current) return failed("Price list not found", "NOT_FOUND");

      const startsAt =
        data.startsAt === undefined
          ? current.startsAt
          : (isoOrNull(data.startsAt) ?? null);
      const endsAt =
        data.endsAt === undefined
          ? current.endsAt
          : (isoOrNull(data.endsAt) ?? null);
      const scheduleError = validateSchedule(startsAt, endsAt);
      if (scheduleError) return scheduleError;

      if (
        data.customerGroupIds !== undefined &&
        !(await groupIdsExist(data.customerGroupIds))
      ) {
        return failed(
          "One or more customer groups were not found",
          "CUSTOMER_GROUP_NOT_FOUND",
        );
      }
      if (
        data.regionIds !== undefined &&
        !(await regionIdsExist(data.regionIds))
      ) {
        return failed(
          "One or more regions were not found",
          "REGION_NOT_FOUND",
        );
      }

      const updated = await priceListDal.update({
        ...data,
        customerGroupIds: data.customerGroupIds ?? current.customerGroupIds,
        regionIds: data.regionIds ?? current.regionIds,
        startsAt: data.startsAt === undefined ? undefined : startsAt,
        endsAt: data.endsAt === undefined ? undefined : endsAt,
        now: new Date().toISOString(),
      });
      return updated
        ? {
            success: true,
            message: "Price list updated successfully",
            data: { id: data.id },
          }
        : failed("Price list not found", "NOT_FOUND");
    } catch (error) {
      console.error("Update price list error:", error);
      return failed(
        error instanceof Error ? error.message : "Failed to update price list",
        "UPDATE_FAILED",
      );
    }
  },

  async archive(id: string): Promise<PriceListWriteResult> {
    try {
      const deleted = await priceListDal.softDelete(
        id,
        new Date().toISOString(),
      );
      return deleted
        ? {
            success: true,
            message: "Price list archived successfully",
            data: { id },
          }
        : failed("Price list not found", "NOT_FOUND");
    } catch (error) {
      console.error("Archive price list error:", error);
      return failed(
        error instanceof Error ? error.message : "Failed to archive price list",
        "DELETE_FAILED",
      );
    }
  },

  async savePrice(
    data: SavePriceListPriceInput,
  ): Promise<PriceListWriteResult> {
    try {
      if (!(await currencyDal.areSupported([data.currencyCode]))) {
        return failed(
          "A price uses a currency that is not enabled for this store",
          "UNSUPPORTED_CURRENCY",
          { currencyCode: ["Choose a currency enabled in Store settings"] },
        );
      }
      const result = await priceListDal.savePrice({
        ...data,
        minQuantity: data.minQuantity ?? undefined,
        maxQuantity: data.maxQuantity ?? undefined,
        now: new Date().toISOString(),
      });
      if (result === "missing-list")
        return failed("Price list not found", "NOT_FOUND");
      if (result === "missing-variant")
        return failed("Product variant not found", "VARIANT_NOT_FOUND");
      if (result === "duplicate")
        return failed(
          "A price already exists for this variant, currency, and quantity range",
          "DUPLICATE_PRICE",
        );
      return {
        success: true,
        message: "Price added to list successfully",
        data: { priceListId: data.priceListId },
      };
    } catch (error) {
      console.error("Save price list price error:", error);
      return failed(
        error instanceof Error ? error.message : "Failed to save price",
        "SAVE_FAILED",
      );
    }
  },

  async removePrice(input: {
    priceListId: string;
    priceId: string;
  }): Promise<PriceListWriteResult> {
    try {
      const removed = await priceListDal.removePrice({
        ...input,
        now: new Date().toISOString(),
      });
      return removed
        ? {
            success: true,
            message: "Price removed from list",
            data: { priceListId: input.priceListId },
          }
        : failed("Price entry not found", "NOT_FOUND");
    } catch (error) {
      console.error("Remove price list price error:", error);
      return failed(
        error instanceof Error ? error.message : "Failed to remove price",
        "DELETE_FAILED",
      );
    }
  },

  async batchPrices(
    priceListId: string,
    input: BatchPriceListPricesInput,
  ): Promise<PriceListPriceBatchResult> {
    try {
      if (!(await priceListDal.findById(priceListId))) {
        return failed("Price list not found", "NOT_FOUND");
      }
      const currencies = [
        ...new Set([
          ...input.create.map((price) => price.currencyCode),
          ...input.update.flatMap((price) =>
            price.currencyCode === undefined ? [] : [price.currencyCode],
          ),
        ]),
      ];
      if (currencies.length && !(await currencyDal.areSupported(currencies))) {
        return failed(
          "A price uses a currency that is not enabled for this store",
          "UNSUPPORTED_CURRENCY",
          { currencyCode: ["Choose a currency enabled in Store settings"] },
        );
      }

      const result = await priceListDal.applyPriceBatch({
        priceListId,
        ...input,
        now: new Date().toISOString(),
      });
      if (!result.success) {
        switch (result.error) {
          case "missing-list":
            return failed("Price list not found", "NOT_FOUND");
          case "missing-variant":
            return failed("Product variant not found", "VARIANT_NOT_FOUND");
          case "missing-price":
            return failed("A price entry was not found", "PRICE_NOT_FOUND");
          case "invalid-range":
            return failed(
              "Price quantity range is invalid",
              "INVALID_REQUEST",
              { quantity: ["Check the minimum and maximum quantities"] },
            );
        }
      }

      const [created, updated] = await Promise.all([
        priceListDal.findPricesByIds(priceListId, result.createdIds),
        priceListDal.findPricesByIds(priceListId, result.updatedIds),
      ]);
      if (
        created.length !== result.createdIds.length ||
        updated.length !== result.updatedIds.length
      ) {
        return failed(
          "The saved prices could not be read back",
          "BATCH_RESULT_UNAVAILABLE",
        );
      }
      return {
        success: true,
        message: "Price list prices updated successfully",
        data: {
          created,
          updated,
          deleted: { ids: result.deletedIds, object: "price", deleted: true },
        },
      };
    } catch (error) {
      console.error("Batch price list prices error:", error);
      const message = error instanceof Error ? error.message : "";
      if (message.includes("prices_list_currency_quantity_active_unique")) {
        return failed(
          "A price already exists for this variant, currency, and quantity range",
          "DUPLICATE_PRICE",
        );
      }
      return failed(
        error instanceof Error
          ? error.message
          : "Failed to update price list prices",
        "BATCH_FAILED",
      );
    }
  },
};
