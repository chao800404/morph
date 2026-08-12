import { safeNameSchema, safePasswordSchema } from "./common";
import { listParamsSchema } from "./commerce";
import { z } from "zod";

const inviteTokenSchema = z.string().trim().min(32).max(256);

export const createInviteInputSchema = z.object({
  email: z
    .email("Enter a valid email address")
    .transform((value) => value.trim().toLowerCase()),
});

export const listDashboardInvitesInputSchema = listParamsSchema(
  ["email", "createdAt", "updatedAt"],
  { sortBy: "createdAt" },
);

export const deleteDashboardInviteInputSchema = z.object({
  ids: z.array(z.uuid("Invalid invitation ID")).min(1).max(50),
});

export const getInviteInputSchema = z.object({ token: inviteTokenSchema });

export const acceptInviteInputSchema = z
  .object({
    token: inviteTokenSchema,
    name: safeNameSchema,
    password: safePasswordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
