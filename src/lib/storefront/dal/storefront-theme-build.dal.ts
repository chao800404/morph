import { getDb } from "@/db";
import {
  storefrontThemeBuilds,
  storefrontThemeRevisions,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontThemeBuildDTO } from "@/lib/storefront/dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { and, desc, eq, isNull } from "drizzle-orm";

function mapBuildRowToDTO(
  row: typeof storefrontThemeBuilds.$inferSelect,
): StorefrontThemeBuildDTO {
  return {
    id: row.id,
    storefrontId: row.storefrontId,
    themeId: row.themeId,
    sourceRevisionId: row.sourceRevisionId,
    status: row.status,
    inputHash: row.inputHash,
    compilerId: row.compilerId,
    compilerVersion: row.compilerVersion,
    artifactPrefix: row.artifactPrefix,
    manifestJson: row.manifestJson,
    diagnosticsJson: row.diagnosticsJson,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRevisionRowToDTO(
  row: typeof storefrontThemeRevisions.$inferSelect,
): StorefrontThemeRevisionDTO {
  return {
    id: row.id,
    storefrontId: row.storefrontId,
    themeId: row.themeId,
    revisionNumber: row.revisionNumber,
    message: row.message,
    source: row.source as "manual" | "ai" | "publish" | "rollback",
    snapshot: (row.snapshot ?? []) as StorefrontThemeRevisionDTO["snapshot"],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export const storefrontThemeBuildDal = {
  /**
   * Validates that theme belongs to storefront and is not deleted.
   */
  async verifyThemeOwnership(
    storefrontId: string,
    themeId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const [theme] = await db
      .select({ id: storefrontThemes.id })
      .from(storefrontThemes)
      .where(
        and(
          eq(storefrontThemes.id, themeId),
          eq(storefrontThemes.storefrontId, storefrontId),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(theme);
  },

  /**
   * Validates that the source revision exists, belongs to the exact storefrontId and themeId,
   * and is not deleted.
   */
  async verifyRevisionOwnership(
    storefrontId: string,
    themeId: string,
    sourceRevisionId: string,
  ): Promise<boolean> {
    const db = await getDb();
    const [revision] = await db
      .select({ id: storefrontThemeRevisions.id })
      .from(storefrontThemeRevisions)
      .where(
        and(
          eq(storefrontThemeRevisions.id, sourceRevisionId),
          eq(storefrontThemeRevisions.storefrontId, storefrontId),
          eq(storefrontThemeRevisions.themeId, themeId),
          isNull(storefrontThemeRevisions.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(revision);
  },

  /**
   * Creates a new Theme Build record permanently bound to an immutable sourceRevisionId.
   * Initial status is "queued".
   */
  async createBuild(
    storefrontId: string,
    themeId: string,
    options: {
      sourceRevisionId: string;
      createdBy?: string;
    },
  ): Promise<StorefrontThemeBuildDTO> {
    const isThemeOwner = await this.verifyThemeOwnership(storefrontId, themeId);
    if (!isThemeOwner) {
      throw new Error("Theme not found or does not belong to storefront");
    }

    const isRevisionValid = await this.verifyRevisionOwnership(
      storefrontId,
      themeId,
      options.sourceRevisionId,
    );
    if (!isRevisionValid) {
      throw new Error(
        "Theme source revision not found or does not belong to specified storefront and theme",
      );
    }

    const db = await getDb();
    const buildId = crypto.randomUUID();
    const now = new Date().toISOString();

    const [created] = await db
      .insert(storefrontThemeBuilds)
      .values({
        id: buildId,
        storefrontId,
        themeId,
        sourceRevisionId: options.sourceRevisionId,
        status: "queued",
        createdBy: options.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create theme build record");
    }

    return mapBuildRowToDTO(created);
  },

  /**
   * Retrieves a single build record by ID.
   */
  async getBuild(
    storefrontId: string,
    themeId: string,
    buildId: string,
  ): Promise<StorefrontThemeBuildDTO | null> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storefrontThemeBuilds)
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .limit(1);

    return row ? mapBuildRowToDTO(row) : null;
  },

  /**
   * Retrieves both Build and bound Source Revision records needed for materialization.
   */
  async getBuildMaterializationSource(
    storefrontId: string,
    themeId: string,
    buildId: string,
  ): Promise<{
    build: StorefrontThemeBuildDTO;
    revision: StorefrontThemeRevisionDTO;
  }> {
    const db = await getDb();
    const [buildRow] = await db
      .select()
      .from(storefrontThemeBuilds)
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .limit(1);

    if (!buildRow) {
      throw new Error(
        `BUILD_NOT_FOUND: Theme build "${buildId}" not found for storefront "${storefrontId}" and theme "${themeId}".`,
      );
    }

    const [revisionRow] = await db
      .select()
      .from(storefrontThemeRevisions)
      .where(
        and(
          eq(storefrontThemeRevisions.id, buildRow.sourceRevisionId),
          eq(storefrontThemeRevisions.storefrontId, storefrontId),
          eq(storefrontThemeRevisions.themeId, themeId),
          isNull(storefrontThemeRevisions.deletedAt),
        ),
      )
      .limit(1);

    if (!revisionRow) {
      throw new Error(
        `SOURCE_REVISION_NOT_FOUND: Immutable source revision "${buildRow.sourceRevisionId}" bound to build "${buildId}" was not found or was deleted.`,
      );
    }

    return {
      build: mapBuildRowToDTO(buildRow),
      revision: mapRevisionRowToDTO(revisionRow),
    };
  },

  /**
   * Lists historical build records for a theme.
   */
  async listBuilds(
    storefrontId: string,
    themeId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<StorefrontThemeBuildDTO[]> {
    const isOwner = await this.verifyThemeOwnership(storefrontId, themeId);
    if (!isOwner) return [];

    const db = await getDb();
    const rows = await db
      .select()
      .from(storefrontThemeBuilds)
      .where(
        and(
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .orderBy(desc(storefrontThemeBuilds.createdAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);

    return rows.map(mapBuildRowToDTO);
  },

  /**
   * Finds the latest build for a specific revision (and optionally filtered by status).
   */
  async findLatestBuildByRevision(
    storefrontId: string,
    themeId: string,
    sourceRevisionId: string,
    options?: { status?: (typeof storefrontThemeBuilds.$inferSelect)["status"] },
  ): Promise<StorefrontThemeBuildDTO | null> {
    const isOwner = await this.verifyThemeOwnership(storefrontId, themeId);
    if (!isOwner) return null;

    const db = await getDb();
    const conditions = [
      eq(storefrontThemeBuilds.storefrontId, storefrontId),
      eq(storefrontThemeBuilds.themeId, themeId),
      eq(storefrontThemeBuilds.sourceRevisionId, sourceRevisionId),
      isNull(storefrontThemeBuilds.deletedAt),
    ];

    if (options?.status) {
      conditions.push(eq(storefrontThemeBuilds.status, options.status));
    }

    const [row] = await db
      .select()
      .from(storefrontThemeBuilds)
      .where(and(...conditions))
      .orderBy(desc(storefrontThemeBuilds.createdAt))
      .limit(1);

    return row ? mapBuildRowToDTO(row) : null;
  },

  /**
   * State Transition: queued -> building with atomic compiler/input identity freeze.
   * Throws INVALID_STATE_TRANSITION if current status is not "queued".
   */

  async markBuildStarted(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options: {
      inputHash: string;
      compilerId: string;
      compilerVersion: string;
      startedAt?: string;
    },
  ): Promise<StorefrontThemeBuildDTO> {
    const existing = await this.getBuild(storefrontId, themeId, buildId);
    if (!existing) {
      throw new Error(`Build ${buildId} not found`);
    }

    if (existing.status !== "queued") {
      throw new Error(
        `INVALID_STATE_TRANSITION: Cannot start build from status "${existing.status}". Only "queued" builds can transition to "building".`,
      );
    }

    const db = await getDb();
    const now = new Date().toISOString();
    const startedAt = options.startedAt ?? now;

    const [updated] = await db
      .update(storefrontThemeBuilds)
      .set({
        status: "building",
        inputHash: options.inputHash,
        compilerId: options.compilerId,
        compilerVersion: options.compilerVersion,
        startedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          eq(storefrontThemeBuilds.status, "queued"),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error(
        "CONFLICT_STATE_CONCURRENCY: Build status changed concurrently during start transition or already building",
      );
    }

    return mapBuildRowToDTO(updated);
  },

  /**
   * State Transition: building -> succeeded
   * Throws INVALID_STATE_TRANSITION if current status is not "building".
   * Note: Build identity fields (sourceRevisionId, inputHash, compilerId, compilerVersion) are permanently frozen and cannot be altered.
   */
  async markBuildSucceeded(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options?: {
      artifactPrefix?: string;
      manifestJson?: any;
      diagnosticsJson?: any;
      completedAt?: string;
    },
  ): Promise<StorefrontThemeBuildDTO> {
    const existing = await this.getBuild(storefrontId, themeId, buildId);
    if (!existing) {
      throw new Error(`Build ${buildId} not found`);
    }

    if (existing.status !== "building") {
      throw new Error(
        `INVALID_STATE_TRANSITION: Cannot succeed build from status "${existing.status}". Only "building" builds can transition to "succeeded".`,
      );
    }

    const db = await getDb();
    const now = new Date().toISOString();
    const completedAt = options?.completedAt ?? now;

    const [updated] = await db
      .update(storefrontThemeBuilds)
      .set({
        status: "succeeded",
        artifactPrefix: options?.artifactPrefix ?? existing.artifactPrefix,
        manifestJson: options?.manifestJson ?? existing.manifestJson,
        diagnosticsJson: options?.diagnosticsJson ?? existing.diagnosticsJson,
        completedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          eq(storefrontThemeBuilds.status, "building"),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .returning();


    if (!updated) {
      throw new Error(
        "CONFLICT_STATE_CONCURRENCY: Build status changed concurrently during success transition",
      );
    }

    return mapBuildRowToDTO(updated);
  },

  /**
   * State Transition: building -> failed OR queued -> failed (for pre-runner launch orchestration failure).
   * Throws INVALID_STATE_TRANSITION if current status is already terminal ("succeeded" or "failed").
   */
  async markBuildFailed(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options: {
      errorMessage: string;
      diagnosticsJson?: any;
      completedAt?: string;
    },
  ): Promise<StorefrontThemeBuildDTO> {
    const existing = await this.getBuild(storefrontId, themeId, buildId);
    if (!existing) {
      throw new Error(`Build ${buildId} not found`);
    }

    if (existing.status === "succeeded" || existing.status === "failed") {
      throw new Error(
        `INVALID_STATE_TRANSITION: Cannot fail build from terminal status "${existing.status}".`,
      );
    }

    const db = await getDb();
    const now = new Date().toISOString();
    const completedAt = options.completedAt ?? now;

    const [updated] = await db
      .update(storefrontThemeBuilds)
      .set({
        status: "failed",
        errorMessage: options.errorMessage,
        diagnosticsJson: options.diagnosticsJson ?? existing.diagnosticsJson,
        completedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.storefrontId, storefrontId),
          eq(storefrontThemeBuilds.themeId, themeId),
          eq(storefrontThemeBuilds.status, existing.status),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error(
        "CONFLICT_STATE_CONCURRENCY: Build status changed concurrently during failure transition",
      );
    }

    return mapBuildRowToDTO(updated);
  },
};
