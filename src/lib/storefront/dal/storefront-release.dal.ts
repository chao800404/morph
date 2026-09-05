import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { paginationOf, type Pagination } from "@/lib/db/server-result";
import { withReleaseNote } from "@/lib/storefront/release-note";
import { withDeployedThemeBuildId } from "../service/theme-worker-deployment-state";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import {
  storefrontReleases,
  storefrontThemeBuilds,
  storefronts,
} from "@/db/storefront.schema";
import type { Metadata } from "@/db/json";
import type { StorefrontReleaseDTO } from "@/lib/storefront/dto/storefront-release.dto";
import { and, count, desc, eq, isNull } from "drizzle-orm";

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
        and(eq(storefronts.id, storefrontId), isNull(storefronts.deletedAt)),
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

  /**
   * Records that this release's artifact reached the Theme Worker.
   *
   * Written only after a deployment succeeded. An activated release is not
   * evidence on its own: a deploy can fail after activation, and treating the
   * two as the same thing would let a later publish skip a deployment that
   * never landed.
   */
  async recordDeployedThemeBuild(data: {
    storefrontId: string;
    releaseId: string;
    themeBuildId: string;
  }): Promise<boolean> {
    const db = await getDb();
    const [row] = await db
      .select({ metadata: storefrontReleases.metadata })
      .from(storefrontReleases)
      .where(
        and(
          eq(storefrontReleases.id, data.releaseId),
          eq(storefrontReleases.storefrontId, data.storefrontId),
          isNull(storefrontReleases.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return false;

    // No driver-specific result shape is read here. This runs after a
    // deployment has already succeeded, so a throw would turn a published,
    // deployed release into a reported failure — over a bookkeeping write
    // against a row whose existence was just confirmed.
    await db
      .update(storefrontReleases)
      .set({
        metadata: withDeployedThemeBuildId(
          row.metadata ?? null,
          data.themeBuildId,
        ),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(storefrontReleases.id, data.releaseId),
          eq(storefrontReleases.storefrontId, data.storefrontId),
          isNull(storefrontReleases.deletedAt),
        ),
      );
    return true;
  },

  /**
   * One page of release history, with the count the pager needs.
   *
   * The total is read alongside the page rather than inferred from the row
   * count: a full page is indistinguishable from the last page without it, so
   * the pager cannot say whether a next page exists.
   */
  async listHistory(
    storefrontId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{
    releases: StorefrontReleaseDTO[];
    pagination: Pagination;
  }> {
    const db = await getDb();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);
    const scope = and(
      eq(storefrontReleases.storefrontId, storefrontId),
      isNull(storefrontReleases.deletedAt),
    );

    const [rows, [counted]] = await Promise.all([
      db
        .select()
        .from(storefrontReleases)
        .where(scope)
        .orderBy(desc(storefrontReleases.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(storefrontReleases).where(scope),
    ]);

    const total = counted?.total ?? 0;
    return {
      releases: rows.map(mapReleaseRowToDTO),
      pagination: paginationOf(total, Math.floor(offset / limit) + 1, limit),
    };
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
      const result = await env.DATABASE.prepare(
        `
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
                      AND pg.storefront_id = r.storefront_id
                  ))
                )
              )
          )
      `,
      )
        .bind(data.releaseId, now, data.storefrontId, expected, data.releaseId)
        .run();
      const changes =
        (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
      if (changes !== 1)
        throw new Error(
          "RELEASE_ACTIVATION_CONFLICT: Active release changed concurrently or target release is no longer activatable.",
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        throw new Error(
          "RELEASE_ACTIVATION_CONFLICT: Active release changed concurrently or target release is no longer activatable.",
        );
      }
      throw error;
    }

    const activated = await this.getById(data.storefrontId, data.releaseId);
    if (!activated) {
      throw new Error(
        "RELEASE_ACTIVATION_FAILED: Activated release was not found after the atomic switch.",
      );
    }
    return activated;
  },

  /**
   * Rewrites what a release says it was for.
   *
   * Only the note changes: a release points at an immutable build and content
   * publication, and renaming must not become a way to alter what is served.
   * Scoped by storefront so a release id alone never authorises the write.
   */
  /**
   * Replaces a release's metadata wholesale.
   *
   * Separate from `renameRelease` because the caller here is the queue, which
   * has already merged what it is changing into the metadata it read. Still
   * scoped by storefront, and still touches nothing but `metadata`: a release
   * points at an immutable build, and no write here may alter what is served.
   */
  async setReleaseMetadata(data: {
    storefrontId: string;
    releaseId: string;
    metadata: Metadata | null;
  }): Promise<void> {
    const db = await getDb();
    await db
      .update(storefrontReleases)
      .set({ metadata: data.metadata, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(storefrontReleases.id, data.releaseId),
          eq(storefrontReleases.storefrontId, data.storefrontId),
          isNull(storefrontReleases.deletedAt),
        ),
      );
  },

  async renameRelease(data: {
    storefrontId: string;
    releaseId: string;
    note: string;
  }): Promise<StorefrontReleaseDTO> {
    const existing = await this.getById(data.storefrontId, data.releaseId);
    if (!existing) {
      throw new Error(
        `RELEASE_NOT_FOUND: Release "${data.releaseId}" was not found for this storefront.`,
      );
    }

    const db = await getDb();
    const [updated] = await db
      .update(storefrontReleases)
      .set({
        metadata: withReleaseNote(existing.metadata, data.note),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(storefrontReleases.id, data.releaseId),
          eq(storefrontReleases.storefrontId, data.storefrontId),
          isNull(storefrontReleases.deletedAt),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error(
        `RELEASE_NOT_FOUND: Release "${data.releaseId}" was not found for this storefront.`,
      );
    }
    return mapReleaseRowToDTO(updated);
  },

  /**
   * Claims the storefront's deployment slot, or reports it already taken.
   *
   * One conditional statement: reading the holder and then writing it would
   * leave the same gap between check and act that the activation CAS already
   * leaves around the deploy. Expiry is diagnostic only: the upload API cannot
   * fence a stale writer, so elapsed time never proves the old upload stopped.
   * An abandoned owner requires verified operational recovery, not takeover.
   */
  async acquireDeploymentLease(args: {
    storefrontId: string;
    owner: string;
    expiresAt: number;
    now: number;
  }): Promise<boolean> {
    const result = await env.DATABASE.prepare(
      `
      UPDATE storefronts
      SET deployment_lease_owner = ?1, deployment_lease_expires_at = ?2
      WHERE id = ?3
        AND deleted_at IS NULL
        AND deployment_lease_owner IS NULL
    `,
    )
      .bind(args.owner, args.expiresAt, args.storefrontId)
      .run();

    return (result.meta?.changes ?? 0) > 0;
  },

  /** Releases the lease only if this owner still holds it. */
  async releaseDeploymentLease(args: {
    storefrontId: string;
    owner: string;
  }): Promise<void> {
    await env.DATABASE.prepare(
      `
      UPDATE storefronts
      SET deployment_lease_owner = NULL, deployment_lease_expires_at = NULL
      WHERE id = ?1 AND deployment_lease_owner = ?2
    `,
    )
      .bind(args.storefrontId, args.owner)
      .run();
  },
};
