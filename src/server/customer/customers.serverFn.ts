import { customerDal } from "@/lib/customer/dal/customer.dal";
import { failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import {
  createCustomerInputSchema,
  customerIdInputSchema,
  deleteCustomersInputSchema,
  listCustomersInputSchema,
  updateCustomerInputSchema,
} from "@/lib/validations/customer";
import {
  CustomerWriteError,
  customerWriteService,
} from "@/lib/customer/service/customer-write.service";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listCustomers = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listCustomersInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const page = await customerDal.listPage(data);
      return ok("Customers fetched successfully", {
        customers: page.customers,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List customers error",
        error,
        "LIST_FAILED",
        "Failed to fetch customers",
      );
    }
  });

export const getCustomer = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(customerIdInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const customer = await customerDal.findById(input.data.id);
      return customer
        ? ok("Customer fetched successfully", customer)
        : {
            success: false as const,
            message: "Customer not found",
            data: null,
            error: "NOT_FOUND",
          };
    } catch (error) {
      return failure(
        "Get customer error",
        error,
        "GET_FAILED",
        "Failed to fetch customer",
      );
    }
  });

export const createCustomer = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createCustomerInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const customer = await customerWriteService.create(
        input.data,
        context.user.id,
      );
      return ok("Customer created successfully", customer);
    } catch (error) {
      if (
        error instanceof CustomerWriteError &&
        error.code === "DUPLICATE_EMAIL"
      ) {
        return {
          success: false as const,
          message: error.message,
          data: null,
          errors: { email: ["This email is already in use"] },
        };
      }
      return failure(
        "Create customer error",
        error,
        "CREATE_FAILED",
        "Failed to create customer",
      );
    }
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateCustomerInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const customer = await customerWriteService.update(data);
      return ok("Customer updated successfully", customer);
    } catch (error) {
      if (error instanceof CustomerWriteError) {
        if (error.code === "ACCOUNT_EMAIL_LOCKED") {
          return {
            success: false as const,
            message: error.message,
            data: null,
            errors: {
              email: [
                "Change this email through the authenticated account email flow.",
              ],
            },
          };
        }
        if (error.code === "DUPLICATE_EMAIL") {
          return {
            success: false as const,
            message: error.message,
            data: null,
            errors: { email: ["This email is already in use"] },
          };
        }
        return {
          success: false as const,
          message: error.message,
          data: null,
          error: "NOT_FOUND",
        };
      }
      return failure(
        "Update customer error",
        error,
        "UPDATE_FAILED",
        "Failed to update customer",
      );
    }
  });

export const deleteCustomers = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteCustomersInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await customerWriteService.archive(input.data.ids);
      return ok(
        `${result.deleted} customer${result.deleted === 1 ? "" : "s"} archived`,
        result,
      );
    } catch (error) {
      if (error instanceof CustomerWriteError && error.code === "NOT_FOUND") {
        return {
          success: false as const,
          message: error.message,
          data: null,
          error: "NOT_FOUND",
        };
      }
      return failure(
        "Archive customers error",
        error,
        "DELETE_FAILED",
        "Failed to archive customers",
      );
    }
  });
