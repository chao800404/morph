import { getDb } from "@/db";
import {
  storefrontThemeBuilds,
  storefrontThemeRevisions,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontThemeBuildDTO } from "@/lib/storefront/dto/storefront-theme-build.dto";
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
   * State Transition: queued -> building
   * Throws INVALID_STATE_TRANSITION if current status is not "queued".
   */
  async markBuildStarted(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options?: {
      compilerId?: string;
      compilerVersion?: string;
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
    const startedAt = options?.startedAt ?? now;

    const [updated] = await db
      .update(storefrontThemeBuilds)
      .set({
        status: "building",
        compilerId: options?.compilerId ?? existing.compilerId,
        compilerVersion: options?.compilerVersion ?? existing.compilerVersion,
        startedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.status, "queued"),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error(
        "CONFLICT_STATE_CONCURRENCY: Build status changed concurrently during start transition",
      );
    }

    return mapBuildRowToDTO(updated);
  },

  /**
   * State Transition: building -> succeeded
   * Throws INVALID_STATE_TRANSITION if current status is not "building".
   */
  async markBuildSucceeded(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options: {
      inputHash?: string;
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
    const completedAt = options.completedAt ?? now;

    const [updated] = await db
      .update(storefrontThemeBuilds)
      .set({
        status: "succeeded",
        inputHash: options.inputHash ?? existing.inputHash,
        artifactPrefix: options.artifactPrefix ?? existing.artifactPrefix,
        manifestJson: options.manifestJson ?? existing.manifestJson,
        diagnosticsJson: options.diagnosticsJson ?? existing.diagnosticsJson,
        completedAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(storefrontThemeBuilds.id, buildId),
          eq(storefrontThemeBuilds.status, "building"),
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
          eq(storefrontThemeBuilds.status, existing.status),
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

  /**
   * Materializes the immutable virtual filesystem and compiler input strictly from the Build's bound sourceRevisionId.
   */
  async materializeBuildInput(
    storefrontId: string,
    themeId: string,
    buildId: string,
    options?: {
      compilerId?: string;
      compilerVersion?: string;
    },
  ) {
    const { themeBuildMaterializer } = await import(
      "@/lib/storefront/compiler/theme-build-materializer"
    );
    return themeBuildMaterializer.materializeThemeBuildInput(
      storefrontId,
      themeId,
      buildId,
      options,
    );
  },
};

