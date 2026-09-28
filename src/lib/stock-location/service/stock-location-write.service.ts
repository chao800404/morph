import type { Metadata } from "@/db/json";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import { StockLocationShippingInUseError } from "@/lib/stock-location/dal/stock-location.dal";
import type {
  CreateStockLocationFulfillmentSetInput,
  CreateStockLocationInput,
  UpdateStockLocationInput,
} from "@/lib/validations/stock-location";
import type { UpdateStockLocationDTO } from "@/lib/stock-location/dto/stock-location.dto";
import { fail, failure, ok, type ServerResult } from "@/lib/db/server-result";

type Dependencies = {
  dal: typeof stockLocationDal;
  createId(): string;
};

export type StockLocationWriteData = {
  id?: string;
  deleted?: number;
  fulfillmentSetId?: string;
};
export type StockLocationWriteResult = ServerResult<StockLocationWriteData>;

const duplicateName = (name: string) =>
  fail(`A stock location named "${name}" already exists`, {
    error: "DUPLICATE_NAME",
    errors: { name: ["This name is already in use"] },
  });

const duplicateFulfillmentSetName = (name: string) =>
  fail(`A fulfillment set named "${name}" already exists`, {
    error: "DUPLICATE_NAME",
    errors: { name: ["This name is already in use"] },
  });

const mergeMetadata = (current: Metadata, patch: Metadata): Metadata => {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === "") delete result[key];
    else result[key] = value;
  }
  return result;
};

