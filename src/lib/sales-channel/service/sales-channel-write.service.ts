import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { fail, failure, ok, type ServerResult } from "@/lib/db/server-result";
import { productDal } from "@/lib/product/dal/product.dal";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import type {
  createSalesChannelInputSchema,
  deleteSalesChannelsInputSchema,
  setProductSalesChannelsInputSchema,
  updateSalesChannelInputSchema,
  updateSalesChannelProductsInputSchema,
} from "@/lib/validations/sales-channel";
import type { z } from "zod";

export type CreateSalesChannelInput = z.infer<
  typeof createSalesChannelInputSchema
>;
export type UpdateSalesChannelInput = z.infer<
  typeof updateSalesChannelInputSchema
>;
export type DeleteSalesChannelsInput = z.infer<
  typeof deleteSalesChannelsInputSchema
>;
export type SetProductSalesChannelsInput = z.infer<
  typeof setProductSalesChannelsInputSchema
>;
export type UpdateSalesChannelProductsInput = z.infer<
  typeof updateSalesChannelProductsInputSchema
>;

export type SalesChannelWriteData = {
  id?: string;
  count?: number;
  deleted?: number;
  added?: number;
  removed?: number;
};
export type SalesChannelWriteResult = ServerResult<SalesChannelWriteData>;

type Dependencies = {
  channels: typeof salesChannelDal;
  products: Pick<typeof productDal, "findByIds">;
  currencies: Pick<typeof currencyDal, "getDefaultSalesChannelId">;
  storefronts: Pick<typeof storefrontDal, "ensureDefault">;
  createId(): string;
};

const duplicateName = (name: string) =>
  fail(`A sales channel named "${name}" already exists`, {
    error: "DUPLICATE_NAME",
    errors: { name: ["This name is already in use"] },
  });

