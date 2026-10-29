import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import {
  storefronts,
  storefrontThemes,
  storefrontThemeTemplates,
  type StorefrontPageDocument,
} from "@/db/storefront.schema";
import { eq, isNull, and } from "drizzle-orm";
import type {
  StorefrontDTO,
  StorefrontPreferencesDTO,
} from "../dto/storefront.dto";
import type {
  StarterUpgradeStatusDTO,
  StarterVersionState,
} from "../dto/storefront-theme.dto";
import { storefrontPreferencesSchema } from "@/lib/validations/storefront";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  isUpgradeableStarterHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";
import {
  reviewStarterThemeUpgrade,
  type StarterUpgradeReview,
} from "../starter-theme-upgrade-review";
import {
  reviewThemeCatalog,
  type ThemeCatalogReview,
} from "../service/theme-catalog-setup";
import { storeCatalogDal } from "./store-catalog.dal";
import { storeContextDal } from "./store-context.dal";
import { themeSourceStore } from "../storage/theme-storage.server";
import { defaultPreviewRuntimeForNewTheme } from "../theme-preview-runtime";
import { UNRECORDED_THEME_FRAMEWORK } from "../theme-framework/theme-framework.types";

export const DEFAULT_STOREFRONT_ID = "00000000-0000-4000-8000-000000000002";
export const DEFAULT_STOREFRONT_THEME_ID =
  "00000000-0000-4000-8000-000000000003";
const DEFAULT_HOME_TEMPLATE_ID = "00000000-0000-4000-8000-000000000004";
const DEFAULT_PRODUCT_TEMPLATE_ID = "00000000-0000-4000-8000-000000000005";
const DEFAULT_LAYOUT_TEMPLATE_ID = "00000000-0000-4000-8000-000000000006";
const INITIAL_SALES_CHANNEL_ID = "00000000-0000-4000-8000-000000000001";

const EMPTY_DOCUMENT: StorefrontPageDocument = { version: 1, sections: [] };

type StorefrontDb = Awaited<ReturnType<typeof getDb>>;

type StarterHomeTemplate = {
  id: string;
  document: StorefrontPageDocument;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  draftGeneration: number;
};

/** A version that is present but not a JSON number. Missing or null is unset. */
function isNonNumberStarterVersion(value: unknown): boolean {
  return value !== undefined && value !== null && typeof value !== "number";
}

/**
 * Whether the home rule may replace this home with the default home.
 *
 * Morph's own legacy Starter home, byte for byte, is always Morph's to
 * replace. An empty home is Morph's to fill only when no content write ever
 * reached it. Every author save goes through a template revision and leaves
 * a draft (and, once published, a published) revision id behind, so a home
 * with either was emptied by its author and is left alone. A home emptied
 * before template revisions existed cannot be told apart and is still filled.
 */
function isResettableStarterHome(home: StarterHomeTemplate): boolean {
  if (!isUpgradeableStarterHomeDocument(home.document)) return false;
  if (home.document.sections.length > 0) return true;
  return home.draftRevisionId === null && home.publishedRevisionId === null;
}

/**
 * Replaces the home document under the template document OCC: the draft
 * generation and draft revision the home rule read, the same pair every
 * template document write is conditioned on (`prepareTemplateDraftCASGuard`
 * in `storefront-theme.dal.ts`). The write advances the generation, as every
 * other document write does, so an editor holding the old one is refused
 * instead of saving over the new document.
 *
 * On a miss another write changed the home after the read; nothing is written
 * and the rule is not retried. Whatever that write stored is kept.
 */
async function resetStarterHomeDocument(
  themeId: string,
  home: StarterHomeTemplate,
  now: string,
): Promise<void> {
  await env.DATABASE.prepare(
    `UPDATE storefront_theme_templates
     SET document = ?1, draft_generation = draft_generation + 1, updated_at = ?2
     WHERE id = ?3
       AND theme_id = ?4
       AND deleted_at IS NULL
       AND draft_generation = ?5
       AND (draft_revision_id = ?6 OR (draft_revision_id IS NULL AND ?6 = ''))`,
  )
    .bind(
      JSON.stringify(createDefaultStorefrontHomeDocument()),
      now,
      home.id,
      themeId,
      home.draftGeneration,
      home.draftRevisionId ?? "",
    )
    .run();
}

