import { getDb } from "@/db";
import { users } from "@/db/auth.schema";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

export const checkHasAdminServerFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const db = await getDb();
  const admin = await db
    .select()
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(1);
  return admin.length > 0;
});
