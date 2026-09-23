import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  storefrontPageRevisions,
  storefrontPages,
  storefrontThemeTemplateRevisions,
  storefrontThemeTemplates,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { ThemeSourceRevisionManifest } from "../dto/storefront-theme-file.dto";
import type { ThemeSourceIndex } from "../theme-source-index";
import {
  type ThemeManifestMigrationDocumentUpdate,
  type ThemeManifestMigrationPlan,
  type ThemeManifestMigrationRevision,
  type ThemeManifestMigrationSnapshot,
  type ThemeManifestMigrationTarget,
} from "../theme-manifest-migration";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";
import { and, asc, eq, isNull } from "drizzle-orm";

function revisionFromRow(row: {
  id: string;
  version: number;
  document: unknown;
  publishedAt: string | null;
}): ThemeManifestMigrationRevision {
  return {
    id: row.id,
    version: row.version,
    document: row.document,
    publishedAt: row.publishedAt,
  };
}

function targetFromRevisions(args: {
  kind: "template" | "page";
  id: string;
  baseDocument?: unknown;
  draftGeneration?: number;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  revisions: readonly ThemeManifestMigrationRevision[];
}): ThemeManifestMigrationTarget {
  const draftRevision =
    args.revisions.find((revision) => revision.id === args.draftRevisionId) ??
    null;
  const publishedRevision =
    args.revisions.find(
      (revision) => revision.id === args.publishedRevisionId,
    ) ?? null;
  return {
    kind: args.kind,
    id: args.id,
    ...(args.baseDocument === undefined
      ? {}
      : { baseDocument: args.baseDocument }),
    ...(args.draftGeneration === undefined
      ? {}
      : { draftGeneration: args.draftGeneration }),
    draftRevision,
    publishedRevision,
    maxRevisionVersion: args.revisions.reduce(
      (maxVersion, revision) => Math.max(maxVersion, revision.version),
      0,
    ),
  };
}

/**
 * Reads every mutable pointer and every immutable revision that could be
 * affected by removing a legacy manifest. The server-owned migration needs
 * this complete view; reading only the editor's current document would make an
 * old restore silently lose its component-ref mapping.
 */
