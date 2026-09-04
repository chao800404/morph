import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import { listInventoryInputSchema } from "@/lib/validations/inventory";
import { createServerFn } from "@tanstack/react-start";
import { commerceReadMiddleware } from "../middleware/auth.middleware";

export const listInventory = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listInventoryInputSchema, data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

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
