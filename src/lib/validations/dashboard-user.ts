import { z } from "zod";
import { listParamsSchema } from "./commerce";
import { metadataInputSchema } from "./product";

export const listDashboardUsersInputSchema = listParamsSchema(
  ["name", "email", "firstName", "lastName", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);

const dashboardUserIdSchema = z
  .string()
  .trim()
  .min(1, "Invalid user ID")
  .max(128, "Invalid user ID");

export const updateDashboardUserInputSchema = z.object({
  id: dashboardUserIdSchema,
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
});

export const getDashboardUserInputSchema = z.object({
  id: dashboardUserIdSchema,
});

export const updateDashboardUserMetadataInputSchema = z.object({
  id: dashboardUserIdSchema,
  metadata: metadataInputSchema,
});
