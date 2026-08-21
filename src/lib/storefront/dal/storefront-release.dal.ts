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
      const result = await env.DATABASE.prepare(`
        UPDATE storefronts SET active_release_id = ?1, updated_at = ?2
        WHERE id = ?3 AND deleted_at IS NULL
          AND (active_release_id = ?4 OR (active_release_id IS NULL AND ?4 = ''))
          AND EXISTS (
            SELECT 1 FROM storefront_releases r
            INNER JOIN storefront_theme_builds b ON b.id = r.theme_build_id
            INNER JOIN storefront_content_publications p ON p.id = r.content_publication_id
              AND p.storefront_id = r.storefront_id AND p.deleted_at IS NULL
            WHERE r.id = ?5 AND r.storefront_id = ?3 AND r.status = 'available'
              AND r.deleted_at IS NULL AND b.status = 'succeeded'
              AND b.artifact_prefix IS NOT NULL AND b.manifest_json IS NOT NULL
              AND b.deleted_at IS NULL AND r.content_publication_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM storefront_content_publication_items i
                WHERE i.publication_id = p.id AND (
                  i.deleted_at IS NOT NULL OR i.item_type NOT IN ('template', 'page')
                  OR TRIM(i.content_id) = '' OR TRIM(i.revision_id) = ''
                  OR (i.item_type = 'template' AND NOT EXISTS (
                    SELECT 1 FROM storefront_theme_template_revisions tr
                    INNER JOIN storefront_theme_templates t ON t.id = tr.template_id
                    INNER JOIN storefront_themes th ON th.id = t.theme_id
                    WHERE tr.id = i.revision_id AND tr.template_id = i.content_id
                      AND th.storefront_id = r.storefront_id AND t.deleted_at IS NULL AND th.deleted_at IS NULL
                  ))
                  OR (i.item_type = 'page' AND NOT EXISTS (
                    SELECT 1 FROM storefront_page_revisions pr
                    INNER JOIN storefront_pages pg ON pg.id = pr.page_id
                    WHERE pr.id = i.revision_id AND pr.page_id = i.content_id
                      AND pg.storefront_id = r.storefront_id AND pg.deleted_at IS NULL
                  ))
                )
              )
          )
      `).bind(data.releaseId, now, data.storefrontId, expected, data.releaseId).run();
      const changes = (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      if (changes !== 1) throw new Error("RELEASE_ACTIVATION_CONFLICT: Active release changed concurrently or target release is no longer activatable.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("malformed JSON") || message.includes("constraint")) {
        throw new Error("RELEASE_ACTIVATION_CONFLICT: Active release changed concurrently or target release is no longer activatable.");
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