export async function readThemeManifestMigrationSnapshot(
  storefrontId: string,
  themeId: string,
): Promise<ThemeManifestMigrationSnapshot | null> {
  const db = await getDb();
  const [theme] = await db
    .select({ sourceGeneration: storefrontThemes.sourceGeneration })
    .from(storefrontThemes)
    .where(
      and(
        eq(storefrontThemes.id, themeId),
        eq(storefrontThemes.storefrontId, storefrontId),
        isNull(storefrontThemes.deletedAt),
      ),
    )
    .limit(1);
  if (!theme) return null;

  const files = await storefrontThemeFileDal.listFiles(storefrontId, themeId);
  const [templateRows, pageRows] = await Promise.all([
    db
      .select({
        id: storefrontThemeTemplates.id,
        document: storefrontThemeTemplates.document,
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
        draftGeneration: storefrontThemeTemplates.draftGeneration,
      })
      .from(storefrontThemeTemplates)
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, themeId),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .orderBy(asc(storefrontThemeTemplates.id)),
    db
      .select({
        id: storefrontPages.id,
        draftRevisionId: storefrontPages.draftRevisionId,
        publishedRevisionId: storefrontPages.publishedRevisionId,
      })
      .from(storefrontPages)
      .where(
        and(
          eq(storefrontPages.storefrontId, storefrontId),
          isNull(storefrontPages.deletedAt),
        ),
      )
      .orderBy(asc(storefrontPages.id)),
  ]);

  const templateRevisionRows = await db
    .select({
      id: storefrontThemeTemplateRevisions.id,
      templateId: storefrontThemeTemplateRevisions.templateId,
      version: storefrontThemeTemplateRevisions.version,
      document: storefrontThemeTemplateRevisions.document,
      publishedAt: storefrontThemeTemplateRevisions.publishedAt,
    })
    .from(storefrontThemeTemplateRevisions)
    .innerJoin(
      storefrontThemeTemplates,
      eq(
        storefrontThemeTemplateRevisions.templateId,
        storefrontThemeTemplates.id,
      ),
    )
    .where(
      and(
        eq(storefrontThemeTemplates.themeId, themeId),
        isNull(storefrontThemeTemplates.deletedAt),
      ),
    );

  const pageRevisionRows = await db
    .select({
      id: storefrontPageRevisions.id,
      pageId: storefrontPageRevisions.pageId,
      version: storefrontPageRevisions.version,
      document: storefrontPageRevisions.document,
      publishedAt: storefrontPageRevisions.publishedAt,
    })
    .from(storefrontPageRevisions)
    .innerJoin(
      storefrontPages,
      eq(storefrontPageRevisions.pageId, storefrontPages.id),
    )
    .where(
      and(
        eq(storefrontPages.storefrontId, storefrontId),
        isNull(storefrontPages.deletedAt),
      ),
    );

  const templateRevisionsByOwner = new Map<
    string,
    ThemeManifestMigrationRevision[]
  >();
  for (const row of templateRevisionRows) {
    const revisions = templateRevisionsByOwner.get(row.templateId) ?? [];
    revisions.push(revisionFromRow(row));
    templateRevisionsByOwner.set(row.templateId, revisions);
  }
  const pageRevisionsByOwner = new Map<
    string,
    ThemeManifestMigrationRevision[]
  >();
  for (const row of pageRevisionRows) {
    const revisions = pageRevisionsByOwner.get(row.pageId) ?? [];
    revisions.push(revisionFromRow(row));
    pageRevisionsByOwner.set(row.pageId, revisions);
  }

  const templates = templateRows.map((row) =>
    targetFromRevisions({
      kind: "template",
      id: row.id,
      baseDocument: row.document,
      draftGeneration: row.draftGeneration ?? 1,
      draftRevisionId: row.draftRevisionId,
      publishedRevisionId: row.publishedRevisionId,
      revisions: templateRevisionsByOwner.get(row.id) ?? [],
    }),
  );
  const pages = pageRows.map((row) =>
    targetFromRevisions({
      kind: "page",
      id: row.id,
      draftRevisionId: row.draftRevisionId,
      publishedRevisionId: row.publishedRevisionId,
      revisions: pageRevisionsByOwner.get(row.id) ?? [],
    }),
  );

  const historicalDocuments = [
    ...templateRows.flatMap((row) =>
      (templateRevisionsByOwner.get(row.id) ?? [])
        .filter(
          (revision) =>
            revision.id !== row.draftRevisionId &&
            revision.id !== row.publishedRevisionId,
        )
        .map((revision) => ({
          kind: "template" as const,
          ownerId: row.id,
          revisionId: revision.id,
          document: revision.document,
        })),
    ),
    ...pageRows.flatMap((row) =>
      (pageRevisionsByOwner.get(row.id) ?? [])
        .filter(
          (revision) =>
            revision.id !== row.draftRevisionId &&
            revision.id !== row.publishedRevisionId,
        )
        .map((revision) => ({
          kind: "page" as const,
          ownerId: row.id,
          revisionId: revision.id,
          document: revision.document,
        })),
    ),
  ];

  return {
    storefrontId,
    themeId,
    sourceGeneration: theme.sourceGeneration,
    files,
    templates,
    pages,
    historicalDocuments,
  };
}

function pointerCondition(column: string, parameter: string): string {
  return `(${column} = ${parameter} OR (${column} IS NULL AND ${parameter} IS NULL))`;
}

function prepareTemplateGuard(args: {
  storefrontId: string;
  themeId: string;
  update: ThemeManifestMigrationDocumentUpdate;
}) {
  return env.DATABASE.prepare(
    `
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM storefront_theme_templates t
        INNER JOIN storefront_themes th ON th.id = t.theme_id
        WHERE t.id = ?1
          AND t.theme_id = ?2
          AND th.storefront_id = ?3
          AND t.draft_generation = ?4
          AND ${pointerCondition("t.draft_revision_id", "?5")}
          AND ${pointerCondition("t.published_revision_id", "?6")}
          AND t.deleted_at IS NULL
          AND th.deleted_at IS NULL
      ) THEN 1 ELSE json('') END AS ok
    `,
  ).bind(
    args.update.id,
    args.themeId,
    args.storefrontId,
    args.update.expectedDraftGeneration,
    args.update.expectedDraftRevisionId,
    args.update.expectedPublishedRevisionId,
  );
}

function preparePageGuard(args: {
  storefrontId: string;
  update: ThemeManifestMigrationDocumentUpdate;
}) {
  return env.DATABASE.prepare(
    `
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM storefront_pages p
        WHERE p.id = ?1
          AND p.storefront_id = ?2
          AND ${pointerCondition("p.draft_revision_id", "?3")}
          AND ${pointerCondition("p.published_revision_id", "?4")}
          AND p.deleted_at IS NULL
      ) THEN 1 ELSE json('') END AS ok
    `,
  ).bind(
    args.update.id,
    args.storefrontId,
    args.update.expectedDraftRevisionId,
    args.update.expectedPublishedRevisionId,
  );
}

