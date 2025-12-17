import { getDb } from "@/db";
import { users } from "@/db/auth.schema";
import { createMiddleware } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

export const ensureNoAdmin = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const db = await getDb();
    const admin = await db
      .select()
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);

    if (admin.length > 0) {
      throw new Error("Admin already exists");
    }

    return next();
  },
);
