import { createFirstAdminSchema } from "@/lib/validations/auth";
import { createServerFn } from "@tanstack/react-start";
import { ensureNoAdmin } from "../middleware/ensureNoAdmin.middleware";
import { getAuthWithAdmin } from "./helpers";

export const createFirstAdminServerFn = createServerFn({
  method: "POST",
})
  .middleware([ensureNoAdmin])
  .validator(createFirstAdminSchema)
  .handler(async ({ data }) => {
    const auth = getAuthWithAdmin();

    // The admin plugin endpoint resolves to a `Response`-shaped object. Only
    // the created user is safe to hand back across the server boundary.
    const created = await auth.api.createUser({
      body: {
        email: data.email,
        password: data.password,
        name: data.name,
        role: "admin",
      },
    });

    if (!created?.user) {
      return {
        success: false as const,
        message: "Failed to create admin user",
      };
    }

    return {
      success: true as const,
      user: {
        id: created.user.id,
        email: created.user.email,
        name: created.user.name,
      },
    };
  });
