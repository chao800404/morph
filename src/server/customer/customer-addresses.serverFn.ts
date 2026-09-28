import {
  CustomerAddressWriteError,
  customerAddressWriteService,
} from "@/lib/customer/service/customer-address-write.service";
import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import {
  createCustomerAddressInputSchema,
  deleteCustomerAddressInputSchema,
  updateCustomerAddressInputSchema,
} from "@/lib/validations/customer";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const createCustomerAddress = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createCustomerAddressInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const created = await customerAddressWriteService.create(input.data);
      return ok("Customer address created successfully", created);
    } catch (error) {
      if (error instanceof CustomerAddressWriteError)
        return fail(error.message, { error: error.code });
      return failure(
        "Create customer address error",
        error,
        "CREATE_FAILED",
        "Failed to create customer address",
      );
    }
  });

export const updateCustomerAddress = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateCustomerAddressInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const updated = await customerAddressWriteService.update(input.data);
      return ok("Customer address updated successfully", updated);
    } catch (error) {
      if (error instanceof CustomerAddressWriteError)
        return fail(error.message, { error: error.code });
      return failure(
        "Update customer address error",
        error,
        "UPDATE_FAILED",
        "Failed to update customer address",
      );
    }
  });

export const deleteCustomerAddress = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(deleteCustomerAddressInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const deleted = await customerAddressWriteService.archive(input.data);
      return ok("Customer address archived successfully", deleted);
    } catch (error) {
      if (error instanceof CustomerAddressWriteError)
        return fail(error.message, { error: error.code });
      return failure(
        "Archive customer address error",
        error,
        "DELETE_FAILED",
        "Failed to archive customer address",
      );
    }
  });
