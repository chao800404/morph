import { createFirstAdminSchema } from "@/lib/validations/auth";
import { createServerFn } from "@tanstack/react-start";
import { ensureNoAdmin } from "../middleware/ensureNoAdmin.middleware";
import { getAuthWithAdmin } from "./helpers";

export const createFirstAdminServerFn = createServerFn({
  method: "POST",
})
  .middleware([ensureNoAdmin])
  .inputValidator(createFirstAdminSchema)
  .handler(async ({ data }) => {
    // Get auth instance with admin plugin support
    const auth = getAuthWithAdmin();

    // Create user with admin role using type-safe admin API
    const newUser = await auth.admin.createUser({
      email: data.email,
      password: data.password,
      name: data.name,
      role: "admin",
    });

    if (!newUser) {
      return {
        success: false,
        message: "Failed to create admin user",
      };
    }

    return {
      success: true,
      user: newUser,
    };
  });
