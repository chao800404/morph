import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { StorefrontThemeFileDTO } from "./dto/storefront-theme-file.dto";
import {
  buildThemeContentShadowReport,
  extractThemeDocumentComponentRefs,
} from "./theme-content-capability-shadow";
import {
  migrateThemeDocumentComponentRefs,
  type ThemeDocumentComponentRefMigrationFailure,
} from "./theme-document-component-ref-migration";
import {
  deriveThemeSourceIndex,
  type ThemeSourceIndex,
} from "./theme-source-index";

export const LEGACY_THEME_MANIFEST_PATH = "morph.theme.json";

export type ThemeManifestMigrationRevision = Readonly<{
  id: string;
  version: number;
  document: unknown;
  publishedAt: string | null;
}>;

export type ThemeManifestMigrationTarget = Readonly<{
  kind: "template" | "page";
  id: string;
  /** The non-versioned template fallback document, when this is a template. */
  baseDocument?: unknown;
  draftGeneration?: number;
  draftRevision: ThemeManifestMigrationRevision | null;
  publishedRevision: ThemeManifestMigrationRevision | null;
  maxRevisionVersion: number;
}>;

export type ThemeManifestMigrationHistoricalDocument = Readonly<{
  kind: "template" | "page";
  ownerId: string;
  revisionId: string;
  document: unknown;
}>;

export type ThemeManifestMigrationSnapshot = Readonly<{
  storefrontId: string;
  themeId: string;
  sourceGeneration: number;
  files: readonly StorefrontThemeFileDTO[];
  templates: readonly ThemeManifestMigrationTarget[];
  pages: readonly ThemeManifestMigrationTarget[];
  historicalDocuments: readonly ThemeManifestMigrationHistoricalDocument[];
}>;

export type ThemeManifestMigrationDocumentUpdate = Readonly<{
  kind: "template" | "page";
  id: string;
  expectedDraftRevisionId: string | null;
  expectedPublishedRevisionId: string | null;
  expectedDraftGeneration?: number;
  baseDocument?: StorefrontPageDocument;
  draftDocument: StorefrontPageDocument | null;
  publishedDocument: StorefrontPageDocument | null;
  draftPublishedAt: string | null;
  publishedPublishedAt: string | null;
  maxRevisionVersion: number;
}>;

export type ThemeManifestMigrationPlan = Readonly<{
  status: "ready" | "blocked" | "not-needed";
  storefrontId: string;
  themeId: string;
  sourceGeneration: number;
  manifestFile: Readonly<{
    id: string;
    version: number;
  }> | null;
  sourceFilesBefore: readonly StorefrontThemeFileDTO[];
  sourceFilesAfter: readonly StorefrontThemeFileDTO[];
  sourceIndexAfter: ThemeSourceIndex | null;
  documentUpdates: readonly ThemeManifestMigrationDocumentUpdate[];
  historicalLegacyRefs: readonly Readonly<{
    kind: "template" | "page";
    ownerId: string;
    revisionId: string;
    componentRefs: readonly string[];
  }>[];
  /**
   * Historical documents are immutable and may still contain logical refs.
   * The migration archives the exact manifest server-side so those refs keep
   * a compatibility oracle after the authored file leaves the workspace.
   */
  warnings: readonly string[];
  rewriteCount: number;
  blockers: readonly string[];
  report: ReturnType<typeof buildThemeContentShadowReport> | null;
}>;

function migrationFailureMessage(
  failure: ThemeDocumentComponentRefMigrationFailure,
): string {
  return failure.message;
}

function migratedDocument(args: {
  document: unknown;
  manifestContent: string;
  files: readonly StorefrontThemeFileDTO[];
}):
  | { ok: true; document: StorefrontPageDocument; rewriteCount: number }
  | { ok: false; message: string } {
  const result = migrateThemeDocumentComponentRefs({
    document: args.document,
    manifestContent: args.manifestContent,
    files: args.files,
  });
  if (!result.ok) {
    return { ok: false, message: migrationFailureMessage(result) };
  }
  return {
    ok: true,
    document: result.document,
    rewriteCount: result.rewrites.length,
  };
}

