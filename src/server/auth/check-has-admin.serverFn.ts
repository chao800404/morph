import { adminStatusDal } from "@/lib/user/dal/admin-status.dal";
import { createServerFn } from "@tanstack/react-start";

export const checkHasAdminServerFn = createServerFn({
  method: "GET",
}).handler(() => adminStatusDal.exists());
