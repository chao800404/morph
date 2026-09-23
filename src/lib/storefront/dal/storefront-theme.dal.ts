import { env } from "cloudflare:workers";
import { TEMPLATE_DRAFT_CONFLICT } from "@/lib/storefront/theme-write-errors";
import { getDb } from "@/db";
import { withReleaseNote } from "@/lib/storefront/release-note";
import {
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
  storefrontThemeTemplateRevisions,
  storefrontThemeRevisions,
  storefrontThemeBuilds,
  storefrontThemeFiles,
  storefrontReleases,
  storefrontPages,
  storefrontPageRevisions,
} from "@/db/storefront.schema";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import { normalizeDocumentRowIds } from "@/lib/storefront/editor/normalize-row-ids";
import { resolveThemeContentCapabilities } from "@/lib/storefront/theme-content-capability-resolver";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  isPublishAlreadyLive,
  readDeployedThemeBuildId,
} from "@/lib/storefront/service/theme-worker-deployment-state";
import {
  deriveThemeLayoutSections,
  deriveThemeRouteSections,
  mergeDocumentWithRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
import { templateTypeForRoutePath } from "@/lib/storefront/theme-template-routes";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { filterSectionContentProps } from "@/lib/storefront/content/section-content-manifest";
import { extractThemeDocumentComponentRefs } from "@/lib/storefront/theme-content-capability-shadow";
import {
  collectMediaAssetIds,
  verifyMediaReferences,
} from "@/lib/storefront/theme-media-verification";
import { and, asc, desc, eq, isNotNull, isNull, max } from "drizzle-orm";

const revisionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function routePathForTemplateType(type: string): string | null {
  if (type === "index") return "/";
  const segment =
    type === "product"
      ? "products"
      : type === "collection"
        ? "collections"
        : type === "page"
          ? "pages"
          : type === "blog"
            ? "blogs"
            : null;
  return segment ? `/${segment}/` : null;
}

type ThemeRouteRegistry = ReturnType<typeof buildThemeRouteRegistry>;

/** The route a template's stored document is read through by default. */
function findDefaultTemplateRoute(registry: ThemeRouteRegistry, type: string) {
  const expectedPath = routePathForTemplateType(type);
  if (!expectedPath) return null;
  return (
    registry.routes.find(
      (candidate) =>
        candidate.kind === "route" &&
        (expectedPath === "/"
          ? candidate.path === "/"
          : candidate.path.startsWith(expectedPath)),
    ) ?? null
  );
}

function deriveTemplateDocumentFromRoutes(args: {
  type: string;
  document: import("@/db/storefront.schema").StorefrontPageDocument;
  files: readonly { path: string; content: string }[];
}) {
  const registry = buildThemeRouteRegistry(args.files);
  if (!registry.valid) return args.document;
  const route = findDefaultTemplateRoute(registry, args.type);
  if (!route) return args.document;
  const derived = deriveThemeRouteSections(args.files, route.sourcePath);
  if (
    derived.diagnostics.length > 0 ||
    (derived.sections.length === 0 && !derived.hasContentImport)
  ) {
    return args.document;
  }
  return mergeDocumentWithRouteSections(args.document, derived.sections, {
    routeOwnsStructure: derived.hasContentImport,
  });
}

type SectionSourceComponent =
  | Readonly<{ ok: true; componentRef: string | null }>
  | Readonly<{ ok: false }>;

/**
 * The component the saved source renders for one section.
 *
 * A content write is checked against this component's declared fields, never
 * against the ref the Document happens to store: the stored ref is whatever
 * the section rendered when it was last saved, and a section that has since
 * moved onto a page-owned copy, or been rebound in Code mode, would otherwise
 * be validated against a component it no longer renders.
 *
 * `routePath` names the route the editor is showing, because one template can
 * sit behind several routes and the default pick is only a guess. It chooses
 * among routes the saved source declares, and only one that belongs to this
 * template; anything else is a stale or forged view and `ok: false` refuses the
 * write. `componentRef: null` means the source does not answer — no route, a
 * route with diagnostics, a slot it does not declare — and the caller keeps the
 * stored ref, as before this existed.
 */
function resolveSectionSourceComponent(args: {
  templateType: string;
  sectionId: string;
  files: readonly { path: string; content: string }[];
  routePath?: string;
}): SectionSourceComponent {
  const fromSections = (
    derived: ReturnType<typeof deriveThemeRouteSections>,
  ): SectionSourceComponent => {
    if (derived.diagnostics.length > 0) return { ok: true, componentRef: null };
    const section = derived.sections.find(
      (candidate) =>
        candidate.slotId === args.sectionId &&
        !candidate.missingComponentSourcePath,
    );
    return { ok: true, componentRef: section?.componentRef ?? null };
  };

  if (args.templateType === "layout") {
    return fromSections(deriveThemeLayoutSections(args.files));
  }

  const registry = buildThemeRouteRegistry(args.files);
  if (!registry.valid) return { ok: true, componentRef: null };
  let route: ThemeRouteRegistry["routes"][number] | null;
  if (args.routePath !== undefined) {
    route =
      registry.routes.find(
        (candidate) =>
          candidate.kind === "route" && candidate.path === args.routePath,
      ) ?? null;
    if (!route || templateTypeForRoutePath(route.path) !== args.templateType) {
      return { ok: false };
    }
  } else {
    route = findDefaultTemplateRoute(registry, args.templateType);
    if (!route) return { ok: true, componentRef: null };
  }
  return fromSections(deriveThemeRouteSections(args.files, route.sourcePath));
}

async function listThemeSourceFiles(storefrontId: string, themeId: string) {
  const db = await getDb();
  return db
    .select({
      path: storefrontThemeFiles.path,
      content: storefrontThemeFiles.content,
    })
    .from(storefrontThemeFiles)
    .where(
      and(
        eq(storefrontThemeFiles.storefrontId, storefrontId),
        eq(storefrontThemeFiles.themeId, themeId),
        isNull(storefrontThemeFiles.deletedAt),
      ),
    )
    .orderBy(asc(storefrontThemeFiles.path));
}

function prepareTemplateDraftCASGuard(args: {
  storefrontId: string;
  themeId: string;
  templateId: string;
  expectedDraftGeneration: number;
  expectedDraftRevisionId?: string | null;
  expectedSourceGeneration?: number;
}) {
  return env.DATABASE.prepare(
    `
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM storefront_theme_templates t
      INNER JOIN storefront_themes th ON th.id = t.theme_id
      INNER JOIN storefronts s ON s.id = th.storefront_id
      WHERE s.id = ?1
        AND th.id = ?2
        AND t.id = ?3
        AND t.draft_generation = ?4
        AND (t.draft_revision_id = ?5 OR (t.draft_revision_id IS NULL AND ?5 = ''))
        AND (?6 IS NULL OR th.source_generation = ?6)
        AND s.deleted_at IS NULL
        AND th.deleted_at IS NULL
        AND t.deleted_at IS NULL
    ) THEN 1 ELSE json('') END AS ok
  `,
  ).bind(
    args.storefrontId,
    args.themeId,
    args.templateId,
    args.expectedDraftGeneration,
    args.expectedDraftRevisionId ?? "",
    args.expectedSourceGeneration ?? null,
  );
}

/**
 * Writes one template document, with the draft-revision rules every such write
 * shares.
 *
 * An active uncommitted draft is updated in place; anything else branches a new
 * revision. Both are guarded by the same compare-and-set over the draft
 * generation, the draft revision and the source generation, so a write that
 * raced another loses rather than overwriting it.
 *
 * Extracted because a second caller arrived — renaming a section — and the
 * alternative was a hundred and fifty lines of optimistic concurrency living in
 * two places, where only one of them would receive the next correction.
 */
async function writeTemplateDocument(args: {
  storefrontId: string;
  themeId: string;
  templateId: string;
  document: StorefrontPageDocument;
  sourceGeneration: number;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  expectedDraftGeneration: number;
  createdBy: string;
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const nextGeneration = args.expectedDraftGeneration + 1;

  // If an uncommitted draft revision is currently active, update it in place
  if (
    args.draftRevisionId &&
    args.draftRevisionId !== args.publishedRevisionId
  ) {
    const [activeDraft] = await db
      .select({
        id: storefrontThemeTemplateRevisions.id,
        version: storefrontThemeTemplateRevisions.version,
      })
      .from(storefrontThemeTemplateRevisions)
      .where(
        and(
          eq(storefrontThemeTemplateRevisions.id, args.draftRevisionId),
          eq(storefrontThemeTemplateRevisions.templateId, args.templateId),
        ),
      )
      .limit(1);

    if (activeDraft) {
      const statements = [
        prepareTemplateDraftCASGuard({
          storefrontId: args.storefrontId,
          themeId: args.themeId,
          templateId: args.templateId,
          expectedDraftGeneration: args.expectedDraftGeneration,
          expectedDraftRevisionId: activeDraft.id,
          expectedSourceGeneration: args.sourceGeneration,
        }),
        env.DATABASE.prepare(
          `
            UPDATE storefront_theme_template_revisions
            SET document = ?1
            WHERE id = ?2 AND template_id = ?3
          `,
        ).bind(JSON.stringify(args.document), activeDraft.id, args.templateId),
        env.DATABASE.prepare(
          `
            UPDATE storefront_theme_templates
            SET draft_generation = ?1, updated_at = ?2
            WHERE id = ?3 AND theme_id = ?4 AND deleted_at IS NULL
          `,
        ).bind(nextGeneration, now, args.templateId, args.themeId),
      ];

      try {
        await env.DATABASE.batch(statements);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("malformed JSON") ||
          message.includes("constraint")
        ) {
          throw new Error(
            "CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.",
          );
        }
        throw error;
      }

      return {
        document: args.document,
        version: activeDraft.version,
        draftRevisionId: activeDraft.id,
        draftGeneration: nextGeneration,
      };
    }
  }

  // Branch a new draft revision
  const [versionRow] = await db
    .select({ value: max(storefrontThemeTemplateRevisions.version) })
    .from(storefrontThemeTemplateRevisions)
    .where(eq(storefrontThemeTemplateRevisions.templateId, args.templateId));
  const revisionId = crypto.randomUUID();
  const version = Number(versionRow?.value ?? 0) + 1;

  const statements = [
    prepareTemplateDraftCASGuard({
      storefrontId: args.storefrontId,
      themeId: args.themeId,
      templateId: args.templateId,
      expectedDraftGeneration: args.expectedDraftGeneration,
      expectedDraftRevisionId: args.draftRevisionId,
      expectedSourceGeneration: args.sourceGeneration,
    }),
    env.DATABASE.prepare(
      `
        INSERT INTO storefront_theme_template_revisions (
          id, template_id, version, document, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
    ).bind(
      revisionId,
      args.templateId,
      version,
      JSON.stringify(args.document),
      args.createdBy,
      now,
    ),
    env.DATABASE.prepare(
      `
        UPDATE storefront_theme_templates
        SET draft_revision_id = ?1, draft_generation = ?2, updated_at = ?3
        WHERE id = ?4 AND theme_id = ?5 AND deleted_at IS NULL
      `,
    ).bind(revisionId, nextGeneration, now, args.templateId, args.themeId),
  ];

  try {
    await env.DATABASE.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("malformed JSON") || message.includes("constraint")) {
      throw new Error(
        "CONFLICT_DRAFT_GENERATION_MISMATCH: Template was modified concurrently.",
      );
    }
    throw error;
  }

  return {
    document: args.document,
    version,
    draftRevisionId: revisionId,
    draftGeneration: nextGeneration,
  };
}

export const storefrontThemeDal = {
  async findEditorContext(
    storefrontId: string,
    themeId: string,
  ): Promise<StorefrontThemeEditorDTO | null> {
    const db = await getDb();
    const [context] = await db
      .select({
        storefrontId: storefronts.id,
        storefrontName: storefronts.name,
        storefrontDomain: storefronts.domain,
        storefrontStatus: storefronts.status,
        activeReleaseId: storefronts.activeReleaseId,
        themeId: storefrontThemes.id,
        themeName: storefrontThemes.name,
        themeStatus: storefrontThemes.status,
        themeReleaseGeneration: storefrontThemes.releaseGeneration,
      })
      .from(storefrontThemes)
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, storefrontId),
          eq(storefrontThemes.id, themeId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);

    if (!context) return null;

    const [activeRelease] = context.activeReleaseId
      ? await db
          .select({
            id: storefrontReleases.id,
            sourceRevisionId: storefrontReleases.sourceRevisionId,
            themeBuildId: storefrontReleases.themeBuildId,
            // Carried so the editor can tell whether this release's artifact
            // still describes the current source. Publishing refuses to reuse
            // a release built from older source, and without this the editor
            // could not know that before asking.
            sourceGeneration: storefrontThemeRevisions.sourceGeneration,
          })
          .from(storefrontReleases)
          .innerJoin(
            storefrontThemeRevisions,
            eq(
              storefrontReleases.sourceRevisionId,
              storefrontThemeRevisions.id,
            ),
          )
          .where(
            and(
              eq(storefrontReleases.id, context.activeReleaseId),
              eq(storefrontReleases.storefrontId, storefrontId),
              eq(storefrontReleases.themeId, themeId),
              eq(storefrontReleases.status, "available"),
              isNull(storefrontReleases.deletedAt),
            ),
          )
          .limit(1)
      : [];

    const templateRows = await db
      .select({
        id: storefrontThemeTemplates.id,
        type: storefrontThemeTemplates.type,
        name: storefrontThemeTemplates.name,
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
      .orderBy(
        asc(storefrontThemeTemplates.type),
        asc(storefrontThemeTemplates.name),
      );

    const themeSourceFiles = await listThemeSourceFiles(storefrontId, themeId);

    const templates = await Promise.all(
      templateRows.map(async (template) => {
        let document = template.document;
        let version = 1;
        if (
          template.draftRevisionId &&
          revisionIdPattern.test(template.draftRevisionId)
        ) {
          const [revision] = await db
            .select({
              document: storefrontThemeTemplateRevisions.document,
              version: storefrontThemeTemplateRevisions.version,
            })
            .from(storefrontThemeTemplateRevisions)
            .where(
              and(
                eq(
                  storefrontThemeTemplateRevisions.id,
                  template.draftRevisionId,
                ),
                eq(storefrontThemeTemplateRevisions.templateId, template.id),
              ),
            )
            .limit(1);
          if (revision) {
            document = revision.document;
            version = revision.version;
          }
        }
        return {
          id: template.id,
          type: template.type as StorefrontThemeEditorDTO["templates"][number]["type"],
          name: template.name,
          // Rows are given their identity here, in memory, and nothing is
          // written. Repairing data as a side effect of reading it would write
          // on every page load, race with whatever else is open, and give the
          // author no generation to have been holding.
          //
          // Doing it at the one place documents are read is what makes the
          // guarantee hard to lose: the editor renders rows that already have
          // ids, and every mutator below builds its edit on a normalized base
          // without having to remember to ask. The repair reaches the database
          // when the author's first real edit is saved, in the same batch and
          // for the same generation as the edit itself.
          document: normalizeDocumentRowIds(
            deriveTemplateDocumentFromRoutes({
              type: template.type,
              document: storefrontPageDocumentSchema.parse(
                typeof document === "string" ? JSON.parse(document) : document,
              ),
              files: themeSourceFiles,
            }),
            template.id,
          ).value,
          draftRevisionId: template.draftRevisionId,
          publishedRevisionId: template.publishedRevisionId,
          draftGeneration: template.draftGeneration ?? 1,
          version,
        };
      }),
    );

    return {
      storefront: {
        id: context.storefrontId,
        name: context.storefrontName,
        domain: context.storefrontDomain,
        status: context.storefrontStatus,
        activeReleaseId: context.activeReleaseId,
      },
      theme: {
        id: context.themeId,
        name: context.themeName,
        status: context.themeStatus,
        releaseGeneration: context.themeReleaseGeneration ?? 1,
        // A release whose revision carries no generation cannot be shown to
        // still match the current source, so it is reported as absent rather
        // than as a reusable artifact. Publishing then builds, which is the
        // safe direction: the alternative ships an artifact of unknown vintage.
        activeRelease:
          activeRelease && activeRelease.sourceGeneration !== null
            ? {
                ...activeRelease,
                sourceGeneration: activeRelease.sourceGeneration,
              }
            : null,
      },
      templates,
    };
  },

  /**
   * Read-only component-ref samples for the manifest migration audit.
   *
   * Draft documents are read from the same editor context the UI uses. History
   * is intentionally a separate sample: template/page revisions are not
   * source-version paired, so this measures current compatibility without
   * pretending to reconstruct the source that existed when each revision was
   * authored.
   */
  async listComponentRefsForCapabilityAudit(
    storefrontId: string,
    themeId: string,
  ) {
    const context = await this.findEditorContext(storefrontId, themeId);
    if (!context) return null;

    const db = await getDb();
    const [templateHistory, pageDrafts, pageHistory] = await Promise.all([
      db
        .select({ document: storefrontThemeTemplateRevisions.document })
        .from(storefrontThemeTemplateRevisions)
        .innerJoin(
          storefrontThemeTemplates,
          eq(
            storefrontThemeTemplateRevisions.templateId,
            storefrontThemeTemplates.id,
          ),
        )
        .innerJoin(
          storefrontThemes,
          eq(storefrontThemeTemplates.themeId, storefrontThemes.id),
        )
        .where(
          and(
            eq(storefrontThemeTemplates.themeId, themeId),
            eq(storefrontThemes.storefrontId, storefrontId),
            isNull(storefrontThemeTemplates.deletedAt),
            isNull(storefrontThemes.deletedAt),
          ),
        ),
      db
        .select({ document: storefrontPageRevisions.document })
        .from(storefrontPages)
        .innerJoin(
          storefrontPageRevisions,
          and(
            eq(storefrontPageRevisions.id, storefrontPages.draftRevisionId),
            eq(storefrontPageRevisions.pageId, storefrontPages.id),
          ),
        )
        .where(
          and(
            eq(storefrontPages.storefrontId, storefrontId),
            isNull(storefrontPages.deletedAt),
          ),
        ),
      db
        .select({ document: storefrontPageRevisions.document })
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
        ),
    ]);

    return {
      draftRefs: [
        ...context.templates.flatMap((template) =>
          extractThemeDocumentComponentRefs(template.document),
        ),
        ...pageDrafts.flatMap((row) =>
          extractThemeDocumentComponentRefs(row.document),
        ),
      ],
      historicalRefs: [
        ...templateHistory.flatMap((row) =>
          extractThemeDocumentComponentRefs(row.document),
        ),
        ...pageHistory.flatMap((row) =>
          extractThemeDocumentComponentRefs(row.document),
        ),
      ],
    };
  },

  async reorderSections(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionIds: string[];
    expectedDraftGeneration: number;
    createdBy: string;
  }) {
    const context = await this.findEditorContext(
      data.storefrontId,
      data.themeId,
    );
    const template = context?.templates.find(
      (item) => item.id === data.templateId,
    );
    if (!template) return null;

    const currentIds = template.document.sections.map((section) => section.id);
    if (
      currentIds.length !== data.sectionIds.length ||
      new Set(currentIds).size !== new Set(data.sectionIds).size ||
      data.sectionIds.some((id) => !currentIds.includes(id))
    )
      return null;

    const sourceGeneration = await env.DATABASE.prepare(
      `SELECT source_generation AS sourceGeneration
         FROM storefront_themes
        WHERE id = ?1 AND storefront_id = ?2 AND deleted_at IS NULL
        LIMIT 1`,
    )
      .bind(data.themeId, data.storefrontId)
      .first<{ sourceGeneration: number }>();
    if (!sourceGeneration) return null;

    const sectionById = new Map(
      template.document.sections.map((section) => [section.id, section]),
    );
    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: data.sectionIds.map((id) => sectionById.get(id)),
    });

    return writeTemplateDocument({
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      templateId: data.templateId,
      document,
      sourceGeneration: sourceGeneration.sourceGeneration,
      draftRevisionId: template.draftRevisionId,
      publishedRevisionId: template.publishedRevisionId,
      expectedDraftGeneration: data.expectedDraftGeneration,
      createdBy: data.createdBy,
    });
  },

  /**
   * Renames one section placement.
   *
   * Beside `props`, never inside it: `props` is the component's content, is
   * spread into the component and travels to every visitor, and a component is
   * free to declare a content field of its own called `name`. This is the
   * editor's label for one placement, and the storefront never reads it —
   * which is also why it needs none of the content-field validation a props
   * write does. Clearing it restores the derived name rather than storing an
   * empty one.
   *
   * Per placement, so the same component on three pages carries three names. A
   * layout section is one entry for the whole site and therefore one name.
   */
  async renameSection(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionId: string;
    name: string | null;
    expectedDraftGeneration: number;
    createdBy: string;
  }) {
    const context = await this.findEditorContext(
      data.storefrontId,
      data.themeId,
    );
    const template = context?.templates.find(
      (item) => item.id === data.templateId,
    );
    if (!template) return null;
    if (!template.document.sections.some((s) => s.id === data.sectionId)) {
      return null;
    }

    const sourceGeneration = await env.DATABASE.prepare(
      `SELECT source_generation AS sourceGeneration
         FROM storefront_themes
        WHERE id = ?1 AND storefront_id = ?2 AND deleted_at IS NULL
        LIMIT 1`,
    )
      .bind(data.themeId, data.storefrontId)
      .first<{ sourceGeneration: number }>();
    if (!sourceGeneration) return null;

    const trimmed = data.name?.trim() ?? "";
    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: template.document.sections.map((section) => {
        if (section.id !== data.sectionId) return section;
        const { name: _previous, ...rest } = section;
        return trimmed ? { ...rest, name: trimmed } : rest;
      }),
    });

    return writeTemplateDocument({
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      templateId: data.templateId,
      document,
      sourceGeneration: sourceGeneration.sourceGeneration,
      draftRevisionId: template.draftRevisionId,
      publishedRevisionId: template.publishedRevisionId,
      expectedDraftGeneration: data.expectedDraftGeneration,
      createdBy: data.createdBy,
    });
  },

  async updateSectionProps(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sectionId: string;
    props: Record<string, unknown>;
    expectedDraftGeneration: number;
    createdBy: string;
    /** The route the editor is showing; see `resolveSectionSourceComponent`. */
    routePath?: string;
  }) {
    const context = await this.findEditorContext(
      data.storefrontId,
      data.themeId,
    );
    const template = context?.templates.find(
      (item) => item.id === data.templateId,
    );
    if (!template) return null;

    const targetSection = template.document.sections.find(
      (section) => section.id === data.sectionId,
    );
    if (!targetSection) return null;

    const sourceComponent = resolveSectionSourceComponent({
      templateType: template.type,
      sectionId: data.sectionId,
      files: await listThemeSourceFiles(data.storefrontId, data.themeId),
      routePath: data.routePath,
    });
    if (!sourceComponent.ok) return null;
    const sectionComponentRef =
      sourceComponent.componentRef ?? targetSection.componentRef ?? null;

    const manifestState = await env.DATABASE.prepare(
      `
      SELECT
        th.source_generation AS sourceGeneration,
        COALESCE(
          f.content,
          json_extract(th.metadata, '$.legacyManifestArchive.manifestContent')
        ) AS manifestContent
      FROM storefront_themes th
      LEFT JOIN storefront_theme_files f
        ON f.storefront_id = th.storefront_id
        AND f.theme_id = th.id
        AND f.path = 'morph.theme.json'
        AND f.deleted_at IS NULL
      WHERE th.id = ?1
        AND th.storefront_id = ?2
        AND th.deleted_at IS NULL
      LIMIT 1
    `,
    )
      .bind(data.themeId, data.storefrontId)
      .first<{ sourceGeneration: number; manifestContent: string | null }>();
    if (!manifestState) return null;
    // Components may declare their editable fields in their own source, so the
    // manifest alone no longer answers what this mutation is allowed to write.
    // Only the sources the manifest references are read, never the whole
    // workspace, and the client cannot influence which paths are loaded.
    const themeCapabilityState = await resolveThemeContentCapabilities({
      manifestContent: manifestState.manifestContent,
      additionalSourcePaths: sectionComponentRef?.startsWith("src/")
        ? [sectionComponentRef]
        : [],
      readSource: async (path) => {
        const row = await env.DATABASE.prepare(
          `
          SELECT content
          FROM storefront_theme_files
          WHERE storefront_id = ?1 AND theme_id = ?2 AND path = ?3
            AND deleted_at IS NULL
          LIMIT 1
        `,
        )
          .bind(data.storefrontId, data.themeId, path)
          .first<{ content: string | null }>();
        return row?.content ?? null;
      },
    });
    const themeCapabilities = themeCapabilityState.capabilities;
    // No ref and an unrecognised ref are different questions.
    //
    // A section written before refs existed names nothing, and the section type
    // is how a Theme names its components, so that is a safe answer. A section
    // that names `hero.unregistered-custom` has been answered already: this
    // Theme has no such component, and resolving it to `hero.default` would
    // check the incoming values against a component the document never named.
    // So an unrecognised ref is refused rather than reinterpreted.
    //
    // This used to fall back in both cases, because an unresolved ref makes
    // the filter below answer "nothing is allowed here" and turned a partial
    // edit into an erasure. That erasure came from running the *stored* props
    // through the same filter, which the guard below now prevents — the
    // fallback was treating a symptom, and hid a real mismatch while doing it.
    const resolvedComponentRef =
      sectionComponentRef ??
      themeCapabilityState.sectionComponentRefs[targetSection.type] ??
      null;

    const { enabled: propEnabled, ...restProps } = data.props;
    // Asset references are resolved against the library before anything is
    // stored: the shape validation upstream only checks that the id parses,
    // not that it names an asset of the right kind, and it takes the URL on
    // the caller's word.
    const assetIds = collectMediaAssetIds(restProps);
    const verifiedProps =
      assetIds.size > 0
        ? verifyMediaReferences({
            props: restProps,
            assetsById: new Map(
              (await assetDal.findByIds([...assetIds])).map((asset) => [
                asset.id,
                { id: asset.id, type: asset.type, url: asset.url },
              ]),
            ),
          })
        : restProps;
    const cleanIncomingProps = filterSectionContentProps(
      targetSection.type,
      verifiedProps,
      resolvedComponentRef,
      themeCapabilities,
    );
    // Existing props are carried through unvalidated and unfiltered.
    //
    // `contentFields` is an authoring allowlist, not the complete runtime prop
    // schema, so a partial content edit must not erase references or other
    // persisted component data. It must also not *reject* the edit: this used
    // to assert the stored props against the current declaration, which meant
    // that changing a declaration — a new maxLength, a changed type — made
    // every section still holding older content permanently uneditable,
    // including the very field that needed correcting. Only the incoming value
    // is validated, by `filterSectionContentProps` above.
    //
    // This used to hold only when the component's capability resolved, and to
    // re-filter the stored props otherwise — which returns `{}` for a ref the
    // manifest does not know. Editing one word of a header then deleted its
    // navigation, its cart link and everything else it held. Validation
    // belongs to what the client sent; what is already stored was validated
    // when it was written.
    const cleanExistingProps =
      (targetSection.props as Record<string, unknown>) ?? {};

    const document = storefrontPageDocumentSchema.parse({
      ...template.document,
      sections: template.document.sections.map((section) =>
        section.id === data.sectionId
          ? {
              ...section,
              componentRef: resolvedComponentRef ?? section.componentRef,
              enabled:
                typeof propEnabled === "boolean"
                  ? propEnabled
                  : section.enabled !== false,
              props: {
                ...cleanExistingProps,
                ...cleanIncomingProps,
              },
            }
          : section,
      ),
    });

    return writeTemplateDocument({
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      templateId: data.templateId,
      document,
      sourceGeneration: manifestState.sourceGeneration,
      draftRevisionId: template.draftRevisionId,
      publishedRevisionId: template.publishedRevisionId,
      expectedDraftGeneration: data.expectedDraftGeneration,
      createdBy: data.createdBy,
    });
  },

  async publishTemplate(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    sourceRevisionId?: string;
    expectedDraftRevisionId: string;
    expectedDraftGeneration: number;
    expectedReleaseGeneration: number;
    themeBuildId?: string;
    createdBy?: string;
    /** What changed, for recognising this release in the history later. */
    note?: string;
  }) {
    const releaseMetadata = withReleaseNote(null, data.note);
    const db = await getDb();
    const [template] = await db
      .select({
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
        draftGeneration: storefrontThemeTemplates.draftGeneration,
        publishedSourceRevisionId: storefrontThemes.publishedSourceRevisionId,
        releaseGeneration: storefrontThemes.releaseGeneration,
        sourceGeneration: storefrontThemes.sourceGeneration,
        activeReleaseId: storefronts.activeReleaseId,
      })
      .from(storefrontThemeTemplates)
      .innerJoin(
        storefrontThemes,
        eq(storefrontThemeTemplates.themeId, storefrontThemes.id),
      )
      .innerJoin(storefronts, eq(storefrontThemes.storefrontId, storefronts.id))
      .where(
        and(
          eq(storefronts.id, data.storefrontId),
          eq(storefrontThemes.id, data.themeId),
          eq(storefrontThemeTemplates.id, data.templateId),
          isNull(storefronts.deletedAt),
          isNull(storefrontThemes.deletedAt),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (!template) return null;

    const [activeRelease] = template.activeReleaseId
      ? await db
          .select({
            id: storefrontReleases.id,
            sourceRevisionId: storefrontReleases.sourceRevisionId,
            themeBuildId: storefrontReleases.themeBuildId,
            // Read before this publish activates anything, because afterwards
            // the active release is the new one and its deployment record is
            // necessarily empty.
            metadata: storefrontReleases.metadata,
            sourceGeneration: storefrontThemeRevisions.sourceGeneration,
          })
          .from(storefrontReleases)
          .innerJoin(
            storefrontThemeRevisions,
            eq(
              storefrontReleases.sourceRevisionId,
              storefrontThemeRevisions.id,
            ),
          )
          .where(
            and(
              eq(storefrontReleases.id, template.activeReleaseId),
              eq(storefrontReleases.storefrontId, data.storefrontId),
              eq(storefrontReleases.themeId, data.themeId),
              eq(storefrontReleases.status, "available"),
              isNull(storefrontReleases.deletedAt),
            ),
          )
          .limit(1)
      : [];
    // Resolve the build server-side when the caller did not name one.
    //
    // The editor only knows about a Build Preview while it is showing one, so a
    // reload would otherwise make an existing, valid build unpublishable and
    // force a rebuild. Falling back to the active release's build instead is
    // wrong in the opposite direction: it would publish stale bytes under a
    // newer source. The authoritative answer is the newest succeeded build
    // whose revision matches the theme's current source generation.
    const [resolvedBuild] =
      data.themeBuildId || data.sourceRevisionId
        ? []
        : await db
            .select({
              id: storefrontThemeBuilds.id,
              sourceRevisionId: storefrontThemeBuilds.sourceRevisionId,
            })
            .from(storefrontThemeBuilds)
            .innerJoin(
              storefrontThemeRevisions,
              eq(
                storefrontThemeBuilds.sourceRevisionId,
                storefrontThemeRevisions.id,
              ),
            )
            .where(
              and(
                eq(storefrontThemeBuilds.storefrontId, data.storefrontId),
                eq(storefrontThemeBuilds.themeId, data.themeId),
                eq(storefrontThemeBuilds.status, "succeeded"),
                isNotNull(storefrontThemeBuilds.artifactPrefix),
                isNotNull(storefrontThemeBuilds.manifestJson),
                isNull(storefrontThemeBuilds.deletedAt),
                isNull(storefrontThemeRevisions.deletedAt),
                eq(
                  storefrontThemeRevisions.sourceGeneration,
                  template.sourceGeneration,
                ),
              ),
            )
            .orderBy(desc(storefrontThemeBuilds.createdAt))
            .limit(1);

    const sourceRevisionId =
      data.sourceRevisionId ??
      resolvedBuild?.sourceRevisionId ??
      activeRelease?.sourceRevisionId;
    const themeBuildId =
      data.themeBuildId ?? resolvedBuild?.id ?? activeRelease?.themeBuildId;
    if (
      !data.sourceRevisionId &&
      !resolvedBuild &&
      (activeRelease?.sourceGeneration == null ||
        activeRelease.sourceGeneration !== template.sourceGeneration)
    ) {
      throw new Error(
        "PUBLISH_BUILD_NOT_READY: Theme source changed after the active release. Build Preview is required before publishing.",
      );
    }
    if (!sourceRevisionId || !themeBuildId) {
      throw new Error(
        "PUBLISH_BUILD_NOT_READY: No succeeded Build Preview is available for this storefront theme.",
      );
    }

    const [build] = await db
      .select({
        sourceRevisionId: storefrontThemeBuilds.sourceRevisionId,
        status: storefrontThemeBuilds.status,
        artifactPrefix: storefrontThemeBuilds.artifactPrefix,
        manifestJson: storefrontThemeBuilds.manifestJson,
      })
      .from(storefrontThemeBuilds)
      .where(
        and(
          eq(storefrontThemeBuilds.id, themeBuildId),
          eq(storefrontThemeBuilds.storefrontId, data.storefrontId),
          eq(storefrontThemeBuilds.themeId, data.themeId),
          isNull(storefrontThemeBuilds.deletedAt),
        ),
      )
      .limit(1);

    if (!build) {
      throw new Error(
        `PUBLISH_BUILD_NOT_FOUND: Theme build "${themeBuildId}" was not found for this storefront theme.`,
      );
    }
    if (build.status !== "succeeded") {
      throw new Error(
        `PUBLISH_BUILD_NOT_READY: Theme build "${themeBuildId}" is not succeeded (status: ${build.status}).`,
      );
    }
    if (
      build.sourceRevisionId !== sourceRevisionId ||
      !build.artifactPrefix ||
      !build.manifestJson
    ) {
      throw new Error(
        `PUBLISH_BUILD_MISMATCH: Theme build "${themeBuildId}" is not bound to source revision "${sourceRevisionId}" or has no immutable artifact.`,
      );
    }

    const [revision] = await db
      .select({ document: storefrontThemeTemplateRevisions.document })
      .from(storefrontThemeTemplateRevisions)
      .where(
        and(
          eq(storefrontThemeTemplateRevisions.id, data.expectedDraftRevisionId),
          eq(storefrontThemeTemplateRevisions.templateId, data.templateId),
        ),
      )
      .limit(1);
    if (!revision) return null;

    // The same normalization the editor and every draft write apply, so what
    // gets sealed into a release is complete. A Store whose rows were never
    // repaired — nobody edited it since row identity existed — would otherwise
    // publish a snapshot with unidentified rows, and a release is immutable:
    // the only way to correct it afterwards is another release.
    //
    // Idempotent, so for a document the editor already repaired this changes
    // nothing and derives the same ids it would have derived there.
    const document = normalizeDocumentRowIds(
      storefrontPageDocumentSchema.parse(
        typeof revision.document === "string"
          ? JSON.parse(revision.document)
          : revision.document,
      ),
      data.templateId,
    ).value;

    // The shell wraps every page and has no URL of its own, so it can never be
    // the template a publish targets. Left behind, its edits would sit in a
    // draft forever while the dashboard reported the site as published.
    const [shell] = await db
      .select({
        id: storefrontThemeTemplates.id,
        draftRevisionId: storefrontThemeTemplates.draftRevisionId,
        publishedRevisionId: storefrontThemeTemplates.publishedRevisionId,
        document: storefrontThemeTemplateRevisions.document,
      })
      .from(storefrontThemeTemplates)
      .innerJoin(
        storefrontThemeTemplateRevisions,
        eq(
          storefrontThemeTemplateRevisions.id,
          storefrontThemeTemplates.draftRevisionId,
        ),
      )
      .where(
        and(
          eq(storefrontThemeTemplates.themeId, data.themeId),
          eq(storefrontThemeTemplates.type, "layout"),
          isNull(storefrontThemeTemplates.deletedAt),
        ),
      )
      .limit(1);
    const pendingShell =
      shell &&
      shell.id !== data.templateId &&
      shell.draftRevisionId &&
      shell.draftRevisionId !== shell.publishedRevisionId
        ? {
            id: shell.id,
            revisionId: shell.draftRevisionId,
            document: normalizeDocumentRowIds(
              storefrontPageDocumentSchema.parse(
                typeof shell.document === "string"
                  ? JSON.parse(shell.document)
                  : shell.document,
              ),
              shell.id,
            ).value,
          }
        : null;

    const now = new Date().toISOString();
    const templateUnchanged =
      template.draftRevisionId === template.publishedRevisionId &&
      !pendingShell;
    const sourceUnchanged =
      template.publishedSourceRevisionId === sourceRevisionId;
    // Whether the Worker actually received this build, not just whether D1
    // says it should have. A publish writes D1 and then deploys; when the
    // deploy failed, everything above still matches on the retry and the
    // publish would report "already published" without ever deploying again,
    // leaving the active pointer naming a build the Worker never got. There is
    // then no way back short of editing the content to force a difference.
    const unchanged = isPublishAlreadyLive({
      templateUnchanged,
      sourceUnchanged,
      activeReleaseSourceRevisionId: activeRelease?.sourceRevisionId,
      activeReleaseThemeBuildId: activeRelease?.themeBuildId,
      deployedThemeBuildId: readDeployedThemeBuildId(
        activeRelease?.metadata as Record<string, unknown> | null,
      ),
      sourceRevisionId,
      themeBuildId,
    });
    const releaseId = unchanged
      ? (activeRelease?.id ?? null)
      : crypto.randomUUID();
    const contentPublication = unchanged
      ? null
      : await storefrontContentPublicationDal.resolveForTheme({
          storefrontId: data.storefrontId,
          themeId: data.themeId,
          templateId: data.templateId,
          templateRevisionId: data.expectedDraftRevisionId,
          alsoPublish: pendingShell
            ? [
                {
                  templateId: pendingShell.id,
                  revisionId: pendingShell.revisionId,
                },
              ]
            : undefined,
          createdBy: data.createdBy,
        });

    const statements = [
      env.DATABASE.prepare(
        `
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM storefront_theme_templates t
          INNER JOIN storefront_themes th ON th.id = t.theme_id
          INNER JOIN storefronts s ON s.id = th.storefront_id
          WHERE s.id = ?1
            AND th.id = ?2
            AND t.id = ?3
            AND t.draft_revision_id = ?4
            AND t.draft_generation = ?5
            AND th.release_generation = ?6
            AND s.deleted_at IS NULL
            AND th.deleted_at IS NULL
            AND t.deleted_at IS NULL
        ) AND EXISTS (
          SELECT 1
          FROM storefront_theme_revisions r
          WHERE r.id = ?7
            AND r.theme_id = ?2
            AND r.storefront_id = ?1
            AND r.deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `,
      ).bind(
        data.storefrontId,
        data.themeId,
        data.templateId,
        data.expectedDraftRevisionId,
        data.expectedDraftGeneration,
        data.expectedReleaseGeneration,
        sourceRevisionId,
      ),
    ];

    if (contentPublication) {
      statements.push(
        ...storefrontContentPublicationDal.insertStatements(contentPublication),
      );
    }

    if (template.draftRevisionId !== template.publishedRevisionId) {
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_theme_templates
          SET document = ?1, published_revision_id = ?2, draft_generation = draft_generation + 1, updated_at = ?3
          WHERE id = ?4
            AND theme_id = ?5
            AND draft_revision_id = ?2
            AND deleted_at IS NULL
        `,
        ).bind(
          JSON.stringify(document),
          data.expectedDraftRevisionId,
          now,
          data.templateId,
          data.themeId,
        ),
      );
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_theme_template_revisions
          SET published_at = ?1, document = ?2
          WHERE id = ?3 AND template_id = ?4
        `,
          // The revision is written, not just stamped. A release pins the
          // publication, the publication pins this revision, and the runtime
          // serves what this row holds — so repairing only the template's copy
          // would leave the published content exactly as it was.
        ).bind(
          now,
          JSON.stringify(document),
          data.expectedDraftRevisionId,
          data.templateId,
        ),
      );
    }

    if (pendingShell) {
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_theme_templates
          SET document = ?1, published_revision_id = ?2, draft_generation = draft_generation + 1, updated_at = ?3
          WHERE id = ?4
            AND theme_id = ?5
            AND draft_revision_id = ?2
            AND deleted_at IS NULL
        `,
        ).bind(
          JSON.stringify(pendingShell.document),
          pendingShell.revisionId,
          now,
          pendingShell.id,
          data.themeId,
        ),
      );
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_theme_template_revisions
          SET published_at = ?1, document = ?2
          WHERE id = ?3 AND template_id = ?4
        `,
        ).bind(
          now,
          JSON.stringify(pendingShell.document),
          pendingShell.revisionId,
          pendingShell.id,
        ),
      );
    }

    if (!unchanged) {
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefront_themes
          SET published_source_revision_id = ?1, release_generation = release_generation + 1, updated_at = ?2
          WHERE id = ?3 AND storefront_id = ?4 AND deleted_at IS NULL
        `,
        ).bind(sourceRevisionId, now, data.themeId, data.storefrontId),
      );
    }

    if (!unchanged) {
      statements.push(
        env.DATABASE.prepare(
          `
          INSERT INTO storefront_releases (
            id, storefront_id, theme_id, source_revision_id, theme_build_id,
            content_publication_id, status, metadata, created_by, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'available', ?7, ?8, ?9, ?9)
        `,
        ).bind(
          releaseId,
          data.storefrontId,
          data.themeId,
          sourceRevisionId,
          themeBuildId,
          contentPublication?.id ?? null,
          // Stored as the release's metadata so the history can show what a
          // person wrote instead of only an id fragment and a timestamp.
          releaseMetadata ? JSON.stringify(releaseMetadata) : null,
          data.createdBy ?? null,
          now,
        ),
      );
      statements.push(
        env.DATABASE.prepare(
          `
          UPDATE storefronts
          SET active_release_id = ?1, updated_at = ?2
          WHERE id = ?3 AND deleted_at IS NULL
        `,
        ).bind(releaseId, now, data.storefrontId),
      );
    }

    try {
      await env.DATABASE.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("malformed JSON") ||
        message.includes("constraint")
      ) {
        const latestContext = await this.findEditorContext(
          data.storefrontId,
          data.themeId,
        );
        const latestTemplate = latestContext?.templates.find(
          (t) => t.id === data.templateId,
        );
        if (
          latestContext &&
          (latestContext.theme.releaseGeneration ?? 1) !==
            data.expectedReleaseGeneration
        ) {
          throw new Error(
            "RELEASE_GENERATION_CONFLICT: Another release was published. Refresh the latest release before publishing again.",
          );
        }
        if (
          latestTemplate &&
          latestTemplate.draftGeneration !== data.expectedDraftGeneration
        ) {
          throw new Error(
            `${TEMPLATE_DRAFT_CONFLICT}: Template draft was modified concurrently.`,
          );
        }
        throw new Error(
          "CONFLICT_PUBLISH_GUARD_FAILED: Template, Source revision, or Release generation mismatch or concurrently modified.",
        );
      }
      throw error;
    }

    return {
      revisionId: data.expectedDraftRevisionId,
      previousActiveReleaseId: template.activeReleaseId,
      previousPublishedRevisionId: template.publishedRevisionId,
      previousPublishedSourceRevisionId: template.publishedSourceRevisionId,
      sourceRevisionId,
      draftGeneration: templateUnchanged
        ? (template.draftGeneration ?? 1)
        : (template.draftGeneration ?? 1) + 1,
      releaseGeneration: unchanged
        ? (template.releaseGeneration ?? 1)
        : (template.releaseGeneration ?? 1) + 1,
      templateUnchanged,
      sourceUnchanged,
      unchanged,
      // Surfaced so the caller can deploy the Theme Worker for the release it
      // just activated. Publishing writes D1 atomically, but the deployed
      // script is separate state that has to be reconciled afterwards.
      releaseId,
      themeBuildId,
      /** `true` when this publish created and activated a new release. */
      releaseCreated: !unchanged,
      /**
       * Build the Theme Worker was last recorded as actually running, read from
       * the release that was active before this publish. Lets the caller skip a
       * redeploy when only content changed, without trusting activation alone
       * as evidence that a deployment landed.
       */
      previousDeployedThemeBuildId: readDeployedThemeBuildId(
        activeRelease?.metadata ?? null,
      ),
    };
  },
  /** Compensates only this failed activation; never rewinds draft/OCC generations. */
  async restoreFailedPublish(data: {
    storefrontId: string;
    themeId: string;
    templateId: string;
    releaseId: string;
    releaseGeneration: number;
    previousActiveReleaseId: string | null;
    previousPublishedRevisionId: string | null;
    previousPublishedSourceRevisionId: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    await env.DATABASE.batch([
      env.DATABASE.prepare(
        `
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM storefronts s JOIN storefront_themes th ON th.storefront_id = s.id
          JOIN storefront_theme_templates t ON t.theme_id = th.id
          WHERE s.id = ?1 AND th.id = ?2 AND t.id = ?3
            AND s.active_release_id = ?4 AND th.release_generation = ?5
            AND s.deleted_at IS NULL AND th.deleted_at IS NULL AND t.deleted_at IS NULL
        ) THEN 1 ELSE json('') END AS ok
      `,
      ).bind(
        data.storefrontId,
        data.themeId,
        data.templateId,
        data.releaseId,
        data.releaseGeneration,
      ),
      env.DATABASE.prepare(
        `UPDATE storefronts SET active_release_id = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(data.previousActiveReleaseId, now, data.storefrontId),
      env.DATABASE.prepare(
        `UPDATE storefront_themes SET published_source_revision_id = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(data.previousPublishedSourceRevisionId, now, data.themeId),
      env.DATABASE.prepare(
        `UPDATE storefront_theme_templates SET published_revision_id = ?1, updated_at = ?2 WHERE id = ?3`,
      ).bind(data.previousPublishedRevisionId, now, data.templateId),
    ]);
  },
};
