import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { paginationOf, failure, ok } from "@/lib/db/server-result";
import { listInventoryInputSchema } from "@/lib/validations/inventory";
import { createServerFn } from "@tanstack/react-start";
import { commerceReadMiddleware } from "../middleware/auth.middleware";

export const listInventory = createServerFn({ method: "POST" })
  .validator((data: unknown) => listInventoryInputSchema.parse(data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      await inventoryDal.reconcileManagedVariants();
      const page = await inventoryDal.listPage(data);
      return ok("Inventory fetched successfully", {
        items: page.items,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List inventory error",
        error,
        "LIST_FAILED",
        "Failed to fetch inventory",
      );
    }
  });
