import { parseInput } from "@/lib/db/server-result";
import { createProductInputSchema } from "@/lib/validations/product";
import { createServerFn } from "@tanstack/react-start";
import { productWriteService } from "@/lib/product/service/product-write.service";
import { getConfig } from "../get-config";
import { productAdminMiddleware } from "../middleware/auth.middleware";

export const createProduct = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(
      createProductInputSchema(getConfig().server.upload.maxAssetsPerRecord),
      data,
    ),
  )
  .middleware([productAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    return productWriteService.create(input.data, context.user.id);
  });
