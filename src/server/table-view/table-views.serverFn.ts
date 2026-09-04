import { failure, ok, parseInput } from "@/lib/db/server-result";
import { tableViewDal } from "@/lib/table-view/dal/table-view.dal";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";

const tableKeySchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9:_-]+$/i);
const configurationSchema = z.object({
  columnOrder: z.array(z.string().min(1).max(100)).max(100),
  hiddenColumns: z.array(z.string().min(1).max(100)).max(100),
});

export const getTableViewConfiguration = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(z.object({ tableKey: tableKeySchema }), data))
  .middleware([authMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      return ok(
        "Table view configuration fetched successfully",
        await tableViewDal.findDefault(context.user.id, data.tableKey),
      );
    } catch (error) {
      return failure("Get table view configuration error", error, "GET_FAILED", "Failed to fetch table view configuration");
    }
  });

export const saveTableViewConfiguration = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(z.object({ tableKey: tableKeySchema, configuration: configurationSchema }), data))
  .middleware([authMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      return ok(
        "Table view configuration saved successfully",
        await tableViewDal.upsertDefault(context.user.id, data.tableKey, data.configuration),
      );
    } catch (error) {
      return failure("Save table view configuration error", error, "SAVE_FAILED", "Failed to save table view configuration");
    }
  });
