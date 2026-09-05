import { env } from "cloudflare:workers";
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

  /**
   * Promotes exactly one user to the first admin, or reports that someone else
   * already is.
   *
   * Checking "is there an admin?" and then creating one are two statements, and
   * between them a second bootstrap request can pass the same check: two
   * different emails both become admin, which unique email does not prevent.
   * The condition therefore has to be part of the write.
   *
   * SQLite evaluates this single statement atomically, so of two concurrent
   * callers one updates a row and the other matches nothing — `changes` is what
   * says which happened.
   */
  async claimFirstAdmin(userId: string): Promise<boolean> {
    const result = await env.DATABASE.prepare(
      `
      UPDATE users
      SET role = 'admin'
      WHERE id = ?1
        AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
    `,
    )
      .bind(userId)
      .run();

    return (result.meta?.changes ?? 0) > 0;
  },

  /** Removes an account that lost the bootstrap race, so a retry is clean. */
  async deleteUser(userId: string): Promise<void> {
    const db = await getDb();
    await db.delete(users).where(eq(users.id, userId));
  },
};
