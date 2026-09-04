import { parseInput } from "@/lib/db/server-result";
import { ActionState } from "@/components/dialog/dialog-create-wrapper";
import { profileSchema } from "@/lib/validations/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authMiddleware } from "../middleware/auth.middleware";
import { getActionErrorMessage } from "@/lib/asset/action-result";

export const updateProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(profileSchema, data))
  .middleware([authMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) {
      return {
        success: false,
        message: input.message,
        errors: input.errors,
      } as ActionState;
    }
    const data = input.data;
    const request = getRequest();
    const auth = context.auth;

    try {
      // Use Better Auth's updateUser API
      await auth.api.updateUser({
        headers: request.headers,
        body: {
          name: data.name,
          language: data.language,
          phoneNumber: data.phone || null,
        },
      });

      return {
        success: true,
        message: "Profile updated successfully",
      } as ActionState;
    } catch (error) {
      console.error("Update Profile Error:", error);
      return {
        success: false,
        message: getActionErrorMessage(error, "Failed to update profile"),
      } as ActionState;
    }
  });