function revisionInsert(args: {
  update: ThemeManifestMigrationDocumentUpdate;
  ownerRevision: ThemeManifestMigrationRevision;
  revisionId: string;
  version: number;
  document: unknown;
  createdBy: string;
  now: string;
}) {
  const table =
    args.update.kind === "template"
      ? "storefront_theme_template_revisions"
      : "storefront_page_revisions";
  const ownerColumn =
    args.update.kind === "template" ? "template_id" : "page_id";
  return env.DATABASE.prepare(
    `
      INSERT INTO ${table} (
        id, ${ownerColumn}, version, document, created_by, created_at, published_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
  ).bind(
    args.revisionId,
    args.update.id,
    args.version,
    JSON.stringify(args.document),
    args.createdBy,
    args.now,
    args.ownerRevision.publishedAt,
  );
}

function sameDocument(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Applies a ready plan in one D1 batch. R2 blobs are prepared before this
 * method is called; the batch itself remains the OCC boundary for the Theme,
 * documents, source revision and manifest deletion.
 */
export async function applyThemeManifestMigration(args: {
  plan: ThemeManifestMigrationPlan & { status: "ready" };
  sourceManifest: ThemeSourceRevisionManifest;
  sourceIndexBefore: ThemeSourceIndex;
  createdBy: string;
}): Promise<{ sourceGeneration: number }> {
  const { plan } = args;
  if (!plan.manifestFile || !plan.sourceIndexAfter) {
    throw new Error("MANIFEST_MIGRATION_PLAN_INVALID: plan is not executable.");
  }

  const now = new Date().toISOString();
  const statements = [
    env.DATABASE.prepare(
      `
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM storefront_themes
          WHERE id = ?1 AND storefront_id = ?2
            AND source_generation = ?3 AND deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `,
    ).bind(plan.themeId, plan.storefrontId, plan.sourceGeneration),
    env.DATABASE.prepare(
      `
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM storefront_theme_files
          WHERE id = ?1 AND storefront_id = ?2 AND theme_id = ?3
            AND path = ?4 AND version = ?5 AND deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `,
    ).bind(
      plan.manifestFile.id,
      plan.storefrontId,
      plan.themeId,
      "morph.theme.json",
      plan.manifestFile.version,
    ),
  ];

  for (const update of plan.documentUpdates) {
    statements.push(
      update.kind === "template"
        ? prepareTemplateGuard({
            storefrontId: plan.storefrontId,
            themeId: plan.themeId,
            update,
          })
        : preparePageGuard({
            storefrontId: plan.storefrontId,
            update,
          }),
    );
  }

  statements.push(
    env.DATABASE.prepare(
      `
        INSERT INTO storefront_theme_revisions (
          id, storefront_id, theme_id, revision_number, message, source,
          snapshot, source_generation, source_manifest, source_index,
          created_by, created_at, updated_at
        )
        SELECT
          ?1, ?2, ?3,
          COALESCE((
            SELECT MAX(revision_number) + 1
            FROM storefront_theme_revisions
            WHERE theme_id = ?3 AND deleted_at IS NULL
          ), 1),
          ?4, 'manual', ?5, ?6, ?7, ?8, ?9, ?10, ?10
      `,
    ).bind(
      crypto.randomUUID(),
      plan.storefrontId,
      plan.themeId,
      "Remove legacy morph.theme.json manifest",
      JSON.stringify(
        plan.sourceFilesBefore.map((file) => ({
          path: file.path,
          content: file.content,
          mimeType: file.mimeType,
          isEntry: file.isEntry,
        })),
      ),
      plan.sourceGeneration,
      JSON.stringify(args.sourceManifest),
      JSON.stringify(args.sourceIndexBefore),
      args.createdBy,
      now,
    ),
  );

  for (const update of plan.documentUpdates) {
    let nextVersion = update.maxRevisionVersion + 1;
    let nextDraftRevisionId = update.expectedDraftRevisionId;
    let nextPublishedRevisionId = update.expectedPublishedRevisionId;

    if (update.draftDocument) {
      const revisionId = crypto.randomUUID();
      statements.push(
        revisionInsert({
          update,
          ownerRevision: {
            id: update.expectedDraftRevisionId ?? revisionId,
            version: nextVersion,
            document: update.draftDocument,
            publishedAt: update.draftPublishedAt,
          },
          revisionId,
          version: nextVersion,
          document: update.draftDocument,
          createdBy: args.createdBy,
          now,
        }),
      );
      nextDraftRevisionId = revisionId;
      nextVersion += 1;
      if (
        update.publishedDocument &&
        update.expectedDraftRevisionId === update.expectedPublishedRevisionId &&
        sameDocument(update.draftDocument, update.publishedDocument)
      ) {
        nextPublishedRevisionId = revisionId;
        nextVersion -= 1;
      }
    }

    if (
      update.publishedDocument &&
      nextPublishedRevisionId === update.expectedPublishedRevisionId
    ) {
      const revisionId = crypto.randomUUID();
      statements.push(
        revisionInsert({
          update,
          ownerRevision: {
            id: update.expectedPublishedRevisionId ?? revisionId,
            version: nextVersion,
            document: update.publishedDocument,
            publishedAt: update.publishedPublishedAt,
          },
          revisionId,
          version: nextVersion,
          document: update.publishedDocument,
          createdBy: args.createdBy,
          now,
        }),
      );
      nextPublishedRevisionId = revisionId;
    }

    if (update.kind === "template") {
      statements.push(
        env.DATABASE.prepare(
          `
            UPDATE storefront_theme_templates
            SET document = ?1,
                draft_revision_id = ?2,
                published_revision_id = ?3,
                draft_generation = draft_generation + 1,
                updated_at = ?4
            WHERE id = ?5 AND theme_id = ?6 AND deleted_at IS NULL
          `,
        ).bind(
          JSON.stringify(update.baseDocument ?? update.draftDocument),
          nextDraftRevisionId,
          nextPublishedRevisionId,
          now,
          update.id,
          plan.themeId,
        ),
      );
    } else {
      statements.push(
        env.DATABASE.prepare(
          `
            UPDATE storefront_pages
            SET draft_revision_id = ?1,
                published_revision_id = ?2,
                updated_at = ?3
            WHERE id = ?4 AND storefront_id = ?5 AND deleted_at IS NULL
          `,
        ).bind(
          nextDraftRevisionId,
          nextPublishedRevisionId,
          now,
          update.id,
          plan.storefrontId,
        ),
      );
    }
  }

  statements.push(
    env.DATABASE.prepare(
      `
        UPDATE storefront_theme_files
        SET deleted_at = ?1, updated_at = ?1
        WHERE id = ?2 AND storefront_id = ?3 AND theme_id = ?4
          AND path = ?5 AND version = ?6 AND deleted_at IS NULL
      `,
    ).bind(
      now,
      plan.manifestFile.id,
      plan.storefrontId,
      plan.themeId,
      "morph.theme.json",
      plan.manifestFile.version,
    ),
  );
  statements.push(
    env.DATABASE.prepare(
      `
        UPDATE storefront_themes
        SET metadata = json_set(
              COALESCE(metadata, '{}'),
              '$.legacyManifestArchive',
              json(?1)
            ),
            source_generation = source_generation + 1,
            source_index_version = ?2,
            source_index_status = ?3,
            source_index = ?4,
            updated_at = ?5
        WHERE id = ?6 AND storefront_id = ?7
          AND source_generation = ?8 AND deleted_at IS NULL
      `,
    ).bind(
      JSON.stringify({
        version: 1,
        migratedAt: now,
        sourceGeneration: plan.sourceGeneration,
        manifestContent:
          plan.sourceFilesBefore.find(
            (file) => file.path === "morph.theme.json",
          )?.content ?? null,
      }),
      plan.sourceIndexAfter.derivationVersion,
      plan.sourceIndexAfter.status,
      JSON.stringify(plan.sourceIndexAfter),
      now,
      plan.themeId,
      plan.storefrontId,
      plan.sourceGeneration,
    ),
  );
  statements.push(
    env.DATABASE.prepare(
      `
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM storefront_themes th
          INNER JOIN storefront_theme_files f
            ON f.theme_id = th.id AND f.storefront_id = th.storefront_id
          WHERE th.id = ?1 AND th.storefront_id = ?2
            AND th.source_generation = ?3
            AND f.path = ?4 AND f.deleted_at IS NOT NULL
        ) THEN 1 ELSE json('') END AS ok
      `,
    ).bind(
      plan.themeId,
      plan.storefrontId,
      plan.sourceGeneration + 1,
      "morph.theme.json",
    ),
  );

  try {
    await env.DATABASE.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("malformed JSON") || message.includes("constraint")) {
      throw new Error(
        "CONFLICT_THEME_MANIFEST_MIGRATION: Theme source or documents changed while the migration was running.",
      );
    }
    throw error;
  }

  return { sourceGeneration: plan.sourceGeneration + 1 };
}