/**
 * Creates the templates a Theme is missing and, when `record` is set, runs
 * the home rule and records the Starter version.
 *
 * `record` is set only where something was really done: a workspace that was
 * just initialised from the current Starter, or an upgrade its author
 * reviewed and applied. Anywhere else the stored version stays as it is, so
 * an unknown version is never written over as the latest.
 */
async function ensureStarterHomeDocument(
  db: StorefrontDb,
  themeId: string,
  options: { filesSaved: boolean; storefrontId: string; record: boolean },
): Promise<StarterUpgradeRecordOutcome> {
  const [theme] = await db
    .select({ metadata: storefrontThemes.metadata })
    .from(storefrontThemes)
    .where(
      and(eq(storefrontThemes.id, themeId), isNull(storefrontThemes.deletedAt)),
    )
    .limit(1);
  if (!theme) return { status: "skipped", reason: "theme-missing" };

  const metadata = theme.metadata ?? {};
  const [homeTemplate] = await db
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
        eq(storefrontThemeTemplates.type, "index"),
        isNull(storefrontThemeTemplates.deletedAt),
      ),
    )
    .limit(1);

  const [productTemplate] = await db
    .select({ id: storefrontThemeTemplates.id })
    .from(storefrontThemeTemplates)
    .where(
      and(
        eq(storefrontThemeTemplates.themeId, themeId),
        eq(storefrontThemeTemplates.type, "product"),
        isNull(storefrontThemeTemplates.deletedAt),
      ),
    )
    .limit(1);

  const [layoutTemplate] = await db
    .select({ id: storefrontThemeTemplates.id })
    .from(storefrontThemeTemplates)
    .where(
      and(
        eq(storefrontThemeTemplates.themeId, themeId),
        eq(storefrontThemeTemplates.type, "layout"),
        isNull(storefrontThemeTemplates.deletedAt),
      ),
    )
    .limit(1);

  const now = new Date().toISOString();

  if (!homeTemplate) {
    await db.insert(storefrontThemeTemplates).values({
      id: crypto.randomUUID(),
      themeId,
      type: "index",
      name: "Default",
      document: createDefaultStorefrontHomeDocument(),
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!productTemplate) {
    await db.insert(storefrontThemeTemplates).values({
      id: crypto.randomUUID(),
      themeId,
      type: "product",
      name: "Default product",
      document: EMPTY_DOCUMENT,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Seeded with what the shell components declare as their own defaults, so
  // adopting the document changes nothing on the page. Only created when it is
  // absent: an existing one holds authored content.
  if (!layoutTemplate) {
    await db.insert(storefrontThemeTemplates).values({
      id: crypto.randomUUID(),
      themeId,
      type: "layout" as const,
      name: "Shell",
      document: createDefaultStorefrontLayoutDocument(),
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!options.record) return { status: "skipped", reason: "not-confirmed" };

  if (
    isStarterVersionAtLeast(
      metadata.starterTemplateVersion,
      STOREFRONT_STARTER_TEMPLATE_VERSION,
    )
  ) {
    return {
      status: "already-current",
      storedVersion: metadata.starterTemplateVersion as number,
    };
  }

  const ids = { storefrontId: options.storefrontId, themeId };
  if (isNonNumberStarterVersion(metadata.starterTemplateVersion)) {
    // Recorded over only on an init or an applied review. Logged because
    // nothing known writes one, so it means the row was edited by hand or a
    // new writer appeared. Ids and a fixed reason only, never the metadata.
    console.error(
      "Starter template version is not a number:",
      JSON.stringify({
        storefrontId: ids.storefrontId,
        themeId: ids.themeId,
        reason: "non-number-starter-template-version",
      }),
    );
  }

  if (homeTemplate && isResettableStarterHome(homeTemplate)) {
    await resetStarterHomeDocument(themeId, homeTemplate, now);
  }

  const readRevision = readStarterUpgradeRecordRevision(
    metadata.starterUpgradeRecordRevision,
  );
  if (readRevision === null) {
    return reportIncompleteStarterUpgrade(ids, {
      status: "partial",
      reason: "unreadable-record-revision",
      filesSaved: options.filesSaved,
      attempts: 0,
    });
  }
  return writeStarterUpgradeRecord(ids, {
    readRevision,
    targetVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
    filesSaved: options.filesSaved,
    now,
  });
}

/**
 * Outcome of recording a Starter upgrade on the Theme's metadata.
 *
 * `partial` means this run's record was not persisted: this run did not
 * advance the version and wrote nothing to metadata. When `filesSaved` is
 * true the workspace files were already upgraded. Nothing re-writes a record
 * that was not persisted: if another writer advances the version before the
 * next load, this run's outcome is never written.
 *
 * `already-current` also drops this run's record: the version was written by
 * someone else, possibly a different code version (older or newer than this
 * one), and this run writes nothing of its own on top of it.
 *
 * Stored metadata is classified case by case:
 * - Legitimately unset: a SQL NULL column, `{}`, a missing
 *   `starterTemplateVersion`, a missing or JSON-null revision. The existing
 *   compatibility rules apply and the record is written.
 * - Anomalous: JSON `null` text, an array, a string, a number, malformed JSON
 *   text, or a revision that is a string, a fraction, negative or a boolean.
 *   The data is kept, the record write is refused and the outcome is
 *   `partial` with its own reason, so loading fails until the data is fixed
 *   by hand. Nothing here clears or rewrites it.
 */
export type StarterUpgradeRecordOutcome =
  | { status: "recorded"; version: number; revision: number; attempts: number }
  | { status: "already-current"; storedVersion: number }
  | { status: "skipped"; reason: "theme-missing" | "not-confirmed" }
  | StarterUpgradePartialOutcome;

export type StarterUpgradePartialOutcome = {
  status: "partial";
  reason:
    | "record-revision-conflict"
    | "theme-missing"
    | "unreadable-record-revision"
    | "non-object-metadata"
    | "malformed-metadata";
  filesSaved: boolean;
  attempts: number;
};

/**
 * Thrown by the public entry points when the upgrade record was not saved, so
 * no caller can report the upgrade as having completed. Callers already turn
 * a thrown initialization error into a failure result.
 */
export class StarterUpgradeIncompleteError extends Error {
  readonly outcome: StarterUpgradePartialOutcome;
  constructor(outcome: StarterUpgradePartialOutcome) {
    super(
      outcome.filesSaved
        ? `Starter Theme upgrade only partly completed: the files were upgraded, but the upgrade record was not saved (${outcome.reason}).`
        : `Starter Theme upgrade record was not saved (${outcome.reason}).`,
    );
    this.name = "StarterUpgradeIncompleteError";
    this.outcome = outcome;
  }
}

export const STARTER_UPGRADE_RECORD_MAX_ATTEMPTS = 3;

function isStarterVersionAtLeast(value: unknown, target: number): boolean {
  return typeof value === "number" && value >= target;
}

/** A missing revision is legacy metadata and reads as 0. */
function readStarterUpgradeRecordRevision(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

type StarterUpgradeRecordTarget = { storefrontId: string; themeId: string };

function reportIncompleteStarterUpgrade(
  target: StarterUpgradeRecordTarget,
  outcome: StarterUpgradePartialOutcome,
): StarterUpgradePartialOutcome {
  console.error(
    "Starter upgrade record not saved:",
    JSON.stringify({
      storefrontId: target.storefrontId,
      themeId: target.themeId,
      ...outcome,
    }),
  );
  return outcome;
}

/**
 * Writes only the upgrade's own keys, conditioned on the record revision the
 * upgrade read. `json_set` leaves every other metadata key as stored, so a
 * single-key writer landing between the read and this write keeps its key.
 *
 * On a revision miss the record is re-read: a stored version at or above the
 * target is left as it is (never lowered); otherwise the write is retried on
 * the fresh revision. After the last attempt nothing is written and the
 * outcome is `partial`.
 *
 * The condition also requires the stored metadata to be a JSON object.
 * `json_set` on `null`, an array or a scalar stores nothing yet still counts
 * as a changed row, which would read as recorded. Malformed JSON text would
 * make `json_extract` throw; the nested CASE keeps both out of the write and
 * the re-read names them instead.
 *
 * The revision is matched by its JSON type, not only its value:
 * `json_extract` returns JSON `true`/`false` as 1/0, so a boolean written
 * between the read and the write would otherwise match. Accepted are a
 * missing or `null` revision (read as 0), an `integer`, or a `real` holding a
 * whole number (a bound JS number can be stored as 2.0).
 *
 * The nesting is deliberate. SQLite documents that CASE evaluates its
 * branches only as needed; it does not document the evaluation order or
 * short-circuiting of AND. Written as an AND chain, `json_type` or
 * `json_extract` could be evaluated on malformed text and raise.
 */
async function writeStarterUpgradeRecord(
  target: StarterUpgradeRecordTarget,
  args: {
    readRevision: number;
    targetVersion: number;
    filesSaved: boolean;
    now: string;
  },
): Promise<StarterUpgradeRecordOutcome> {
  const { themeId } = target;
  let readRevision = args.readRevision;
  for (
    let attempt = 1;
    attempt <= STARTER_UPGRADE_RECORD_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const result = await env.DATABASE.prepare(
      `UPDATE storefront_themes
       SET metadata = json_set(
             COALESCE(metadata, '{}'),
             '$.starterTemplateVersion', ?1,
             '$.starterUpgradeRecordRevision', ?2
           ),
           updated_at = ?3
       WHERE id = ?4
         AND CASE
               WHEN json_valid(COALESCE(metadata, '{}')) THEN
                 CASE
                   WHEN json_type(COALESCE(metadata, '{}')) = 'object' THEN
                     CASE COALESCE(json_type(metadata, '$.starterUpgradeRecordRevision'), 'null')
                       WHEN 'null' THEN 0 = ?5
                       WHEN 'integer' THEN
                         json_extract(metadata, '$.starterUpgradeRecordRevision') = ?5
                       WHEN 'real' THEN
                         CASE
                           WHEN json_extract(metadata, '$.starterUpgradeRecordRevision')
                              = CAST(json_extract(metadata, '$.starterUpgradeRecordRevision') AS INTEGER)
                           THEN json_extract(metadata, '$.starterUpgradeRecordRevision') = ?5
                           ELSE 0
                         END
                       ELSE 0
                     END
                   ELSE 0
                 END
               ELSE 0
             END`,
    )
      .bind(
        args.targetVersion,
        readRevision + 1,
        args.now,
        themeId,
        readRevision,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) > 0) {
      return {
        status: "recorded",
        version: args.targetVersion,
        revision: readRevision + 1,
        attempts: attempt,
      };
    }

    const stored = await env.DATABASE.prepare(
      `SELECT shape,
              CASE WHEN shape = 'object'
                THEN json_extract(doc, '$.starterTemplateVersion') END AS version,
              CASE WHEN shape = 'object'
                THEN json_extract(doc, '$.starterUpgradeRecordRevision') END AS revision,
              CASE WHEN shape = 'object'
                THEN json_type(doc, '$.starterUpgradeRecordRevision') END AS revisionType
       FROM (
         SELECT COALESCE(metadata, '{}') AS doc,
                CASE WHEN json_valid(COALESCE(metadata, '{}'))
                  THEN json_type(COALESCE(metadata, '{}'))
                  ELSE 'malformed' END AS shape
         FROM storefront_themes
         WHERE id = ?1
       )`,
    )
      .bind(themeId)
      .first<{
        shape: string;
        version: unknown;
        revision: unknown;
        revisionType: string | null;
      }>();
    if (!stored) {
      return reportIncompleteStarterUpgrade(target, {
        status: "partial",
        reason: "theme-missing",
        filesSaved: args.filesSaved,
        attempts: attempt,
      });
    }
    if (stored.shape !== "object") {
      return reportIncompleteStarterUpgrade(target, {
        status: "partial",
        reason:
          stored.shape === "malformed"
            ? "malformed-metadata"
            : "non-object-metadata",
        filesSaved: args.filesSaved,
        attempts: attempt,
      });
    }
    if (isStarterVersionAtLeast(stored.version, args.targetVersion)) {
      return {
        status: "already-current",
        storedVersion: stored.version as number,
      };
    }
    // json_extract reports a JSON boolean as 1/0; only a number (or no value)
    // is a revision.
    const revisionIsNumber =
      stored.revisionType === null ||
      stored.revisionType === "null" ||
      stored.revisionType === "integer" ||
      stored.revisionType === "real";
    const freshRevision = revisionIsNumber
      ? readStarterUpgradeRecordRevision(stored.revision)
      : null;
    if (freshRevision === null) {
      return reportIncompleteStarterUpgrade(target, {
        status: "partial",
        reason: "unreadable-record-revision",
        filesSaved: args.filesSaved,
        attempts: attempt,
      });
    }
    readRevision = freshRevision;
  }
  return reportIncompleteStarterUpgrade(target, {
    status: "partial",
    reason: "record-revision-conflict",
    filesSaved: args.filesSaved,
    attempts: STARTER_UPGRADE_RECORD_MAX_ATTEMPTS,
  });
}

function assertStarterUpgradeRecorded(
  outcome: StarterUpgradeRecordOutcome,
): void {
  if (outcome.status === "partial") {
    throw new StarterUpgradeIncompleteError(outcome);
  }
}

/**
 * Initialises an empty workspace from the current Starter. A workspace that
 * has files is never written here: upgrading one is the author's decision,
 * taken through `reviewStarterUpgrade` and `applyReviewedStarterUpgrade`.
 */
async function ensureStarterThemeWorkspace(
  storefrontId: string,
  themeId: string,
  createdBy?: string,
): Promise<{ filesSaved: boolean }> {
  const existingFiles = await storefrontThemeFileDal.listFiles(
    storefrontId,
    themeId,
  );
  if (existingFiles.length > 0) return { filesSaved: false };
  if (createdBy) {
    await storefrontThemeFileDal.initStarterTheme(
      storefrontId,
      themeId,
      createdBy,
    );
  } else {
    await storefrontThemeFileDal.initStarterTheme(storefrontId, themeId);
  }
  return { filesSaved: true };
}

async function readStoredStarterVersion(
  db: StorefrontDb,
  storefrontId: string,
  themeId: string,
): Promise<{ found: boolean; version: unknown; framework: string | null }> {
  const [theme] = await db
    .select({
      metadata: storefrontThemes.metadata,
      framework: storefrontThemes.framework,
    })
    .from(storefrontThemes)
    .where(
      and(
        eq(storefrontThemes.id, themeId),
        eq(storefrontThemes.storefrontId, storefrontId),
        isNull(storefrontThemes.deletedAt),
      ),
    )
    .limit(1);
  return {
    found: Boolean(theme),
    version: theme?.metadata?.starterTemplateVersion,
    framework: theme?.framework ?? null,
  };
}

/** The stored Starter version, when it is one; `null` reads as pending. */
function recordedStarterVersion(version: unknown): number | null {
  return starterVersionState(version) === "pending"
    ? null
    : (version as number);
}

/**
 * Where a Theme stands against the current Starter, from its stored version.
 *
 * `pending` is a version that is missing, NULL or not a positive whole
 * number: nothing says which Starter the files came from, so it is shown as
 * waiting for the author, never as the latest.
 */
export function starterVersionState(version: unknown): StarterVersionState {
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return "pending";
  }
  return version >= STOREFRONT_STARTER_TEMPLATE_VERSION
    ? "current"
    : "available";
}

export type StarterUpgradeReviewResult = {
  sourceGeneration: number;
  versionState: StarterVersionState;
  storedVersion: number | null;
  currentVersion: number;
  review: StarterUpgradeReview;
  /** The product catalog, kept apart from the Starter upgrade. */
  catalog: ThemeCatalogReview;
};

export type StarterUpgradeApplyResult =
  | {
      status: "applied";
      filesSaved: boolean;
      sourceGeneration: number;
      /** Whether the Starter part was applied, and so its version recorded. */
      starter: boolean;
      catalog: boolean;
    }
  | { status: "not-applicable" }
  /** The workspace or the plan changed since the author reviewed it. */
  | { status: "stale"; sourceGeneration: number | null };

/** Whether the store's channel sells anything a catalog could list. */
async function themeChannelHasProducts(
  storefrontId: string,
  themeId: string,
): Promise<boolean> {
  const context = await storeContextDal.resolveForTheme(storefrontId, themeId);
  return context
    ? storeCatalogDal.hasChannelProducts(context.salesChannelId)
    : false;
}

/**
 * Creates the minimum editable website graph for a storefront channel.
 *
 * Every insert is idempotent because store initialization runs from several
 * reads. Existing themes and authored documents are never overwritten.
 */
export const storefrontDal = {
  /**
   * Run when the editor opens. Initialises an empty workspace of a Theme that
   * records an older Starter version, as it always has; that is creating the
   * Theme's files, not upgrading them. A Theme that has files is left exactly
   * as stored: no file, Document or version is written.
   */
  async ensureStoredStarterPreview(data: {
    storefrontId: string;
    themeId: string;
    createdBy: string;
  }): Promise<boolean> {
    const db = await getDb();
    const stored = await readStoredStarterVersion(
      db,
      data.storefrontId,
      data.themeId,
    );
    if (!stored.found || starterVersionState(stored.version) !== "available") {
      return false;
    }
    const workspace = await ensureStarterThemeWorkspace(
      data.storefrontId,
      data.themeId,
      data.createdBy,
    );
    if (!workspace.filesSaved) return false;
    assertStarterUpgradeRecorded(
      await ensureStarterHomeDocument(db, data.themeId, {
        ...workspace,
        storefrontId: data.storefrontId,
        record: true,
      }),
    );
    return true;
  },
  /** What a Starter upgrade would do to this Theme. Writes nothing. */
  async reviewStarterUpgrade(data: {
    storefrontId: string;
    themeId: string;
  }): Promise<StarterUpgradeReviewResult | null> {
    const db = await getDb();
    const stored = await readStoredStarterVersion(
      db,
      data.storefrontId,
      data.themeId,
    );
    if (!stored.found) return null;
    const [files, sourceGeneration, hasProducts] = await Promise.all([
      themeSourceStore.listFiles(data.storefrontId, data.themeId),
      themeSourceStore.getSourceGeneration(data.storefrontId, data.themeId),
      themeChannelHasProducts(data.storefrontId, data.themeId),
    ]);
    if (sourceGeneration === null) return null;
    return {
      sourceGeneration,
      versionState: starterVersionState(stored.version),
      storedVersion: typeof stored.version === "number" ? stored.version : null,
      currentVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
      review: reviewStarterThemeUpgrade(files, {
        storedVersion: recordedStarterVersion(stored.version),
      }),
      catalog: reviewThemeCatalog(files, { hasProducts }),
    };
  },
  /**
   * What the editor's notice needs: the stored version, and whether the
   * product catalog has something to install or update. Writes nothing.
   */
  async readStarterUpgradeStatus(data: {
    storefrontId: string;
    themeId: string;
  }): Promise<StarterUpgradeStatusDTO | null> {
    const db = await getDb();
    const stored = await readStoredStarterVersion(
      db,
      data.storefrontId,
      data.themeId,
    );
    if (!stored.found) return null;
    // The Starter is a TanStack Start Theme; a site that records another
    // framework (NULL reads as Start) is offered nothing.
    if (
      stored.framework !== null &&
      stored.framework !== UNRECORDED_THEME_FRAMEWORK
    ) {
      return null;
    }
    const [files, hasProducts] = await Promise.all([
      themeSourceStore.listFiles(data.storefrontId, data.themeId),
      themeChannelHasProducts(data.storefrontId, data.themeId),
    ]);
    const catalog = reviewThemeCatalog(files, { hasProducts });
    return {
      versionState: starterVersionState(stored.version),
      storedVersion: typeof stored.version === "number" ? stored.version : null,
      currentVersion: STOREFRONT_STARTER_TEMPLATE_VERSION,
      catalogPending: catalog.changes.length > 0 ? catalog.kind : null,
    };
  },
  /**
   * Applies the parts of a review its author confirmed, and only those.
   *
   * Each part is named by the digest the author saw: `starterDigest` for the
   * Starter upgrade, `catalogDigest` for the product catalog. The plans are
   * made again from the stored files; if the source generation or a named
   * part's digest is not the one reviewed, nothing is written. The files are
   * saved as one batch through the source store, under the generation and
   * each file's version, with one revision. Only when the Starter part was
   * confirmed does the home rule run and the version get recorded: applying
   * the catalog alone records nothing about the Starter.
   */
  async applyReviewedStarterUpgrade(data: {
    storefrontId: string;
    themeId: string;
    createdBy: string;
    expectedSourceGeneration: number;
    starterDigest?: string;
    catalogDigest?: string;
  }): Promise<StarterUpgradeApplyResult> {
    if (data.starterDigest === undefined && data.catalogDigest === undefined) {
      throw new Error("Nothing was confirmed to apply.");
    }
    const db = await getDb();
    const stored = await readStoredStarterVersion(
      db,
      data.storefrontId,
      data.themeId,
    );
    if (!stored.found)
      throw new Error("Theme not found or does not belong to storefront");
    const sourceGeneration = await themeSourceStore.getSourceGeneration(
      data.storefrontId,
      data.themeId,
    );
    if (sourceGeneration !== data.expectedSourceGeneration) {
      return { status: "stale", sourceGeneration };
    }
    const files = await themeSourceStore.listFiles(
      data.storefrontId,
      data.themeId,
    );
    const starter =
      data.starterDigest === undefined
        ? null
        : reviewStarterThemeUpgrade(files, {
            storedVersion: recordedStarterVersion(stored.version),
          });
    if (starter && !starter.applies) return { status: "not-applicable" };
    if (starter && starter.digest !== data.starterDigest) {
      return { status: "stale", sourceGeneration };
    }
    const catalog =
      data.catalogDigest === undefined
        ? null
        : reviewThemeCatalog(files, {
            hasProducts: await themeChannelHasProducts(
              data.storefrontId,
              data.themeId,
            ),
          });
    // A catalog part with nothing to write is never offered, so a confirmed
    // one that has none is refused rather than reported as applied.
    if (catalog && (!catalog.applies || catalog.changes.length === 0)) {
      return { status: "not-applicable" };
    }
    if (catalog && catalog.digest !== data.catalogDigest) {
      return { status: "stale", sourceGeneration };
    }

    const writes = [
      ...(starter?.plan.files ?? []),
      ...(catalog?.plan.files ?? []),
    ];
    const deletions = starter?.plan.deletions ?? [];
    // The two plans never name the same file; if they ever did, neither is
    // written over the other.
    const paths = [...writes, ...deletions].map((file) => file.path);
    if (new Set(paths).size !== paths.length) {
      return { status: "stale", sourceGeneration };
    }

    let savedGeneration = sourceGeneration;
    const filesSaved = writes.length > 0 || deletions.length > 0;
    if (filesSaved) {
      // Through the source store, as every other workspace save goes: it
      // decides the revision and records the manifest that names binary
      // files' bytes, and updates the source index.
      try {
        const saved = await themeSourceStore.saveFilesBatch(
          data.storefrontId,
          data.themeId,
          writes,
          {
            expectedSourceGeneration: data.expectedSourceGeneration,
            deletions,
            createRevision: true,
            revisionMessage: [
              starter ? "Upgrade Starter Theme (reviewed)" : null,
              catalog?.kind === "install"
                ? "Create storefront product catalog routes (reviewed)"
                : catalog?.kind === "update"
                  ? "Update storefront product catalog routes (reviewed)"
                  : null,
            ]
              .filter(Boolean)
              .join("; "),
            createdBy: data.createdBy,
          },
        );
        savedGeneration = saved.sourceGeneration ?? sourceGeneration + 1;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH") ||
            error.message.includes("CONFLICT_VERSION_MISMATCH"))
        ) {
          return {
            status: "stale",
            sourceGeneration: await themeSourceStore.getSourceGeneration(
              data.storefrontId,
              data.themeId,
            ),
          };
        }
        throw error;
      }
    }
    if (starter) {
      assertStarterUpgradeRecorded(
        await ensureStarterHomeDocument(db, data.themeId, {
          filesSaved,
          storefrontId: data.storefrontId,
          record: true,
        }),
      );
    }
    return {
      status: "applied",
      filesSaved,
      sourceGeneration: savedGeneration,
      starter: starter !== null,
      catalog: catalog !== null,
    };
  },
  async findActive(id?: string): Promise<StorefrontDTO | null> {
    const db = await getDb();
    const conditions = [isNull(storefronts.deletedAt)];
    if (id) conditions.push(eq(storefronts.id, id));
    const [row] = await db
      .select()
      .from(storefronts)
      .where(and(...conditions))
      .orderBy(storefronts.createdAt)
      .limit(1);
    if (!row) return null;
    const parsedPreferences = storefrontPreferencesSchema.safeParse(
      row.preferences ?? {},
    );
    return {
      id: row.id,
      salesChannelId: row.salesChannelId,
      name: row.name,
      domain: row.domain,
      status: row.status,
      activeThemeId: row.activeThemeId,
      activeReleaseId: row.activeReleaseId,
      preferences: parsedPreferences.success
        ? parsedPreferences.data
        : storefrontPreferencesSchema.parse({}),
    };
  },
  async updateWebsiteInformation(data: {
    id: string;
    name: string;
    preferences: StorefrontPreferencesDTO;
  }): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(storefronts)
      .set({
        name: data.name,
        preferences: data.preferences,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(storefronts.id, data.id), isNull(storefronts.deletedAt)));
    return Number(result.meta.changes ?? 0) > 0;
  },
  async updateAccess(data: {
    id: string;
    preferences: StorefrontPreferencesDTO;
  }): Promise<boolean> {
    const db = await getDb();
    const result = await db
      .update(storefronts)
      .set({
        preferences: data.preferences,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(storefronts.id, data.id), isNull(storefronts.deletedAt)));
    return Number(result.meta.changes ?? 0) > 0;
  },
  async ensureDefault(salesChannelId: string): Promise<void> {
    const db = await getDb();
    const [existing] = await db
      .select({ id: storefronts.id, activeThemeId: storefronts.activeThemeId })
      .from(storefronts)
      .where(
        and(
          eq(storefronts.salesChannelId, salesChannelId),
          isNull(storefronts.deletedAt),
        ),
      )
      .limit(1);

    if (existing?.activeThemeId) {
      // An existing Theme's files are its author's; only an empty workspace is
      // initialised, and only then is the version recorded.
      const workspace = await ensureStarterThemeWorkspace(
        existing.id,
        existing.activeThemeId,
      );
      assertStarterUpgradeRecorded(
        await ensureStarterHomeDocument(db, existing.activeThemeId, {
          ...workspace,
          storefrontId: existing.id,
          record: workspace.filesSaved,
        }),
      );
      return;
    }

    const now = new Date().toISOString();
    const isInitialStorefront = salesChannelId === INITIAL_SALES_CHANNEL_ID;
    const storefrontId =
      existing?.id ??
      (isInitialStorefront ? DEFAULT_STOREFRONT_ID : crypto.randomUUID());
    const themeId = isInitialStorefront
      ? DEFAULT_STOREFRONT_THEME_ID
      : crypto.randomUUID();
    const homeTemplateId = isInitialStorefront
      ? DEFAULT_HOME_TEMPLATE_ID
      : crypto.randomUUID();
    const productTemplateId = isInitialStorefront
      ? DEFAULT_PRODUCT_TEMPLATE_ID
      : crypto.randomUUID();
    const layoutTemplateId = isInitialStorefront
      ? DEFAULT_LAYOUT_TEMPLATE_ID
      : crypto.randomUUID();
    await db
      .insert(storefronts)
      .values({
        id: storefrontId,
        salesChannelId,
        name: "Online Store",
        status: "published",
        preferences: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .insert(storefrontThemes)
      .values({
        id: themeId,
        storefrontId,
        name: "Default",
        status: "published",
        // Created from the current Starter, so it records what that Starter
        // needs (R-0, R1). Only here, where the Theme is created: the
        // upgrades below never write it, so an existing Theme keeps
        // whatever it records, or nothing.
        previewRuntime: defaultPreviewRuntimeForNewTheme(
          STOREFRONT_STARTER_TEMPLATE_VERSION,
        ),
        metadata: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    await db
      .insert(storefrontThemeTemplates)
      .values([
        {
          id: homeTemplateId,
          themeId,
          type: "index",
          name: "Default",
          document: createDefaultStorefrontHomeDocument(),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: productTemplateId,
          themeId,
          type: "product",
          name: "Default product",
          document: EMPTY_DOCUMENT,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: layoutTemplateId,
          themeId,
          type: "layout",
          name: "Shell",
          document: createDefaultStorefrontLayoutDocument(),
          createdAt: now,
          updatedAt: now,
        },
      ])
      .onConflictDoNothing();

    await db
      .update(storefronts)
      .set({ activeThemeId: themeId, updatedAt: now })
      .where(eq(storefronts.id, storefrontId));

    const workspace = await ensureStarterThemeWorkspace(storefrontId, themeId);
    assertStarterUpgradeRecorded(
      await ensureStarterHomeDocument(db, themeId, {
        ...workspace,
        storefrontId,
        record: workspace.filesSaved,
      }),
    );
  },
};
