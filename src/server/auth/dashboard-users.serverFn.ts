import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { dashboardUserDal } from "@/lib/user/dal/dashboard-user.dal";
import {
  getDashboardUserInputSchema,
  listDashboardUsersInputSchema,
  updateDashboardUserInputSchema,
  updateDashboardUserMetadataInputSchema,
} from "@/lib/validations/dashboard-user";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { userAdminMiddleware } from "../middleware/auth.middleware";

export const listDashboardUsers = createServerFn({ method: "POST" })
  .validator((data: unknown) => listDashboardUsersInputSchema.parse(data ?? {}))
  .middleware([userAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await dashboardUserDal.listPage({
        ...data,
        query: data.query ?? undefined,
      });
      return ok("Users fetched successfully", {
        users: page.users,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List dashboard users error",
        error,
        "LIST_FAILED",
        "Failed to fetch users",
      );
    }
  });

export const updateDashboardUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateDashboardUserInputSchema.parse(data))
  .middleware([userAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const name = [data.firstName, data.lastName].filter(Boolean).join(" ");
      const user = await context.auth.api.adminUpdateUser({
        body: { userId: data.id, data: { name } },
        headers: getRequest().headers,
      });
      return ok("User updated successfully", {
        id: user.id,
        name: user.name,
        email: user.email,
      });
    } catch (error) {
      return failure(
        "Update dashboard user error",
        error,
        "UPDATE_FAILED",
        "Failed to update user",
      );
    }
  });

export const getDashboardUser = createServerFn({ method: "POST" })
  .validator((data: unknown) => getDashboardUserInputSchema.parse(data))
  .middleware([userAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const user = await dashboardUserDal.findStaffById(data.id);
      if (!user) return fail("User not found", { error: "NOT_FOUND" });
      return ok("User fetched successfully", user);
    } catch (error) {
      return failure(
        "Get dashboard user error",
        error,
        "GET_FAILED",
        "Failed to fetch user",
      );
    }
  });

export const updateDashboardUserMetadata = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    updateDashboardUserMetadataInputSchema.parse(data),
  )
  .middleware([userAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const user = await dashboardUserDal.findStaffById(data.id);
      if (!user) return fail("User not found", { error: "NOT_FOUND" });
      await dashboardUserDal.updateMetadata(data.id, data.metadata);
      return ok("User metadata updated successfully", { id: data.id });
    } catch (error) {
      return failure(
        "Update dashboard user metadata error",
        error,
        "UPDATE_FAILED",
        "Failed to update user metadata",
      );
    }
  });