export const createSalesChannelWriteService = (
  overrides: Partial<Dependencies> = {},
) => {
  const dependencies: Dependencies = {
    channels: salesChannelDal,
    products: productDal,
    currencies: currencyDal,
    storefronts: storefrontDal,
    createId: () => crypto.randomUUID(),
    ...overrides,
  };

  return {
    async create(
      input: CreateSalesChannelInput,
    ): Promise<SalesChannelWriteResult> {
      let channelCreated = false;
      try {
        if (await dependencies.channels.findByName(input.name)) {
          return duplicateName(input.name);
        }

        const id = dependencies.createId();
        await dependencies.channels.create({
          id,
          name: input.name,
          type: input.type,
          description: input.description,
          isDisabled: input.isDisabled,
          metadata: input.metadata,
        });
        channelCreated = true;
        if (input.type === "storefront") {
          try {
            await dependencies.storefronts.ensureDefault(id);
          } catch (error) {
            await dependencies.channels.softDelete([id]);
            throw error;
          }
        }

        return ok(`Sales channel "${input.name}" created`, { id });
      } catch (error) {
        if (!channelCreated) {
          try {
            const duplicate = await dependencies.channels.findByName(
              input.name,
            );
            if (duplicate) return duplicateName(input.name);
          } catch {
            // Preserve the original write or storefront initialization failure.
          }
        }
        return failure(
          "Create sales channel error",
          error,
          "CREATE_FAILED",
          "Failed to create sales channel",
        );
      }
    },

    async update(
      input: UpdateSalesChannelInput,
    ): Promise<SalesChannelWriteResult> {
      try {
        const existing = await dependencies.channels.findById(input.id);
        if (!existing) {
          return fail("Sales channel not found", { error: "NOT_FOUND" });
        }

        if (input.name && input.name !== existing.name) {
          const clash = await dependencies.channels.findByName(input.name);
          if (clash && clash.id !== input.id) return duplicateName(input.name);
        }

        await dependencies.channels.update(input.id, {
          name: input.name,
          description: input.description,
          isDisabled: input.isDisabled,
          metadata: input.metadata,
        });
        return ok("Sales channel updated successfully", { id: input.id });
      } catch (error) {
        return failure(
          "Update sales channel error",
          error,
          "UPDATE_FAILED",
          "Failed to update sales channel",
        );
      }
    },

    async deleteMany(
      input: DeleteSalesChannelsInput,
    ): Promise<SalesChannelWriteResult> {
      try {
        const existing = await dependencies.channels.findByIds(input.ids);
        if (existing.length === 0) {
          return fail("No matching sales channels were found", {
            error: "NOT_FOUND",
          });
        }

        const defaultSalesChannelId =
          await dependencies.currencies.getDefaultSalesChannelId();
        if (existing.some((channel) => channel.id === defaultSalesChannelId)) {
          return fail(
            "The default sales channel cannot be deleted. Choose another default in Store settings first.",
            { error: "DEFAULT_CHANNEL" },
          );
        }

        await dependencies.channels.softDelete(
          existing.map((channel) => channel.id),
        );
        return ok(
          `${existing.length} sales channel${existing.length === 1 ? "" : "s"} deleted`,
          { count: existing.length, deleted: existing.length },
        );
      } catch (error) {
        return failure(
          "Delete sales channels error",
          error,
          "DELETE_FAILED",
          "Failed to delete sales channels",
        );
      }
    },

    async setProductChannels(
      input: SetProductSalesChannelsInput,
    ): Promise<SalesChannelWriteResult> {
      try {
        const products = await dependencies.products.findByIds([
          input.productId,
        ]);
        if (products.length !== 1) {
          return fail("Product not found", { error: "NOT_FOUND" });
        }
        const channels = await dependencies.channels.findByIds(
          input.salesChannelIds,
        );
        if (channels.length !== input.salesChannelIds.length) {
          return fail("One or more sales channels no longer exist", {
            error: "NOT_FOUND",
          });
        }
        await dependencies.channels.setProductChannels(
          input.productId,
          channels.map((channel) => channel.id),
        );
        return ok("Sales channels updated", { count: channels.length });
      } catch (error) {
        return failure(
          "Set product sales channels error",
          error,
          "UPDATE_FAILED",
          "Failed to update sales channels",
        );
      }
    },

    async addProducts(
      input: UpdateSalesChannelProductsInput,
    ): Promise<SalesChannelWriteResult> {
      try {
        const channel = await dependencies.channels.findById(
          input.salesChannelId,
        );
        if (!channel) {
          return fail("Sales channel not found", { error: "NOT_FOUND" });
        }
        const productIds = [...new Set(input.productIds)];
        const products = await dependencies.products.findByIds(productIds);
        if (products.length !== productIds.length) {
          return fail("One or more products no longer exist", {
            error: "NOT_FOUND",
          });
        }
        await dependencies.channels.addProducts(channel.id, productIds);
        return ok(
          `${productIds.length} product${productIds.length === 1 ? "" : "s"} added to ${channel.name}`,
          {
            id: channel.id,
            count: productIds.length,
            added: productIds.length,
          },
        );
      } catch (error) {
        return failure(
          "Add products to sales channel error",
          error,
          "UPDATE_FAILED",
          "Failed to add products",
        );
      }
    },

    async removeProducts(
      input: UpdateSalesChannelProductsInput,
    ): Promise<SalesChannelWriteResult> {
      try {
        const channel = await dependencies.channels.findById(
          input.salesChannelId,
        );
        if (!channel) {
          return fail("Sales channel not found", { error: "NOT_FOUND" });
        }
        const productIds = [...new Set(input.productIds)];
        await dependencies.channels.removeProducts(channel.id, productIds);
        return ok(
          `${productIds.length} product${productIds.length === 1 ? "" : "s"} removed from ${channel.name}`,
          {
            id: channel.id,
            count: productIds.length,
            removed: productIds.length,
          },
        );
      } catch (error) {
        return failure(
          "Remove products from sales channel error",
          error,
          "UPDATE_FAILED",
          "Failed to remove products",
        );
      }
    },
  };
};

export const salesChannelWriteService = createSalesChannelWriteService();
