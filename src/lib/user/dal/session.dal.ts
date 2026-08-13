import { getDb } from "@/db";
import { sessions } from "@/db/auth.schema";
import { eq } from "drizzle-orm";

export interface RevocableSessionDTO {
  userId: string;
  token: string;
}

export const sessionDal = {
  async findRevocableById(id: string): Promise<RevocableSessionDTO | null> {
    const db = await getDb();
    const row = await db
      .select({ userId: sessions.userId, token: sessions.token })
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();

    return row ?? null;
  },
};
