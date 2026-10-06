import { getDb } from "@/db";
import { users } from "@/db/auth.schema";
import {
  storefrontBuildPreviewCapabilities,
  storefrontThemeBuilds,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontThemeBuildStatus } from "@/db/storefront.schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Everything one Build Preview request is checked against, read in one query:
 * the capability, the build it names, that build's Theme and the user who
 * holds it. Left joins, so that a build, Theme or user that is gone reads as
 * missing here and is refused by the caller rather than dropping the row.
 */
export type BuildPreviewCapabilityRecord = Readonly<{
  id: string;
  storefrontId: string;
  themeId: string;
  buildId: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  build: Readonly<{
    storefrontId: string;
    themeId: string;
    status: StorefrontThemeBuildStatus;
    artifactPrefix: string | null;
    contentPublicationId: string | null;
  }> | null;
  themeLive: boolean;
  user: Readonly<{ role: string | null; banned: boolean }> | null;
}>;

export const storefrontBuildPreviewCapabilityDal = {
  /**
   * Stores a new capability and revokes the ones the same user already held
   * for the same build, so that one user has at most one live address per
   * build. Revocation runs first: if the insert then fails, the user has none
   * and asks again, which is the safe way round.
   */
  async issue(data: {
    id: string;
    tokenHash: string;
    storefrontId: string;
    themeId: string;
    buildId: string;
    userId: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    const db = await getDb();
    await db
      .update(storefrontBuildPreviewCapabilities)
      .set({ revokedAt: data.now, updatedAt: data.now })
      .where(
        and(
          eq(storefrontBuildPreviewCapabilities.buildId, data.buildId),
          eq(storefrontBuildPreviewCapabilities.userId, data.userId),
          isNull(storefrontBuildPreviewCapabilities.revokedAt),
          isNull(storefrontBuildPreviewCapabilities.deletedAt),
        ),
      );
    await db.insert(storefrontBuildPreviewCapabilities).values({
      id: data.id,
      tokenHash: data.tokenHash,
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      buildId: data.buildId,
      userId: data.userId,
      expiresAt: data.expiresAt,
      createdAt: data.now,
      updatedAt: data.now,
    });
  },

  async findByTokenHash(
    tokenHash: string,
  ): Promise<BuildPreviewCapabilityRecord | null> {
    const db = await getDb();
    const [row] = await db
      .select({
        capability: storefrontBuildPreviewCapabilities,
        build: {
          id: storefrontThemeBuilds.id,
          storefrontId: storefrontThemeBuilds.storefrontId,
          themeId: storefrontThemeBuilds.themeId,
          status: storefrontThemeBuilds.status,
          artifactPrefix: storefrontThemeBuilds.artifactPrefix,
          contentPublicationId: storefrontThemeBuilds.contentPublicationId,
        },
        themeId: storefrontThemes.id,
        user: { id: users.id, role: users.role, banned: users.banned },
      })
      .from(storefrontBuildPreviewCapabilities)
      .leftJoin(
        storefrontThemeBuilds,
        and(
          eq(
            storefrontThemeBuilds.id,
            storefrontBuildPreviewCapabilities.buildId,
          ),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .leftJoin(
        storefrontThemes,
        and(
          eq(storefrontThemes.id, storefrontBuildPreviewCapabilities.themeId),
          eq(
            storefrontThemes.storefrontId,
            storefrontBuildPreviewCapabilities.storefrontId,
          ),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .leftJoin(users, eq(users.id, storefrontBuildPreviewCapabilities.userId))
      .where(
        and(
          eq(storefrontBuildPreviewCapabilities.tokenHash, tokenHash),
          isNull(storefrontBuildPreviewCapabilities.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { capability, build, user } = row;
    return {
      id: capability.id,
      storefrontId: capability.storefrontId,
      themeId: capability.themeId,
      buildId: capability.buildId,
      userId: capability.userId,
      expiresAt: capability.expiresAt,
      revokedAt: capability.revokedAt,
      build: build?.id
        ? {
            storefrontId: build.storefrontId,
            themeId: build.themeId,
            status: build.status,
            artifactPrefix: build.artifactPrefix,
            contentPublicationId: build.contentPublicationId,
          }
        : null,
      themeLive: Boolean(row.themeId),
      user: user?.id
        ? { role: user.role ?? null, banned: Boolean(user.banned) }
        : null,
    };
  },

  /** Revokes one capability, only for the user who holds it. */
  async revoke(data: {
    tokenHash: string;
    userId: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const revoked = await db
      .update(storefrontBuildPreviewCapabilities)
      .set({ revokedAt: data.now, updatedAt: data.now })
      .where(
        and(
          eq(storefrontBuildPreviewCapabilities.tokenHash, data.tokenHash),
          eq(storefrontBuildPreviewCapabilities.userId, data.userId),
          isNull(storefrontBuildPreviewCapabilities.revokedAt),
          isNull(storefrontBuildPreviewCapabilities.deletedAt),
        ),
      )
      .returning({ id: storefrontBuildPreviewCapabilities.id });
    return revoked.length > 0;
  },
};

export type StorefrontBuildPreviewCapabilityDAL =
  typeof storefrontBuildPreviewCapabilityDal;
