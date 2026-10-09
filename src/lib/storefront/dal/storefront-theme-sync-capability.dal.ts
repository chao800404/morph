import { getDb } from "@/db";
import { users } from "@/db/auth.schema";
import {
  storefrontThemeSyncCapabilities,
  storefrontThemes,
} from "@/db/storefront.schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Everything one local-sync request is checked against, read in one query:
 * the capability, its Theme and the user who holds it. Left joins, so that a
 * Theme or user that is gone reads as missing here and is refused by the
 * caller rather than dropping the row.
 */
export type ThemeSyncCapabilityRecord = Readonly<{
  id: string;
  storefrontId: string;
  themeId: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  themeLive: boolean;
  user: Readonly<{ role: string | null; banned: boolean }> | null;
}>;

export const storefrontThemeSyncCapabilityDal = {
  /**
   * Stores a new capability and revokes the ones the same user already held
   * for the same Theme, so one user has at most one live local link per
   * Theme. Revocation runs first: if the insert then fails, the user has none
   * and asks again, which is the safe way round.
   */
  async issue(data: {
    id: string;
    tokenHash: string;
    storefrontId: string;
    themeId: string;
    userId: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    const db = await getDb();
    await db
      .update(storefrontThemeSyncCapabilities)
      .set({ revokedAt: data.now, updatedAt: data.now })
      .where(
        and(
          eq(storefrontThemeSyncCapabilities.themeId, data.themeId),
          eq(storefrontThemeSyncCapabilities.userId, data.userId),
          isNull(storefrontThemeSyncCapabilities.revokedAt),
          isNull(storefrontThemeSyncCapabilities.deletedAt),
        ),
      );
    await db.insert(storefrontThemeSyncCapabilities).values({
      id: data.id,
      tokenHash: data.tokenHash,
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      userId: data.userId,
      expiresAt: data.expiresAt,
      createdAt: data.now,
      updatedAt: data.now,
    });
  },

  async findByTokenHash(
    tokenHash: string,
  ): Promise<ThemeSyncCapabilityRecord | null> {
    const db = await getDb();
    const [row] = await db
      .select({
        capability: storefrontThemeSyncCapabilities,
        themeId: storefrontThemes.id,
        user: { id: users.id, role: users.role, banned: users.banned },
      })
      .from(storefrontThemeSyncCapabilities)
      .leftJoin(
        storefrontThemes,
        and(
          eq(storefrontThemes.id, storefrontThemeSyncCapabilities.themeId),
          eq(
            storefrontThemes.storefrontId,
            storefrontThemeSyncCapabilities.storefrontId,
          ),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .leftJoin(users, eq(users.id, storefrontThemeSyncCapabilities.userId))
      .where(
        and(
          eq(storefrontThemeSyncCapabilities.tokenHash, tokenHash),
          isNull(storefrontThemeSyncCapabilities.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { capability, user } = row;
    return {
      id: capability.id,
      storefrontId: capability.storefrontId,
      themeId: capability.themeId,
      userId: capability.userId,
      expiresAt: capability.expiresAt,
      revokedAt: capability.revokedAt,
      themeLive: Boolean(row.themeId),
      user: user?.id
        ? { role: user.role ?? null, banned: Boolean(user.banned) }
        : null,
    };
  },

  /** Revokes one capability by its own token; what `morph-sync logout` does. */
  async revoke(data: { tokenHash: string; now: string }): Promise<boolean> {
    const db = await getDb();
    const revoked = await db
      .update(storefrontThemeSyncCapabilities)
      .set({ revokedAt: data.now, updatedAt: data.now })
      .where(
        and(
          eq(storefrontThemeSyncCapabilities.tokenHash, data.tokenHash),
          isNull(storefrontThemeSyncCapabilities.revokedAt),
          isNull(storefrontThemeSyncCapabilities.deletedAt),
        ),
      )
      .returning({ id: storefrontThemeSyncCapabilities.id });
    return revoked.length > 0;
  },
};

export type StorefrontThemeSyncCapabilityDAL =
  typeof storefrontThemeSyncCapabilityDal;
