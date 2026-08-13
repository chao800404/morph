import { adminStatusDal } from "@/lib/user/dal/admin-status.dal";
import { createMiddleware } from "@tanstack/react-start";

export const ensureNoAdmin = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    if (await adminStatusDal.exists()) {
      throw new Error("Admin already exists");
    }

    return next();
  },
);
