import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import {
  storefrontReleases,
  storefrontThemeBuilds,
  storefronts,
} from "@/db/storefront.schema";
import type { StorefrontReleaseDTO } from "@/lib/storefront/dto/storefront-release.dto";
import { and, desc, eq, isNull } from "drizzle-orm";

function mapReleaseRowToDTO(
  row: typeof storefrontReleases.$inferSelect,
): StorefrontReleaseDTO {
  return {
    id: row.id,
    storefrontId: row.storefrontId,
    themeId: row.themeId,
    sourceRevisionId: row.sourceRevisionId,
    themeBuildId: row.themeBuildId,
    contentPublicationId: row.contentPublicationId,
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
          eq(storefrontReleases.status, "available"),
          isNull(storefrontReleases.deletedAt),
        ),
      )
      .limit(1);

    return row ? mapReleaseRowToDTO(row) : null;
  },

  async listHistory(
    storefrontId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<StorefrontReleaseDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.storefrontId, storefrontId),
          isNull(storefrontReleases.deletedAt),
        ),
      )
      .orderBy(desc(storefrontReleases.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 100))
      .offset(Math.max(options.offset ?? 0, 0));
    return rows.map(mapReleaseRowToDTO);
  },

  /** Atomically switches the production pointer to an existing release. */
  async activateRelease(data: {
    storefrontId: string;
    releaseId: string;
    expectedActiveReleaseId: string | null;
  }): Promise<StorefrontReleaseDTO> {
    const db = await getDb();
    const [target] = await db
      .select({
        id: storefrontReleases.id,
        storefrontId: storefrontReleases.storefrontId,
        status: storefrontReleases.status,
        buildStatus: storefrontThemeBuilds.status,
        artifactPrefix: storefrontThemeBuilds.artifactPrefix,
        manifestJson: storefrontThemeBuilds.manifestJson,
        contentPublicationId: storefrontReleases.contentPublicationId,
      })
      .from(storefrontReleases)
      .innerJoin(
        storefrontThemeBuilds,
        eq(storefrontReleases.themeBuildId, storefrontThemeBuilds.id),
      )
      .where(
        and(
          eq(storefrontReleases.id, data.releaseId),
          eq(storefrontReleases.storefrontId, data.storefrontId),
          eq(storefrontReleases.status, "available"),
          isNull(storefrontReleases.deletedAt),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .limit(1);
    if (
      !target ||
      target.buildStatus !== "succeeded" ||
      !target.artifactPrefix ||
      !target.manifestJson ||
      !target.contentPublicationId
    ) {
      throw new Error(
        "RELEASE_NOT_ACTIVATABLE: Release must reference an available release with a succeeded immutable build artifact and ContentPublication.",
      );
    }

    try {
      await storefrontContentPublicationDal.assertValidForRelease({
        storefrontId: data.storefrontId,
        publicationId: target.contentPublicationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error("RELEASE_NOT_ACTIVATABLE: " + message);
    }

    const expected = data.expectedActiveReleaseId ?? "";
    const now = new Date().toISOString();
    try {
      await env.DATABASE.batch([
        env.DATABASE.prepare(`
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM storefronts
            WHERE id = ?1
              AND deleted_at IS NULL
              AND (active_release_id = ?2 OR (active_release_id IS NULL AND ?2 = ''))
          ) AND EXISTS (
            SELECT 1 FROM storefront_releases r
            INNER JOIN storefront_theme_builds b ON b.id = r.theme_build_id
            WHERE r.id = ?3
              AND r.storefront_id = ?1
              AND r.status = 'available'
              AND r.deleted_at IS NULL
              AND b.status = 'succeeded'
              AND b.artifact_prefix IS NOT NULL
              AND b.manifest_json IS NOT NULL
              AND b.deleted_at IS NULL
              AND r.content_publication_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM storefront_content_publications p
                WHERE p.id = r.content_publication_id
                  AND p.storefront_id = r.storefront_id
                  AND p.deleted_at IS NULL
              )
          ) THEN 1 ELSE json('') END AS ok
        `).bind(data.storefrontId, expected, data.releaseId),
        env.DATABASE.prepare(`
          UPDATE storefronts
          SET active_release_id = ?1, updated_at = ?2
          WHERE id = ?3 AND deleted_at IS NULL
        `).bind(data.releaseId, now, data.storefrontId),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        throw new Error(
          "RELEASE_ACTIVATION_CONFLICT: Active release changed concurrently or target release is no longer activatable.",
        );
      }
      throw error;
    }

    const activated = await this.getById(data.storefrontId, data.releaseId);
    if (!activated) {
      throw new Error("RELEASE_ACTIVATION_FAILED: Activated release was not found after the atomic switch.");
    }
    return activated;
  },
};