function planTarget(args: {
  target: ThemeManifestMigrationTarget;
  manifestContent: string;
  files: readonly StorefrontThemeFileDTO[];
  blockers: string[];
}): {
  update: ThemeManifestMigrationDocumentUpdate | null;
  rewriteCount: number;
} {
  const { target, manifestContent, files, blockers } = args;
  const base = target.baseDocument
    ? migratedDocument({
        document: target.baseDocument,
        manifestContent,
        files,
      })
    : null;
  if (base && !base.ok) {
    blockers.push(`${target.kind} ${target.id}: ${base.message}`);
  }

  const draft = target.draftRevision
    ? migratedDocument({
        document: target.draftRevision.document,
        manifestContent,
        files,
      })
    : null;
  if (draft && !draft.ok) {
    blockers.push(
      `${target.kind} ${target.id} draft revision ${target.draftRevision?.id}: ${draft.message}`,
    );
  }

  const published = target.publishedRevision
    ? migratedDocument({
        document: target.publishedRevision.document,
        manifestContent,
        files,
      })
    : null;
  if (published && !published.ok) {
    blockers.push(
      `${target.kind} ${target.id} published revision ${target.publishedRevision?.id}: ${published.message}`,
    );
  }

  const rewriteCount =
    (base?.ok ? base.rewriteCount : 0) +
    (draft?.ok ? draft.rewriteCount : 0) +
    (published?.ok ? published.rewriteCount : 0);
  if (
    (base && !base.ok) ||
    (draft && !draft.ok) ||
    (published && !published.ok) ||
    rewriteCount === 0
  ) {
    return { update: null, rewriteCount };
  }

  return {
    rewriteCount,
    update: {
      kind: target.kind,
      id: target.id,
      expectedDraftRevisionId: target.draftRevision?.id ?? null,
      expectedPublishedRevisionId: target.publishedRevision?.id ?? null,
      ...(target.draftGeneration === undefined
        ? {}
        : { expectedDraftGeneration: target.draftGeneration }),
      ...(base?.ok ? { baseDocument: base.document } : {}),
      draftDocument: draft?.ok ? draft.document : null,
      publishedDocument: published?.ok ? published.document : null,
      draftPublishedAt: target.draftRevision?.publishedAt ?? null,
      publishedPublishedAt: target.publishedRevision?.publishedAt ?? null,
      maxRevisionVersion: target.maxRevisionVersion,
    },
  };
}

/**
 * Plans the only operation allowed to remove the authored legacy manifest.
 *
 * The planner is deliberately server-side and exact: current mutable
 * documents may be rewritten through the manifest's explicit ref map, while
 * immutable history is never rewritten. If history still contains a logical
 * manifest ref, the operation is blocked instead of deleting the only map
 * that could resolve it.
 */
