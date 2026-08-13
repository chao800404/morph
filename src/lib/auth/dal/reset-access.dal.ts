import { getDb } from "@/db";
import { verifications } from "@/db/auth.schema";
import {
  createResetAccessToken,
  hashResetAccessToken,
  RESET_ACCESS_MAX_AGE_SECONDS,
  resetAccessIdentifier,
} from "@/lib/auth/reset-access-token";
import { and, eq, like, lt } from "drizzle-orm";

const identifierPrefix = "reset-access:%";

export const resetAccessDal = {
  async issue(email: string) {
    const db = await getDb();
    const token = createResetAccessToken();
    const identifier = resetAccessIdentifier(await hashResetAccessToken(token));
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + RESET_ACCESS_MAX_AGE_SECONDS * 1000,
    );

    await db.batch([
      db
        .delete(verifications)
        .where(
          and(
            like(verifications.identifier, identifierPrefix),
            eq(verifications.value, email),
          ),
        ),
      db.insert(verifications).values({
        id: crypto.randomUUID(),
        identifier,
        value: email,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      }),
      db
        .delete(verifications)
        .where(
          and(
            like(verifications.identifier, identifierPrefix),
            lt(verifications.expiresAt, now),
          ),
        ),
    ]);

    return { token, expiresAt: expiresAt.getTime() };
  },

  async resolve(token: string) {
    const db = await getDb();
    const identifier = resetAccessIdentifier(await hashResetAccessToken(token));
    const [record] = await db
      .select({
        email: verifications.value,
        expiresAt: verifications.expiresAt,
      })
      .from(verifications)
      .where(eq(verifications.identifier, identifier))
      .limit(1);

    if (!record) return null;
    if (record.expiresAt.getTime() <= Date.now()) {
      await db
        .delete(verifications)
        .where(eq(verifications.identifier, identifier));
      return null;
    }
    return { email: record.email, expiresAt: record.expiresAt.getTime() };
  },

  async revoke(token: string) {
    const db = await getDb();
    const identifier = resetAccessIdentifier(await hashResetAccessToken(token));
    await db
      .delete(verifications)
      .where(eq(verifications.identifier, identifier));
  },
};