export const createStockLocationWriteService = (
  overrides: Partial<Dependencies> = {},
) => {
  const dependencies: Dependencies = {
    dal: stockLocationDal,
    createId: () => crypto.randomUUID(),
    ...overrides,
  };

  return {
    async create(
      input: CreateStockLocationInput,
    ): Promise<StockLocationWriteResult> {
      if (await dependencies.dal.findByName(input.name)) {
        return duplicateName(input.name);
      }

      const id = dependencies.createId();
      try {
        await dependencies.dal.create({
          id,
          name: input.name,
          address: input.address ?? null,
          metadata: input.metadata ?? {},
        });
        return ok(`Stock location "${input.name}" created`, { id });
      } catch (error) {
        const duplicate = await dependencies.dal.findByName(input.name);
        if (duplicate) return duplicateName(input.name);
        return failure(
          "Create stock location error",
          error,
          "CREATE_FAILED",
          "Failed to create stock location",
        );
      }
    },

    async update(
      input: UpdateStockLocationInput,
    ): Promise<StockLocationWriteResult> {
      const existing = await dependencies.dal.findById(input.id);
      if (!existing)
        return fail("Stock location not found", { error: "NOT_FOUND" });

      if (input.name && input.name !== existing.name) {
        const conflict = await dependencies.dal.findByName(input.name);
        if (conflict && conflict.id !== input.id)
          return duplicateName(input.name);
      }

      const changes: UpdateStockLocationDTO = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.metadata !== undefined) {
        changes.metadata = mergeMetadata(existing.metadata, input.metadata);
      }
      if (input.address === null) {
        changes.address = null;
      } else if (input.address) {
        const address1 = input.address.address1 ?? existing.address?.address1;
        const countryCode =
          input.address.countryCode ?? existing.address?.countryCode;
        if (!address1 || !countryCode) {
          return fail(
            "A street address and country are required when adding a location address",
            {
              error: "INVALID_INPUT",
              errors: {
                "address.address1": ["Street address is required"],
                "address.countryCode": ["Country is required"],
              },
            },
          );
        }
        changes.address = {
          address1,
          countryCode,
          address2:
            input.address.address2 === undefined
              ? existing.address?.address2
              : input.address.address2,
          company:
            input.address.company === undefined
              ? existing.address?.company
              : input.address.company,
          city:
            input.address.city === undefined
              ? existing.address?.city
              : input.address.city,
          province:
            input.address.province === undefined
              ? existing.address?.province
              : input.address.province,
          postalCode:
            input.address.postalCode === undefined
              ? existing.address?.postalCode
              : input.address.postalCode,
          phone:
            input.address.phone === undefined
              ? existing.address?.phone
              : input.address.phone,
          metadata:
            input.address.metadata === undefined
              ? existing.address?.metadata
              : mergeMetadata(
                  existing.address?.metadata ?? {},
                  input.address.metadata,
                ),
        };
      }

      if (Object.keys(changes).length === 0) {
        return fail("Provide at least one stock location field to update", {
          error: "INVALID_INPUT",
        });
      }

      try {
        const updated = await dependencies.dal.update(
          input.id,
          changes,
          existing.updatedAt.toISOString(),
        );
        if (!updated) {
          const current = await dependencies.dal.findById(input.id);
          return current
            ? fail("Stock location changed while it was being edited", {
                error: "CONFLICT",
              })
            : fail("Stock location not found", { error: "NOT_FOUND" });
        }
        return ok("Stock location updated successfully", { id: input.id });
      } catch (error) {
        const duplicate = input.name
          ? await dependencies.dal.findByName(input.name)
          : null;
        if (duplicate && duplicate.id !== input.id && input.name) {
          return duplicateName(input.name);
        }
        const current = await dependencies.dal.findById(input.id);
        if (!current)
          return fail("Stock location not found", { error: "NOT_FOUND" });
        if (current.updatedAt.getTime() !== existing.updatedAt.getTime()) {
          return fail("Stock location changed while it was being edited", {
            error: "CONFLICT",
          });
        }
        return failure(
          "Update stock location error",
          error,
          "UPDATE_FAILED",
          "Failed to update stock location",
        );
      }
    },

    async batchSalesChannels(input: {
      locationId: string;
      add: string[];
      remove: string[];
    }): Promise<StockLocationWriteResult> {
      try {
        const updated = await dependencies.dal.batchChannels(
          input.locationId,
          input.add,
          input.remove,
        );
        return updated
          ? ok("Stock location sales channels updated", {
              id: input.locationId,
            })
          : fail("Stock location or sales channel not found", {
              error: "NOT_FOUND",
            });
      } catch (error) {
        return failure(
          "Update stock location sales channels error",
          error,
          "UPDATE_FAILED",
          "Failed to update stock location sales channels",
        );
      }
    },

    async createFulfillmentSet(
      locationId: string,
      input: CreateStockLocationFulfillmentSetInput,
    ): Promise<StockLocationWriteResult> {
      if (await dependencies.dal.findFulfillmentSetByName(input.name)) {
        return duplicateFulfillmentSetName(input.name);
      }
      const fulfillmentSetId = dependencies.createId();
      try {
        const created = await dependencies.dal.createFulfillmentSet({
          id: fulfillmentSetId,
          locationId,
          name: input.name,
          type: input.type,
          metadata: input.metadata,
        });
        return created
          ? ok(`Fulfillment set "${input.name}" created`, {
              id: locationId,
              fulfillmentSetId,
            })
          : fail("Stock location not found", { error: "NOT_FOUND" });
      } catch (error) {
        if (await dependencies.dal.findFulfillmentSetByName(input.name)) {
          return duplicateFulfillmentSetName(input.name);
        }
        if (!(await dependencies.dal.findById(locationId))) {
          return fail("Stock location not found", { error: "NOT_FOUND" });
        }
        return failure(
          "Create stock location fulfillment set error",
          error,
          "CREATE_FAILED",
          "Failed to create fulfillment set",
        );
      }
    },

    async deleteMany(ids: string[]): Promise<StockLocationWriteResult> {
      const existing = await dependencies.dal.findByIds(ids);
      if (existing.length === 0) {
        return fail("No matching stock locations were found", {
          error: "NOT_FOUND",
        });
      }
      try {
        await dependencies.dal.softDelete(
          existing.map((location) => location.id),
        );
        return ok(
          `${existing.length} stock location${existing.length === 1 ? "" : "s"} deleted`,
          { deleted: existing.length },
        );
      } catch (error) {
        if (error instanceof StockLocationShippingInUseError) {
          return fail(
            "Remove the selected shipping methods from active carts before deleting this location",
            { error: "CONFLICT" },
          );
        }
        return failure(
          "Delete stock locations error",
          error,
          "DELETE_FAILED",
          "Failed to delete stock locations",
        );
      }
    },
  };
};

export const stockLocationWriteService = createStockLocationWriteService();
