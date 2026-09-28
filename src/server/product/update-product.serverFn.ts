import { parseInput } from "@/lib/db/server-result";
import {
  deleteProductsInputSchema,
  updateProductInputSchema,
} from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productWriteService } from "@/lib/product/service/product-write.service";
import { getConfig } from "../get-config";
import { productAdminMiddleware } from "../middleware/auth.middleware";

export const updateProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(
      updateProductInputSchema(getConfig().server.upload.maxAssetsPerRecord),
      data,
    ),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productWriteService.update(input.data, context.user.id);
  });

export const deleteProducts = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteProductsInputSchema, data))
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productWriteService.delete(input.data, context.user.id);
  });
