import { customerGroupDal } from "@/lib/customer/dal/customer-group.dal";
import { fail, failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import {
  addCustomersToGroupInputSchema,
  createCustomerGroupInputSchema,
  customerGroupIdInputSchema,
  listCustomerGroupMembersInputSchema,
  listCustomerGroupsInputSchema,
  removeCustomerFromGroupInputSchema,
  updateCustomerGroupInputSchema,
} from "@/lib/validations/customer";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listCustomerGroups = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listCustomerGroupsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await customerGroupDal.listPage(input.data);
      return ok("Customer groups fetched successfully", {
        groups: page.groups,
        pagination: paginationOf(
          page.total,
          input.data.page,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List customer groups error",
        error,
        "LIST_FAILED",
        "Failed to fetch customer groups",
      );
    }
  });

export const getCustomerGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(customerGroupIdInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const group = await customerGroupDal.findById(input.data.id);
      return group
        ? ok("Customer group fetched successfully", group)
        : fail("Customer group not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get customer group error",
        error,
        "GET_FAILED",
        "Failed to fetch customer group",
      );
    }
  });

export const listCustomerGroupMembers = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listCustomerGroupMembersInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await customerGroupDal.listMembersPage(input.data);
      return ok("Customer group members fetched successfully", {
        customers: page.customers,
        pagination: paginationOf(
          page.total,
          input.data.page,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List customer group members error",
        error,
        "LIST_FAILED",
        "Failed to fetch customer group members",
      );
    }
  });

export const createCustomerGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createCustomerGroupInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const { name, metadata } = input.data;
    try {
      if (await customerGroupDal.findActiveByName(name)) {
        return fail("A customer group with this name already exists", {
          errors: { name: ["This name is already in use"] },
        });
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await customerGroupDal.create({
        id,
        name,
        metadata,
        createdBy: context.user.id,
        now,
      });
      return ok("Customer group created successfully", { id });
    } catch (error) {
      return failure(
        "Create customer group error",
        error,
        "CREATE_FAILED",
        "Failed to create customer group",
      );
    }
  });

export const updateCustomerGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateCustomerGroupInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const { id, name, metadata } = input.data;
    try {
      const existing = await customerGroupDal.findById(id);
      if (!existing) return fail("Customer group not found", { error: "NOT_FOUND" });
      if (name && name !== existing.name && (await customerGroupDal.findActiveByName(name))) {
        return fail("A customer group with this name already exists", {
          errors: { name: ["This name is already in use"] },
        });
      }
      const updated = await customerGroupDal.update(
        id,
        {
          ...(name !== undefined ? { name } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
        },
        new Date().toISOString(),
      );
      return updated
        ? ok("Customer group updated successfully", { id })
        : fail("Customer group not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Update customer group error",
        error,
        "UPDATE_FAILED",
        "Failed to update customer group",
      );
    }
  });

export const deleteCustomerGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(customerGroupIdInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const deleted = await customerGroupDal.softDelete(
        input.data.id,
        new Date().toISOString(),
      );
      return deleted
        ? ok("Customer group archived successfully", { id: input.data.id })
        : fail("Customer group not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Archive customer group error",
        error,
        "DELETE_FAILED",
        "Failed to archive customer group",
      );
    }
  });

export const addCustomersToGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(addCustomersToGroupInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await customerGroupDal.addCustomers({
        ...input.data,
        createdBy: context.user.id,
        now: new Date().toISOString(),
      });
      if (result === "invalid-group") {
        return fail("Customer group not found", { error: "NOT_FOUND" });
      }
      if (result === "invalid-customer") {
        return fail("One or more customers were not found", {
          error: "CUSTOMER_NOT_FOUND",
        });
      }
      return ok("Customers added or already assigned to group", {
        groupId: input.data.groupId,
      });
    } catch (error) {
      return failure(
        "Add customers to group error",
        error,
        "UPDATE_FAILED",
        "Failed to add customers to group",
      );
    }
  });

export const removeCustomerFromGroup = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(removeCustomerFromGroupInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const removed = await customerGroupDal.removeCustomer({
        ...input.data,
        now: new Date().toISOString(),
      });
      return removed
        ? ok("Customer removed from group", input.data)
        : fail("Customer group membership not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Remove customer from group error",
        error,
        "UPDATE_FAILED",
        "Failed to remove customer from group",
      );
    }
  });
