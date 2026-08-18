import { getDb } from "@/db";
import { storefrontReleases, storefronts } from "@/db/storefront.schema";
import type { StorefrontReleaseDTO } from "@/lib/storefront/dto/storefront-release.dto";
import { and, eq, isNull } from "drizzle-orm";

function mapReleaseRowToDTO(
  row: typeof storefrontReleases.$inferSelect,
): StorefrontReleaseDTO {
  return {
    id: row.id,
    storefrontId: row.storefrontId,
    themeId: row.themeId,
    sourceRevisionId: row.sourceRevisionId,
    themeBuildId: row.themeBuildId,
    status: row.status,
    metadata: row.metadata,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const storefrontReleaseDal = {
  async getById(
    storefrontId: string,
    releaseId: string,
  ): Promise<StorefrontReleaseDTO | null> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.id, releaseId),
          eq(storefrontReleases.storefrontId, storefrontId),
          isNull(storefrontReleases.deletedAt),
        ),
      )
      .limit(1);

    return row ? mapReleaseRowToDTO(row) : null;
  },

  async getActive(storefrontId: string): Promise<StorefrontReleaseDTO | null> {
    const db = await getDb();
    const [storefront] = await db
      .select({ activeReleaseId: storefronts.activeReleaseId })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.id, storefrontId),
          isNull(storefronts.deletedAt),
        ),
      )
      .limit(1);

    if (!storefront?.activeReleaseId) return null;

    const [row] = await db
      .select()
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.id, storefront.activeReleaseId),
          eq(storefrontReleases.storefrontId, storefrontId),
          eq(storefrontReleases.status, "active"),
          isNull(storefrontReleases.deletedAt),
        ),
      )
      .limit(1);

    return row ? mapReleaseRowToDTO(row) : null;
  },
};
