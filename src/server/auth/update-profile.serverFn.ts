import { ActionState } from "@/components/dialog/dialog-create-wrapper";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { zfd } from "zod-form-data";
import { authMiddleware } from "../middleware/auth.middleware";

const profileSchema = zfd.formData({
  name: zfd.text(),
  language: zfd.text().optional(),
  phone: zfd.text().optional(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator(profileSchema)
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
          phoneNumber: data.phone,
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
