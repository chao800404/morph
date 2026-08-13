import { getDb } from "@/db";
import { users } from "@/db/auth.schema";
import { eq } from "drizzle-orm";

export const adminStatusDal = {
  async exists() {
    const db = await getDb();
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);
    return Boolean(admin);
  },
};
