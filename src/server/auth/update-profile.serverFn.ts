import { ActionState } from "@/components/dialog/dialog-create-wrapper";
import { profileSchema } from "@/lib/validations/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authMiddleware } from "../middleware/auth.middleware";

export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const result = profileSchema.safeParse(data);

    if (!result.success) {
      const firstIssue = result.error.issues[0];
      throw new Error(firstIssue.message);
    }
    return result.data;
  })
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
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
        } as any,
      });

      return {
        success: true,
        message: "Profile updated successfully",
      } as ActionState;
    } catch (error: any) {
      console.error("Update Profile Error:", error);
      return {
        success: false,
        message: error.message || "Failed to update profile",
      } as ActionState;
    }
  });