export function buildThemeManifestMigrationPlan(
  snapshot: ThemeManifestMigrationSnapshot,
): ThemeManifestMigrationPlan {
  const manifestFile = snapshot.files.find(
    (file) => file.path.replace(/\\/g, "/") === LEGACY_THEME_MANIFEST_PATH,
  );
  if (!manifestFile) {
    return {
      status: "not-needed",
      storefrontId: snapshot.storefrontId,
      themeId: snapshot.themeId,
      sourceGeneration: snapshot.sourceGeneration,
      manifestFile: null,
      sourceFilesBefore: snapshot.files,
      sourceFilesAfter: snapshot.files,
      sourceIndexAfter: null,
      documentUpdates: [],
      historicalLegacyRefs: [],
      warnings: [],
      rewriteCount: 0,
      blockers: [],
      report: null,
    };
  }

  const currentDocuments = [
    ...snapshot.templates.flatMap((target) => [
      target.baseDocument,
      target.draftRevision?.document,
      target.publishedRevision?.document,
    ]),
    ...snapshot.pages.flatMap((target) => [
      target.draftRevision?.document,
      target.publishedRevision?.document,
    ]),
  ].filter(
    (document): document is unknown =>
      document !== undefined && document !== null,
  );
  const historicalDocuments = snapshot.historicalDocuments.map(
    (entry) => entry.document,
  );
  const report = buildThemeContentShadowReport({
    files: snapshot.files,
    sourceGeneration: snapshot.sourceGeneration,
    draftRefs: currentDocuments.flatMap(extractThemeDocumentComponentRefs),
    historicalRefs: historicalDocuments.flatMap(
      extractThemeDocumentComponentRefs,
    ),
  });

  // The legacy manifest is an oracle for this one migration, not the future
  // source contract. A source/manifest diff is therefore expected input to the
  // migration rather than a reason to keep the authored registry forever. The
  // actual safety gate below is source completeness, source-contract
  // derivability, and exact migration of every mutable document.
  const blockers: string[] = [];
  const warnings = [...report.migrationBlockers];
  const documentUpdates: ThemeManifestMigrationDocumentUpdate[] = [];
  let rewriteCount = 0;
  const manifestContent = manifestFile.content;

  for (const historical of snapshot.historicalDocuments) {
    const result = migrateThemeDocumentComponentRefs({
      document: historical.document,
      manifestContent,
      files: snapshot.files,
    });
    if (!result.ok) {
      warnings.push(
        `Historical ${historical.kind} ${historical.ownerId} revision ${historical.revisionId}: ${result.message}`,
      );
      continue;
    }
    if (result.rewrites.length > 0) {
      warnings.push(
        `Historical ${historical.kind} ${historical.ownerId} revision ${historical.revisionId} still uses legacy component refs; immutable history will not be rewritten.`,
      );
    }
  }

  for (const target of [...snapshot.templates, ...snapshot.pages]) {
    const planned = planTarget({
      target,
      manifestContent,
      files: snapshot.files,
      blockers,
    });
    rewriteCount += planned.rewriteCount;
    if (planned.update) documentUpdates.push(planned.update);
  }

  const sourceFilesAfter = snapshot.files.filter(
    (file) => file.path.replace(/\\/g, "/") !== LEGACY_THEME_MANIFEST_PATH,
  );
  const sourceIndexAfter = deriveThemeSourceIndex({
    files: sourceFilesAfter,
    scope: "workspace",
    sourceGeneration: snapshot.sourceGeneration + 1,
  });
  if (sourceIndexAfter.status !== "complete") {
    blockers.push(
      "The source index after manifest removal is not complete; the manifest cannot be removed safely.",
    );
  }

  if (report.sourceScan.completeness === "incomplete") {
    blockers.push(
      `Source capability scan is incomplete (${report.sourceScan.scannedSourceCount}/${report.sourceScan.eligibleSourceCount} eligible files scanned).`,
    );
  }
  if (report.summary.unsupported > 0) {
    blockers.push(
      "At least one source content declaration is invalid or unreadable.",
    );
  }
  if (!report.sourceContract.derivation.complete) {
    blockers.push("The source-owned route/component contract is not complete.");
  }
  if (report.diagnostics.length > 0) {
    blockers.push("Source capability derivation produced diagnostics.");
  }

  // Manifest-only/drift entries and immutable-history refs are deliberately
  // warnings: the exact legacy manifest is archived in server-owned metadata,
  // while new writes use the source-derived index. Do not pretend the old
  // registry and new source contract are identical; show that difference to
  // the author instead of leaving the file undeletable forever.
  warnings.push(
    ...report.manifestRemovalBlockers.filter(
      (message) =>
        !message.includes("source capability scan is incomplete") &&
        !message.includes("manifest declaration is invalid or unreadable") &&
        !message.includes("source-owned route/component contract is not complete") &&
        !message.includes("Draft Documents still contain component references") &&
        !message.includes("Historical Documents still contain component references"),
    ),
  );

  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    storefrontId: snapshot.storefrontId,
    themeId: snapshot.themeId,
    sourceGeneration: snapshot.sourceGeneration,
    manifestFile: { id: manifestFile.id, version: manifestFile.version },
    sourceFilesBefore: snapshot.files,
    sourceFilesAfter,
    sourceIndexAfter,
    documentUpdates,
    historicalLegacyRefs: snapshot.historicalDocuments.flatMap((historical) => {
      const result = migrateThemeDocumentComponentRefs({
        document: historical.document,
        manifestContent,
        files: snapshot.files,
      });
      return result.ok && result.rewrites.length > 0
        ? [
            {
              kind: historical.kind,
              ownerId: historical.ownerId,
              revisionId: historical.revisionId,
              componentRefs: result.rewrites.map((rewrite) => rewrite.from),
            },
          ]
        : [];
    }),
    warnings: [...new Set(warnings)],
    rewriteCount,
    blockers: [...new Set(blockers)],
    report,
  };
}

export function sourceIndexForLegacyManifestRevision(args: {
  files: readonly StorefrontThemeFileDTO[];
  sourceManifest: Readonly<{
    version: 1;
    algorithm: "sha256";
    files: readonly Readonly<{ path: string; digest: string }>[];
  }>;
}): ThemeSourceIndex {
  return deriveThemeSourceIndex({
    files: args.files,
    scope: "revision",
    sourceManifest: args.sourceManifest,
  });
}
