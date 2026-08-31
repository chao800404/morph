import { getDb } from "@/db";
import {
  storefrontThemeDependencies,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontThemeDependencyDTO } from "@/lib/storefront/dto/storefront-theme-dependency.dto";
import { and, asc, eq, isNull } from "drizzle-orm";

function mapRow(
  row: typeof storefrontThemeDependencies.$inferSelect,
): StorefrontThemeDependencyDTO {
  return {
    id: row.id,
    storefrontId: row.storefrontId,
    themeId: row.themeId,
    packageName: row.packageName,
    packageVersion: row.packageVersion,
    status: row.status,
    buildId: row.buildId,
    requestedBy: row.requestedBy,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const storefrontThemeDependencyDal = {
  async verifyThemeOwnership(storefrontId: string, themeId: string) {
    const db = await getDb();
    const [row] = await db
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
    return Boolean(row);
  },

  async list(storefrontId: string, themeId: string) {
    if (!(await this.verifyThemeOwnership(storefrontId, themeId))) return [];
    const db = await getDb();
    const rows = await db
      .select()
      .from(storefrontThemeDependencies)
      .where(
        and(
          eq(storefrontThemeDependencies.storefrontId, storefrontId),
          eq(storefrontThemeDependencies.themeId, themeId),
          isNull(storefrontThemeDependencies.deletedAt),
        ),
      )
      .orderBy(asc(storefrontThemeDependencies.packageName));
    return rows.map(mapRow);
  },

  async get(
    storefrontId: string,
    themeId: string,
    packageName: string,
  ): Promise<StorefrontThemeDependencyDTO | null> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(storefrontThemeDependencies)
      .where(
        and(
          eq(storefrontThemeDependencies.storefrontId, storefrontId),
          eq(storefrontThemeDependencies.themeId, themeId),
          eq(storefrontThemeDependencies.packageName, packageName),
          isNull(storefrontThemeDependencies.deletedAt),
        ),
      )
      .limit(1);
    return row ? mapRow(row) : null;
  },

  async upsertRequested(options: {
    storefrontId: string;
    themeId: string;
    packageName: string;
    packageVersion: string;
    requestedBy?: string;
  }): Promise<StorefrontThemeDependencyDTO> {
    if (
      !(await this.verifyThemeOwnership(options.storefrontId, options.themeId))
    ) {
      throw new Error("Theme not found or does not belong to storefront");
    }
    const db = await getDb();
    const existing = await this.get(
      options.storefrontId,
      options.themeId,
      options.packageName,
    );
    const now = new Date().toISOString();

    if (existing) {
      const [updated] = await db
        .update(storefrontThemeDependencies)
        .set({
          packageVersion: options.packageVersion,
          status: "requested",
          buildId: null,
          requestedBy: options.requestedBy ?? existing.requestedBy,
          errorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(storefrontThemeDependencies.id, existing.id),
            isNull(storefrontThemeDependencies.deletedAt),
          ),
        )
        .returning();
      if (!updated)
        throw new Error("Failed to update theme dependency request");
      return mapRow(updated);
    }

    const [created] = await db
      .insert(storefrontThemeDependencies)
      .values({
        id: crypto.randomUUID(),
        storefrontId: options.storefrontId,
        themeId: options.themeId,
        packageName: options.packageName,
        packageVersion: options.packageVersion,
        status: "requested",
        requestedBy: options.requestedBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("Failed to create theme dependency request");
    return mapRow(created);
  },

  async markBuilding(options: {
    storefrontId: string;
    themeId: string;
    packageName: string;
    buildId: string;
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    const [updated] = await db
      .update(storefrontThemeDependencies)
      .set({ status: "building", buildId: options.buildId, updatedAt: now })
      .where(
        and(
          eq(storefrontThemeDependencies.storefrontId, options.storefrontId),
          eq(storefrontThemeDependencies.themeId, options.themeId),
          eq(storefrontThemeDependencies.packageName, options.packageName),
          isNull(storefrontThemeDependencies.deletedAt),
        ),
      )
      .returning();
    return updated ? mapRow(updated) : null;
  },

  async markRequested(options: {
    storefrontId: string;
    themeId: string;
    packageName: string;
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    const [updated] = await db
      .update(storefrontThemeDependencies)
      .set({ status: "requested", buildId: null, updatedAt: now })
      .where(
        and(
          eq(storefrontThemeDependencies.storefrontId, options.storefrontId),
          eq(storefrontThemeDependencies.themeId, options.themeId),
          eq(storefrontThemeDependencies.packageName, options.packageName),
          isNull(storefrontThemeDependencies.deletedAt),
        ),
      )
      .returning();
    return updated ? mapRow(updated) : null;
  },

  async markBuildResult(
    buildId: string,
    status: "ready" | "failed",
    errorMessage?: string,
  ) {
    const db = await getDb();
    const now = new Date().toISOString();
    const [updated] = await db
      .update(storefrontThemeDependencies)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: now })
      .where(
        and(
          eq(storefrontThemeDependencies.buildId, buildId),
          isNull(storefrontThemeDependencies.deletedAt),
        ),
      )
      .returning();
    return updated ? mapRow(updated) : null;
  },
};

export type StorefrontThemeDependencyDAL = typeof storefrontThemeDependencyDal;
