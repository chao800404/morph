import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { currencyDal } from "@/lib/currency/dal/currency.dal";
import { productDal } from "@/lib/product/dal/product.dal";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import { fail, failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import {
  createSalesChannelInputSchema,
  deleteSalesChannelsInputSchema,
  getSalesChannelInputSchema,
  listSalesChannelsInputSchema,
  setProductSalesChannelsInputSchema,
  updateSalesChannelInputSchema,
  updateSalesChannelProductsInputSchema,
} from "@/lib/validations/sales-channel";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listSalesChannelsInputSchema, data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const [page, defaultSalesChannelId] = await Promise.all([
        salesChannelDal.listPage(data),
        currencyDal.getDefaultSalesChannelId(),
      ]);
      return ok("Sales channels fetched successfully", {
        salesChannels: page.channels.map((channel) => ({
          ...channel,
          isDefault: channel.id === defaultSalesChannelId,
        })),
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List sales channels error",
        error,
        "LIST_FAILED",
        "Failed to fetch sales channels",
      );
    }
  });

export const getSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getSalesChannelInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const channel = await salesChannelDal.findById(data.id);
      if (!channel) {
        return fail("Sales channel not found", { error: "NOT_FOUND" });
      }

      const [counts, defaultSalesChannelId] = await Promise.all([
        salesChannelDal.countProducts([channel.id]),
        currencyDal.getDefaultSalesChannelId(),
      ]);
      return ok("Sales channel fetched successfully", {
        ...channel,
        isDefault: channel.id === defaultSalesChannelId,
        productCount: counts.get(channel.id) ?? 0,
      });
    } catch (error) {
      return failure(
        "Get sales channel error",
        error,
        "GET_FAILED",
        "Failed to fetch sales channel",
      );
    }
  });

export const createSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createSalesChannelInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      // Checked before inserting so the author gets the error on the field
      // rather than a unique-index failure wrapped in `Failed query:`.
      if (await salesChannelDal.findByName(data.name)) {
        return fail(`A sales channel named "${data.name}" already exists`, {
          errors: { name: ["This name is already in use"] },
        });
      }

      const id = crypto.randomUUID();
      await salesChannelDal.create({
        id,
        name: data.name,
        type: data.type,
        description: data.description,
        isDisabled: data.isDisabled,
      });
      if (data.type === "storefront") {
        try {
          await storefrontDal.ensureDefault(id);
        } catch (error) {
          await salesChannelDal.softDelete([id]);
          throw error;
        }
      }

      return ok(`Sales channel "${data.name}" created`, { id });
    } catch (error) {
      return failure(
        "Create sales channel error",
        error,
        "CREATE_FAILED",
        "Failed to create sales channel",
      );
    }
  });

export const updateSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateSalesChannelInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const existing = await salesChannelDal.findById(data.id);
      if (!existing) {
        return fail("Sales channel not found", { error: "NOT_FOUND" });
      }

      if (data.name && data.name !== existing.name) {
        const clash = await salesChannelDal.findByName(data.name);
        if (clash && clash.id !== data.id) {
          return fail(`A sales channel named "${data.name}" already exists`, {
            errors: { name: ["This name is already in use"] },
          });
        }
      }

      await salesChannelDal.update(data.id, {
        name: data.name,
        description: data.description,
        isDisabled: data.isDisabled,
        metadata: data.metadata,
      });

      return ok("Sales channel updated successfully", { id: data.id });
    } catch (error) {
      return failure(
        "Update sales channel error",
        error,
        "UPDATE_FAILED",
        "Failed to update sales channel",
      );
    }
  });

export const deleteSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteSalesChannelsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const existing = await salesChannelDal.findByIds(data.ids);
      if (existing.length === 0) {
        return fail("No matching sales channels were found", {
          error: "NOT_FOUND",
        });
      }

      const defaultSalesChannelId =
        await currencyDal.getDefaultSalesChannelId();
      if (existing.some((channel) => channel.id === defaultSalesChannelId)) {
        return fail(
          "The default sales channel cannot be deleted. Choose another default in Store settings first.",
          { error: "DEFAULT_CHANNEL" },
        );
      }

      // Products are not touched — only their listing in this channel. A
      // product in no channel is unlisted, not deleted.
      await salesChannelDal.softDelete(existing.map((channel) => channel.id));

      return ok(
        `${existing.length} sales channel${existing.length === 1 ? "" : "s"} deleted`,
        { deleted: existing.length },
      );
    } catch (error) {
      return failure(
        "Delete sales channels error",
        error,
        "DELETE_FAILED",
        "Failed to delete sales channels",
      );
    }
  });

export const getProductSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(setProductSalesChannelsInputSchema.pick({ productId: true }), data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const ids = await salesChannelDal.listChannelIdsForProduct(
        data.productId,
      );
      // The link table has no foreign key, so a link can outlive its channel.
      // Resolving through the DAL drops those rather than returning dead ids.
      const channels = await salesChannelDal.findByIds(ids);
      return ok("Product sales channels fetched successfully", { channels });
    } catch (error) {
      return failure(
        "Get product sales channels error",
        error,
        "GET_FAILED",
        "Failed to fetch product sales channels",
      );
    }
  });

export const setProductSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(setProductSalesChannelsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      // Nothing enforces that these channels exist, so check before writing —
      // a link to a deleted channel would silently unlist the product.
      const channels = await salesChannelDal.findByIds(data.salesChannelIds);
      if (channels.length !== data.salesChannelIds.length) {
        return fail("One or more sales channels no longer exist", {
          error: "NOT_FOUND",
        });
      }

      await salesChannelDal.setProductChannels(
        data.productId,
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
  });

export const addProductsToSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateSalesChannelProductsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const channel = await salesChannelDal.findById(data.salesChannelId);
      if (!channel) {
        return fail("Sales channel not found", { error: "NOT_FOUND" });
      }

      const productIds = [...new Set(data.productIds)];
      const products = await productDal.findByIds(productIds);
      if (products.length !== productIds.length) {
        return fail("One or more products no longer exist", {
          error: "NOT_FOUND",
        });
      }

      await salesChannelDal.addProducts(data.salesChannelId, productIds);
      return ok(
        `${productIds.length} product${productIds.length === 1 ? "" : "s"} added to ${channel.name}`,
        { added: productIds.length },
      );
    } catch (error) {
      return failure(
        "Add products to sales channel error",
        error,
        "UPDATE_FAILED",
        "Failed to add products",
      );
    }
  });

export const removeProductsFromSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateSalesChannelProductsInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const channel = await salesChannelDal.findById(data.salesChannelId);
      if (!channel) {
        return fail("Sales channel not found", { error: "NOT_FOUND" });
      }

      await salesChannelDal.removeProducts(
        data.salesChannelId,
        data.productIds,
      );
      return ok(
        `${data.productIds.length} product${data.productIds.length === 1 ? "" : "s"} removed from ${channel.name}`,
        { removed: data.productIds.length },
      );
    } catch (error) {
      return failure(
        "Remove products from sales channel error",
        error,
        "UPDATE_FAILED",
        "Failed to remove products",
      );
    }
  });
