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
import { storefrontPreferencesSchema } from "@/lib/validations/storefront";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  isUpgradeableStarterHomeDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";
import { createStarterThemeWorkspaceUpgradePlan } from "../starter-theme-files";
import { themeSourceStore } from "../storage/theme-storage.server";

export const DEFAULT_STOREFRONT_ID = "00000000-0000-4000-8000-000000000002";
export const DEFAULT_STOREFRONT_THEME_ID =
  "00000000-0000-4000-8000-000000000003";
const DEFAULT_HOME_TEMPLATE_ID = "00000000-0000-4000-8000-000000000004";
const DEFAULT_PRODUCT_TEMPLATE_ID = "00000000-0000-4000-8000-000000000005";
const DEFAULT_LAYOUT_TEMPLATE_ID = "00000000-0000-4000-8000-000000000006";
const INITIAL_SALES_CHANNEL_ID = "00000000-0000-4000-8000-000000000001";

const EMPTY_DOCUMENT: StorefrontPageDocument = { version: 1, sections: [] };

type StorefrontDb = Awaited<ReturnType<typeof getDb>>;

async function ensureStarterHomeDocument(
  db: StorefrontDb,
  themeId: string,
  options: { filesSaved: boolean },
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

  if (homeTemplate && isUpgradeableStarterHomeDocument(homeTemplate.document)) {
    await db
      .update(storefrontThemeTemplates)
      .set({
        document: createDefaultStorefrontHomeDocument(),
        updatedAt: now,
      })
      .where(eq(storefrontThemeTemplates.id, homeTemplate.id));
  }

  const readRevision = readStarterUpgradeRecordRevision(
    metadata.starterUpgradeRecordRevision,
  );
  if (readRevision === null) {
    return reportIncompleteStarterUpgrade(themeId, {
      status: "partial",
      reason: "unreadable-record-revision",
      filesSaved: options.filesSaved,
      attempts: 0,
    });
  }
  return writeStarterUpgradeRecord(themeId, {
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
 */
export type StarterUpgradeRecordOutcome =
  | { status: "recorded"; version: number; revision: number; attempts: number }
  | { status: "already-current"; storedVersion: number }
  | { status: "skipped"; reason: "theme-missing" }
  | StarterUpgradePartialOutcome;

export type StarterUpgradePartialOutcome = {
  status: "partial";
  reason:
    | "record-revision-conflict"
    | "theme-missing"
    | "unreadable-record-revision";
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

function reportIncompleteStarterUpgrade(
  themeId: string,
  outcome: StarterUpgradePartialOutcome,
): StarterUpgradePartialOutcome {
  console.error(
    "Starter upgrade record not saved:",
    JSON.stringify({ themeId, ...outcome }),
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
 */
async function writeStarterUpgradeRecord(
  themeId: string,
  args: {
    readRevision: number;
    targetVersion: number;
    filesSaved: boolean;
    now: string;
  },
): Promise<StarterUpgradeRecordOutcome> {
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
         AND COALESCE(json_extract(metadata, '$.starterUpgradeRecordRevision'), 0) = ?5`,
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
      `SELECT json_extract(metadata, '$.starterTemplateVersion') AS version,
              json_extract(metadata, '$.starterUpgradeRecordRevision') AS revision
       FROM storefront_themes
       WHERE id = ?1`,
    )
      .bind(themeId)
      .first<{ version: unknown; revision: unknown }>();
    if (!stored) {
      return reportIncompleteStarterUpgrade(themeId, {
        status: "partial",
        reason: "theme-missing",
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
    const freshRevision = readStarterUpgradeRecordRevision(stored.revision);
    if (freshRevision === null) {
      return reportIncompleteStarterUpgrade(themeId, {
        status: "partial",
        reason: "unreadable-record-revision",
        filesSaved: args.filesSaved,
        attempts: attempt,
      });
    }
    readRevision = freshRevision;
  }
  return reportIncompleteStarterUpgrade(themeId, {
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

async function ensureStarterThemeWorkspace(
  storefrontId: string,
  themeId: string,
  upgradeExistingStarter: boolean,
  createdBy?: string,
): Promise<{ filesSaved: boolean }> {
  const existingFiles = await storefrontThemeFileDal.listFiles(
    storefrontId,
    themeId,
  );
  if (existingFiles.length === 0) {
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
  if (!upgradeExistingStarter) return { filesSaved: false };

  const upgradePlan = createStarterThemeWorkspaceUpgradePlan(existingFiles);
  if (upgradePlan.files.length === 0 && upgradePlan.deletions.length === 0) {
    return { filesSaved: false };
  }
  const sourceGeneration = await storefrontThemeFileDal.getSourceGeneration(
    storefrontId,
    themeId,
  );
  if (sourceGeneration === null) {
    throw new Error("Starter Theme source generation is unavailable.");
  }
  // Through the source store, as every other workspace save goes: it decides
  // the revision and records the manifest that names binary files' bytes, and
  // updates the source index. Written straight to the DAL, the revision had no
  // manifest, which the DAL refuses for a workspace holding any binary file
  // (an uploaded image is enough), so the upgrade failed on every editor load
  // and the editor could not open.
  await themeSourceStore.saveFilesBatch(
    storefrontId,
    themeId,
    upgradePlan.files,
    {
      expectedSourceGeneration: sourceGeneration,
      deletions: upgradePlan.deletions,
      createRevision: true,
      revisionMessage: "Upgrade Starter Theme route workspace",
      createdBy,
    },
  );
  return { filesSaved: true };
}

async function shouldUpgradeStarterWorkspace(
  db: StorefrontDb,
  storefrontId: string,
  themeId: string,
): Promise<boolean> {
  const [theme] = await db
    .select({ metadata: storefrontThemes.metadata })
    .from(storefrontThemes)
    .where(
      and(
        eq(storefrontThemes.id, themeId),
        eq(storefrontThemes.storefrontId, storefrontId),
        isNull(storefrontThemes.deletedAt),
      ),
    )
    .limit(1);
  const version = theme?.metadata?.starterTemplateVersion;
  return (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version > 0 &&
    version < STOREFRONT_STARTER_TEMPLATE_VERSION
  );
}

/**
 * Creates the minimum editable website graph for a storefront channel.
 *
 * Every insert is idempotent because store initialization runs from several
 * reads. Existing themes and authored documents are never overwritten.
 */
export const storefrontDal = {
  async ensureStoredStarterPreview(data: {
    storefrontId: string;
    themeId: string;
    createdBy: string;
  }): Promise<boolean> {
    const db = await getDb();
    const shouldUpgrade = await shouldUpgradeStarterWorkspace(
      db,
      data.storefrontId,
      data.themeId,
    );
    if (!shouldUpgrade) return false;

    // A refused file save throws here, before any metadata write.
    const workspace = await ensureStarterThemeWorkspace(
      data.storefrontId,
      data.themeId,
      true,
      data.createdBy,
    );
    assertStarterUpgradeRecorded(
      await ensureStarterHomeDocument(db, data.themeId, workspace),
    );
    return true;
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
      const upgradeExistingStarter = await shouldUpgradeStarterWorkspace(
        db,
        existing.id,
        existing.activeThemeId,
      );
      const workspace = await ensureStarterThemeWorkspace(
        existing.id,
        existing.activeThemeId,
        upgradeExistingStarter,
      );
      assertStarterUpgradeRecorded(
        await ensureStarterHomeDocument(db, existing.activeThemeId, workspace),
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

    const workspace = await ensureStarterThemeWorkspace(
      storefrontId,
      themeId,
      false,
    );
    assertStarterUpgradeRecorded(
      await ensureStarterHomeDocument(db, themeId, workspace),
    );
  },
};
