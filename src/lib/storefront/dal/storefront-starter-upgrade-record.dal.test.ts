import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_STARTER_TEMPLATE_VERSION,
} from "../default-storefront-document";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "../starter-theme-v3-files";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";
import { createSalesChannelWriteService } from "@/lib/sales-channel/service/sales-channel-write.service";
import type { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";

/**
 * The Starter upgrade's metadata write against a real SQLite database: the
 * Drizzle reads and the D1 statements both run on the same in-memory file, so
 * a writer injected between the upgrade's read and its write is a real
 * interleaving, not a mocked return value.
 */

type WorkspaceFile = {
  id: string;
  path: string;
  content: string;
  version: number;
};

const hooks = vi.hoisted(() => ({
  /**
   * Runs immediately before each attempt of the upgrade record's conditional
   * UPDATE, i.e. after the upgrade read the metadata and before it writes.
   */
  beforeRecordWrite: null as null | (() => void | Promise<void>),
  recordWriteAttempts: 0,
  /**
   * Runs immediately before any write to `storefront_theme_templates`,
   * whether it goes through Drizzle or straight to D1, i.e. after the home
   * rule read the home template and before it writes.
   */
  beforeTemplateWrite: null as null | (() => void),
}));

const workspace = vi.hoisted(() => ({
  files: new Map<string, WorkspaceFile[]>(),
  generation: new Map<string, number>(),
  saveFilesBatch: vi.fn(),
  initStarterTheme: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          const params = Object.fromEntries(
            args.map((value, index) => [String(index + 1), value]),
          );
          return {
            run: async () => {
              if (
                sql.trim().startsWith("UPDATE storefront_themes") &&
                sql.includes("starterUpgradeRecordRevision")
              ) {
                hooks.recordWriteAttempts += 1;
                await hooks.beforeRecordWrite?.();
              }
              if (sql.trim().startsWith("UPDATE storefront_theme_templates")) {
                hooks.beforeTemplateWrite?.();
              }
              const result = sqlite.prepare(sql).run(params);
              return { meta: { changes: result.changes } };
            },
            first: async () => sqlite.prepare(sql).get(params) ?? null,
            all: async () => ({ results: sqlite.prepare(sql).all(params) }),
          };
        },
      }),
    },
  },
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));
vi.mock("./storefront-theme-file.dal", () => ({
  storefrontThemeFileDal: {
    listFiles: vi.fn(
      async (_storefrontId: string, themeId: string) =>
        workspace.files.get(themeId)?.map((file) => ({ ...file })) ?? [],
    ),
    getSourceGeneration: vi.fn(
      async (_storefrontId: string, themeId: string) =>
        workspace.generation.get(themeId) ?? null,
    ),
    initStarterTheme: workspace.initStarterTheme,
  },
}));
vi.mock("../storage/theme-storage.server", () => ({
  themeSourceStore: {
    saveFilesBatch: workspace.saveFilesBatch,
    listFiles: vi.fn(
      async (_storefrontId: string, themeId: string) =>
        workspace.files.get(themeId)?.map((file) => ({ ...file })) ?? [],
    ),
    getSourceGeneration: vi.fn(
      async (_storefrontId: string, themeId: string) =>
        workspace.generation.get(themeId) ?? null,
    ),
  },
}));

import {
  StarterUpgradeIncompleteError,
  STARTER_UPGRADE_RECORD_MAX_ATTEMPTS,
  storefrontDal,
} from "./storefront.dal";

let sqlite: Database.Database;

const STOREFRONT_ID = "storefront-a";
const THEME_ID = "theme-a";
const LEGACY_VERSION = 27;
const CURRENT = STOREFRONT_STARTER_TEMPLATE_VERSION;

function legacyWorkspace(): WorkspaceFile[] {
  return starterThemeWorkspaceFiles().map((file, index) => ({
    id: `file-${index}`,
    path: file.path,
    content:
      file.path === "src/morph/content.ts"
        ? LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE
        : file.content,
    version: 3,
  }));
}

/** The upgrade has already been applied to these files. */
function upgradedWorkspace(): WorkspaceFile[] {
  return legacyWorkspace().map((file) =>
    file.path === "src/morph/content.ts"
      ? { ...file, content: STARTER_THEME_CONTENT_MODULE_SOURCE, version: 4 }
      : file,
  );
}

function seedTheme(metadata: Record<string, unknown> | null) {
  const now = "2026-10-01T00:00:00.000Z";
  sqlite
    .prepare(
      `INSERT INTO storefronts (id, sales_channel_id, name, status, active_theme_id, metadata, created_at, updated_at)
       VALUES (?, 'channel-a', 'Online Store', 'published', ?, '{}', ?, ?)`,
    )
    .run(STOREFRONT_ID, THEME_ID, now, now);
  sqlite
    .prepare(
      `INSERT INTO storefront_themes (id, storefront_id, name, status, metadata, created_at, updated_at)
       VALUES (?, ?, 'Default', 'published', ?, ?, ?)`,
    )
    .run(
      THEME_ID,
      STOREFRONT_ID,
      metadata === null ? null : JSON.stringify(metadata),
      now,
      now,
    );
  const template = sqlite.prepare(
    `INSERT INTO storefront_theme_templates (id, theme_id, type, name, document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  template.run(
    "home",
    THEME_ID,
    "index",
    "Default",
    JSON.stringify(createDefaultStorefrontHomeDocument()),
    now,
    now,
  );
  template.run(
    "product",
    THEME_ID,
    "product",
    "Default product",
    JSON.stringify({ version: 1, sections: [] }),
    now,
    now,
  );
  template.run(
    "layout",
    THEME_ID,
    "layout",
    "Shell",
    JSON.stringify(createDefaultStorefrontLayoutDocument()),
    now,
    now,
  );
}

/** Replaces the seeded Theme's metadata column with raw text. */
function setRawMetadata(text: string) {
  sqlite
    .prepare("UPDATE storefront_themes SET metadata = ? WHERE id = ?")
    .run(text, THEME_ID);
}

function storedRawRow() {
  return sqlite
    .prepare("SELECT metadata, updated_at FROM storefront_themes WHERE id = ?")
    .get(THEME_ID) as { metadata: string | null; updated_at: string };
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (reason: unknown) => reason,
  );
}

function storedRow(themeId = THEME_ID) {
  const row = sqlite
    .prepare(
      "SELECT metadata, updated_at FROM storefront_themes WHERE id = ?",
    )
    .get(themeId) as { metadata: string | null; updated_at: string };
  return {
    metadata: row.metadata === null ? null : JSON.parse(row.metadata),
    updatedAt: row.updated_at,
  };
}

/**
 * A writer outside the upgrade that sets one key with `json_set`, the shape
 * the manifest migration uses on this column
 * (`storefront-theme-manifest-migration.dal.ts`).
 */
function singleKeyWriter(key: string, value: unknown) {
  sqlite
    .prepare(
      `UPDATE storefront_themes
       SET metadata = json_set(COALESCE(metadata, '{}'), ?, json(?))
       WHERE id = ?`,
    )
    .run(`$.${key}`, JSON.stringify(value), THEME_ID);
}

/**
 * Another record writer: advances the record revision and sets the version it
 * chose, as a concurrent upgrade (or a later same-version record update)
 * would. Applies to every Theme row, so it also reaches a Theme created
 * during the test.
 */
function competingRecordWrite(version: number) {
  sqlite
    .prepare(
      `UPDATE storefront_themes
       SET metadata = json_set(
             COALESCE(metadata, '{}'),
             '$.starterTemplateVersion', ?,
             '$.starterUpgradeRecordRevision',
             COALESCE(json_extract(metadata, '$.starterUpgradeRecordRevision'), 0) + 1
           ),
           updated_at = ?`,
    )
    .run(version, `competitor-${hooks.recordWriteAttempts}`);
}

function openEditor() {
  return storefrontDal.ensureStoredStarterPreview({
    storefrontId: STOREFRONT_ID,
    themeId: THEME_ID,
    createdBy: "user-a",
  });
}

/**
 * The author reviews the upgrade and applies exactly that review. True when
 * it was applied; the record write is the same one either way.
 */
async function applyReviewed() {
  const reviewed = await storefrontDal.reviewStarterUpgrade({
    storefrontId: STOREFRONT_ID,
    themeId: THEME_ID,
  });
  if (!reviewed) throw new Error("no review");
  const applied = await storefrontDal.applyReviewedStarterUpgrade({
    storefrontId: STOREFRONT_ID,
    themeId: THEME_ID,
    createdBy: "user-a",
    expectedSourceGeneration: reviewed.sourceGeneration,
    planDigest: reviewed.review.digest,
  });
  return applied.status === "applied";
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL,
      sales_channel_id text NOT NULL,
      name text NOT NULL,
      domain text,
      status text DEFAULT 'draft' NOT NULL,
      active_theme_id text,
      active_release_id text,
      deployment_lease_owner text,
      deployment_lease_expires_at integer,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      name text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      published_source_revision_id text,
      source_generation integer DEFAULT 1 NOT NULL,
      source_index_version integer,
      source_index_status text,
      source_index text,
      release_generation integer DEFAULT 1 NOT NULL,
      framework text,
      preview_runtime text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      route_path text,
      document text NOT NULL,
      draft_revision_id text,
      published_revision_id text,
      draft_generation integer DEFAULT 1 NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, {
      schema: storefrontSchema,
      // Drizzle logs each statement just before it runs it, which is where a
      // writer between a read and a Drizzle template update has to land.
      logger: {
        logQuery(query: string) {
          if (/^update "storefront_theme_templates"/i.test(query.trim())) {
            hooks.beforeTemplateWrite?.();
          }
        },
      },
    }) as never,
  );
  hooks.beforeRecordWrite = null;
  hooks.recordWriteAttempts = 0;
  hooks.beforeTemplateWrite = null;
  workspace.files.clear();
  workspace.generation.clear();
  workspace.saveFilesBatch.mockReset();
  workspace.initStarterTheme.mockReset();
  // The source store's save with its OCC: a stale generation is refused.
  workspace.saveFilesBatch.mockImplementation(
    async (
      _storefrontId: string,
      themeId: string,
      files: { path: string; content: string }[],
      options: { expectedSourceGeneration: number },
    ) => {
      const generation = workspace.generation.get(themeId);
      if (generation !== options.expectedSourceGeneration) {
        throw new Error("CONFLICT_SOURCE_GENERATION");
      }
      const next = (workspace.files.get(themeId) ?? []).map((file) => {
        const write = files.find((candidate) => candidate.path === file.path);
        return write
          ? { ...file, content: write.content, version: file.version + 1 }
          : file;
      });
      workspace.files.set(themeId, next);
      workspace.generation.set(themeId, generation + 1);
      return [];
    },
  );
  workspace.initStarterTheme.mockImplementation(
    async (_storefrontId: string, themeId: string) => {
      workspace.files.set(themeId, upgradedWorkspace());
      workspace.generation.set(themeId, 1);
      return [];
    },
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe("the Starter upgrade record write", () => {
  it("keeps a key another writer sets between the upgrade's read and its write", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION, unrelated: "kept" });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      singleKeyWriter("legacyManifestArchive", { version: 1 });
    };

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
      unrelated: "kept",
      legacyManifestArchive: { version: 1 },
    });
  });

  it("lets the second of two concurrent upgrades see the first one's version instead of writing its own", async () => {
    // Files already upgraded, so both runs plan nothing and go straight to
    // the record write: the path with no file OCC in front of it.
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = async () => {
      // The first run has read revision 0 and is about to write; the second
      // runs to completion in that window.
      hooks.beforeRecordWrite = null;
      await expect(applyReviewed()).resolves.toBe(true);
    };

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      // One write, the second run's. The first run's attempt matched no row
      // and, finding the version already current, did not write again.
      starterUpgradeRecordRevision: 1,
    });
    expect(hooks.recordWriteAttempts).toBe(2);
  });

  it("retries on the fresh revision when another record write kept the version below the target", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      // Same version, new revision: a version-based condition could not see
      // this write; the revision condition does.
      competingRecordWrite(LEGACY_VERSION);
    };

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 2,
    });
    expect(hooks.recordWriteAttempts).toBe(2);
  });

  it("never lowers a version another writer advanced past the target", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      competingRecordWrite(CURRENT + 5);
    };

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT + 5,
      starterUpgradeRecordRevision: 1,
    });
  });

  it("does not rewrite a version that is already above the target on store initialization", async () => {
    seedTheme({
      starterTemplateVersion: CURRENT + 1,
      starterUpgradeRecordRevision: 4,
    });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);
    const before = storedRow();

    await storefrontDal.ensureDefault("channel-a");

    expect(storedRow()).toEqual(before);
    expect(hooks.recordWriteAttempts).toBe(0);
  });

  it("applies the revision condition to a same-version record write once the version is current", async () => {
    seedTheme({
      starterTemplateVersion: LEGACY_VERSION,
      starterUpgradeRecordRevision: 3,
    });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      // The version reaches the target with no change of version afterwards
      // that a version condition could key on.
      competingRecordWrite(CURRENT);
      competingRecordWrite(CURRENT);
    };

    await expect(applyReviewed()).resolves.toBe(true);

    // The upgrade read revision 3; the stored record is at 5. Its write
    // matched nothing, and the record is exactly the other writer's.
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 5,
    });
    expect(storedRow().updatedAt).toBe("competitor-1");
    expect(hooks.recordWriteAttempts).toBe(1);
  });

  it("reads legacy metadata with no revision as revision 0", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION, unrelated: "kept" });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
      unrelated: "kept",
    });
    expect(hooks.recordWriteAttempts).toBe(1);
  });

  it("records the version on a Theme whose metadata column is NULL", async () => {
    seedTheme(null);
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });
  });
});

describe("when every record write loses its revision condition", () => {
  // Forced exhaustion: another writer advances the revision before each of
  // this run's attempts and keeps the version below the target, so the
  // condition never holds.
  let competitorMetadata: unknown;
  let competitorUpdatedAt: string;
  beforeEach(() => {
    hooks.beforeRecordWrite = () => {
      competingRecordWrite(LEGACY_VERSION);
      // Snapshot of the seeded Theme, when the test seeded one.
      const seeded = sqlite
        .prepare("SELECT id FROM storefront_themes WHERE id = ?")
        .get(THEME_ID);
      if (seeded) {
        const row = storedRow();
        competitorMetadata = row.metadata;
        competitorUpdatedAt = row.updatedAt;
      }
    };
  });

  it("reports partial completion, writes no metadata and leaves the version where it was", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION, unrelated: "kept" });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);

    const error = await applyReviewed().then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(StarterUpgradeIncompleteError);
    expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
      status: "partial",
      reason: "record-revision-conflict",
      filesSaved: true,
      attempts: STARTER_UPGRADE_RECORD_MAX_ATTEMPTS,
    });
    expect((error as Error).message).toMatch(/only partly completed/);
    expect(hooks.recordWriteAttempts).toBe(STARTER_UPGRADE_RECORD_MAX_ATTEMPTS);
    // Nothing this run wrote: the row is exactly what the other writer left.
    expect(storedRow().metadata).toEqual(competitorMetadata);
    expect(storedRow().updatedAt).toBe(competitorUpdatedAt);
    // Neither advanced nor lowered.
    expect(storedRow().metadata.starterTemplateVersion).toBe(LEGACY_VERSION);
    expect(storedRow().metadata.unrelated).toBe("kept");
    // The files were upgraded before the record write.
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(
      workspace.files
        .get(THEME_ID)!
        .find((file) => file.path === "src/morph/content.ts")!.content,
    ).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect(console.error).toHaveBeenCalledWith(
      "Starter upgrade record not saved:",
      expect.stringContaining('"status":"partial"'),
    );
  });

  it("is not reported as success by an applied upgrade", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).rejects.toThrow(
      StarterUpgradeIncompleteError,
    );
    expect(storedRow().metadata.starterTemplateVersion).toBe(LEGACY_VERSION);
  });

  it("is not reported as success by sales channel creation", async () => {
    const channels = {
      findByName: vi.fn(async () => null),
      create: vi.fn(async () => undefined),
      softDelete: vi.fn(async () => undefined),
    } as unknown as typeof salesChannelDal;
    const service = createSalesChannelWriteService({
      channels,
      storefronts: storefrontDal,
      createId: () => "channel-new",
    });

    const result = await service.create({
      name: "Second store",
      type: "storefront",
    });

    expect(result).toMatchObject({
      success: false,
      error: "CREATE_FAILED",
      // The new Theme's Starter files were written before the record.
      message: expect.stringMatching(/only partly completed/),
    });
    expect(channels.softDelete).toHaveBeenCalledWith(["channel-new"]);
  });
});

describe("a restart between the file save and the record write", () => {
  function crashOnFirstRecordWrite() {
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      throw new Error("process stopped");
    };
  }

  it("re-plans on the next review, writes no file twice and then records the version", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    crashOnFirstRecordWrite();

    await expect(applyReviewed()).rejects.toThrow("process stopped");
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: LEGACY_VERSION,
    });

    // Next review: still on the old version, so the plan is made again from
    // the already-upgraded files and finds nothing to write.
    await expect(applyReviewed()).resolves.toBe(true);
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });

    // And applying again writes nothing: no file, no record.
    await expect(applyReviewed()).resolves.toBe(true);
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(hooks.recordWriteAttempts).toBe(2);
  });

  it("KNOWN LIMIT: nothing writes the stopped run's record once another writer advances the version", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    crashOnFirstRecordWrite();

    await expect(applyReviewed()).rejects.toThrow("process stopped");
    // Before the next load, another writer brings the version to current.
    competingRecordWrite(CURRENT);
    const afterOtherWriter = storedRow();

    await expect(applyReviewed()).resolves.toBe(true);

    // This is the known limit, asserted so it cannot be mistaken for a
    // guarantee: the next load sees a current version and does not run the
    // record write, so the stopped run's own record is never written by anything.
    // There is no recovery mechanism for it. Today the record holds only the
    // version, which the other writer set; anything the record later carries
    // per run would be lost here. The same holds whenever a run ends in
    // `already-current` because someone else wrote the version, including a
    // different code version (older or newer than this one): this run's own
    // record is dropped, not merged.
    expect(storedRow()).toEqual(afterOtherWriter);
    expect(hooks.recordWriteAttempts).toBe(1);
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
  });
});

// Classification of stored metadata, case by case.
//
// Legitimate (loading works, existing compatibility rules apply): SQL NULL,
// `{}`, a missing `starterTemplateVersion`, a missing or JSON-null revision.
// See "legitimately unset metadata" below.
//
// Anomalous (the data is kept, the record write is refused, the run reports
// partial with its own reason, and loading fails until the data is fixed by
// hand): JSON `null` text, an array, a string, a number, malformed JSON text,
// and a revision that is a string, a fraction, negative or a boolean.
describe("legitimately unset metadata", () => {
  it("records the version for a SQL NULL column when the author applies the upgrade", async () => {
    seedTheme(null);
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });
  });

  it("records the version for `{}` when the author applies the upgrade", async () => {
    seedTheme({});
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });
  });

  it("records the version and keeps other keys when only the version key is missing once the author applies the upgrade", async () => {
    seedTheme({ unrelated: "kept" });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
      unrelated: "kept",
    });
  });

  it.each([
    ["SQL NULL", null],
    ["{}", {}],
    ["no version key", { unrelated: "kept" }],
  ])(
    "skips the editor-load upgrade, as before, for %s",
    async (_label, metadata) => {
      seedTheme(metadata);
      workspace.files.set(THEME_ID, legacyWorkspace());
      workspace.generation.set(THEME_ID, 5);
      const before = storedRawRow();

      // No version to upgrade from: the editor load does not run the upgrade.
      await expect(openEditor()).resolves.toBe(false);
      expect(storedRawRow()).toEqual(before);
      expect(workspace.saveFilesBatch).not.toHaveBeenCalled();
      expect(hooks.recordWriteAttempts).toBe(0);
    },
  );

  it("reads a JSON-null revision as 0 and records", async () => {
    seedTheme({
      starterTemplateVersion: LEGACY_VERSION,
      starterUpgradeRecordRevision: null,
    });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });
  });
});

describe("metadata the record cannot be written into", () => {
  // `json_set` on non-object JSON stores nothing but still reports a changed
  // row, which used to read as `recorded`.
  it.each([
    ["JSON null", "null"],
    ["an array", "[]"],
    ["a string", '"starter"'],
    ["a number", "5"],
  ])(
    "ends in partial, never recorded, when the column holds %s",
    async (_label, raw) => {
      seedTheme({});
      setRawMetadata(raw);
      workspace.files.set(THEME_ID, upgradedWorkspace());
      workspace.generation.set(THEME_ID, 5);
      const before = storedRawRow();

      const error = await rejection(applyReviewed());

      expect(error).toBeInstanceOf(StarterUpgradeIncompleteError);
      expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
        status: "partial",
        reason: "non-object-metadata",
        filesSaved: false,
        attempts: 1,
      });
      expect(storedRawRow()).toEqual(before);
      expect(hooks.recordWriteAttempts).toBe(1);

      // Applying keeps failing, with the data untouched, until it is fixed by
      // hand; nothing clears or rewrites it.
      await expect(applyReviewed()).rejects.toThrow(
        StarterUpgradeIncompleteError,
      );
      expect(storedRawRow()).toEqual(before);
      setRawMetadata("{}");
      await expect(applyReviewed()).resolves.toBe(true);
    },
  );

  it("ends in partial when the metadata stops being an object between the read and the write", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      setRawMetadata("[]");
    };

    const error = await rejection(applyReviewed());

    expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
      status: "partial",
      reason: "non-object-metadata",
      filesSaved: true,
      attempts: 1,
    });
    expect(storedRawRow().metadata).toBe("[]");
  });

  it("refuses malformed JSON text at the first read, before any file or metadata write", async () => {
    // Explicit, not partial: the Drizzle read of the JSON column throws before
    // the upgrade decides anything, so nothing was saved.
    seedTheme({});
    setRawMetadata("{not json");
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(openEditor()).rejects.toThrow(SyntaxError);
    await expect(applyReviewed()).rejects.toThrow(SyntaxError);
    await expect(storefrontDal.ensureDefault("channel-a")).rejects.toThrow(
      SyntaxError,
    );

    expect(storedRawRow().metadata).toBe("{not json");
    expect(workspace.saveFilesBatch).not.toHaveBeenCalled();
    expect(hooks.recordWriteAttempts).toBe(0);

    // And on the next load, until the text is fixed by hand.
    await expect(openEditor()).rejects.toThrow(SyntaxError);
    expect(storedRawRow().metadata).toBe("{not json");
  });

  it("throws after the file save when the metadata turns malformed before the upgrade's metadata read", async () => {
    // Fails closed: the files are saved, no metadata is written, and the
    // error reaches the caller. It is not a partial outcome.
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    const save = workspace.saveFilesBatch.getMockImplementation()!;
    workspace.saveFilesBatch.mockImplementationOnce(async (...args) => {
      const result = await save(...args);
      setRawMetadata("{not json");
      return result;
    });

    await expect(applyReviewed()).rejects.toThrow(SyntaxError);

    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(storedRawRow().metadata).toBe("{not json");
    expect(hooks.recordWriteAttempts).toBe(0);
  });

  // This test pins that the record write does not raise on malformed text. It
  // cannot pin the CASE nesting over an AND chain: the SQLite build used here
  // happens to short-circuit AND too, so both pass. The nesting stays because
  // only CASE's lazy evaluation is documented.
  it("ends in partial when the metadata turns into malformed JSON between the read and the write", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      setRawMetadata("{not json");
    };

    const error = await rejection(applyReviewed());

    expect(error).toBeInstanceOf(StarterUpgradeIncompleteError);
    expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
      status: "partial",
      reason: "malformed-metadata",
      filesSaved: true,
      attempts: 1,
    });
    expect(storedRawRow().metadata).toBe("{not json");
  });
});

describe("a record revision the upgrade cannot read", () => {
  // The lockout itself is deliberate and unchanged: until the stored value is
  // corrected in the database, every load ends in partial.
  it.each([
    ["a string", "1"],
    ["a fraction", 1.5],
    ["a negative number", -1],
    ["JSON true", true],
    ["JSON false", false],
  ])(
    "ends in partial before any record write when the stored revision is %s",
    async (_label, revision) => {
      seedTheme({
        starterTemplateVersion: LEGACY_VERSION,
        starterUpgradeRecordRevision: revision,
      });
      workspace.files.set(THEME_ID, legacyWorkspace());
      workspace.generation.set(THEME_ID, 5);
      const before = storedRawRow();

      const error = await rejection(applyReviewed());

      expect(error).toBeInstanceOf(StarterUpgradeIncompleteError);
      expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
        status: "partial",
        reason: "unreadable-record-revision",
        filesSaved: true,
        attempts: 0,
      });
      expect(hooks.recordWriteAttempts).toBe(0);
      // The stored value is never overwritten: raw metadata text and
      // updated_at are byte-identical.
      expect(storedRawRow()).toEqual(before);
      expect(console.error).toHaveBeenCalledWith(
        "Starter upgrade record not saved:",
        expect.stringContaining('"storefrontId":"storefront-a"'),
      );

      // Loading keeps failing until the value is fixed by hand.
      await expect(applyReviewed()).rejects.toThrow(StarterUpgradeIncompleteError);
      expect(storedRawRow()).toEqual(before);
    },
  );

  it.each([
    // json_extract reports these as 1 and 0, the revisions the upgrade read.
    ["JSON true", 1, true],
    ["JSON false", 0, false],
  ])(
    "does not overwrite a revision another writer set to %s between the read and the write",
    async (_label, readRevision, written) => {
      seedTheme({
        starterTemplateVersion: LEGACY_VERSION,
        ...(readRevision === 0 ? {} : { starterUpgradeRecordRevision: readRevision }),
      });
      workspace.files.set(THEME_ID, legacyWorkspace());
      workspace.generation.set(THEME_ID, 5);
      let afterOtherWriter: ReturnType<typeof storedRawRow> | undefined;
      hooks.beforeRecordWrite = () => {
        hooks.beforeRecordWrite = null;
        singleKeyWriter("starterUpgradeRecordRevision", written);
        afterOtherWriter = storedRawRow();
      };

      const error = await rejection(applyReviewed());

      expect(error).toBeInstanceOf(StarterUpgradeIncompleteError);
      expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
        status: "partial",
        reason: "unreadable-record-revision",
        filesSaved: true,
        attempts: 1,
      });
      // Byte-identical: neither recorded over the boolean nor rewritten.
      expect(storedRawRow()).toEqual(afterOtherWriter);
      expect(hooks.recordWriteAttempts).toBe(1);
    },
  );

  it("accepts a whole-number revision stored as a JSON real", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    setRawMetadata(
      `{"starterTemplateVersion":${LEGACY_VERSION},"starterUpgradeRecordRevision":2.0}`,
    );
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 3,
    });
    expect(hooks.recordWriteAttempts).toBe(1);
  });

  it("ends in partial when a revision miss re-reads one it cannot use", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    let afterOtherWriter: ReturnType<typeof storedRawRow> | undefined;
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      singleKeyWriter("starterUpgradeRecordRevision", 1.5);
      afterOtherWriter = storedRawRow();
    };

    const error = await rejection(applyReviewed());

    expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
      status: "partial",
      reason: "unreadable-record-revision",
      filesSaved: true,
      attempts: 1,
    });
    // The stored value is never overwritten: the row is byte-identical to
    // what the other writer left.
    expect(storedRawRow()).toEqual(afterOtherWriter);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: LEGACY_VERSION,
      starterUpgradeRecordRevision: 1.5,
    });
    expect(hooks.recordWriteAttempts).toBe(1);
  });
});

describe("a Theme row that disappears before the record write", () => {
  it("ends in partial when the re-read after a miss finds no row", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    hooks.beforeRecordWrite = () => {
      hooks.beforeRecordWrite = null;
      sqlite.prepare("DELETE FROM storefront_themes WHERE id = ?").run(THEME_ID);
    };

    const error = await rejection(applyReviewed());

    expect(error).toBeInstanceOf(StarterUpgradeIncompleteError);
    expect((error as StarterUpgradeIncompleteError).outcome).toEqual({
      status: "partial",
      reason: "theme-missing",
      filesSaved: true,
      attempts: 1,
    });
  });
});

/**
 * The home rule: on a Theme whose Starter version is not current,
 * `ensureDefault` may replace the home template's document with the default
 * home document.
 */
describe("the Starter home document rule", () => {
  /** Morph's own V14 Starter home, byte for byte. */
  const LEGACY_HOME = {
    version: 1,
    sections: [
      {
        id: "starter-hero",
        type: "hero",
        enabled: true,
        props: {
          eyebrow: "New collection",
          heading: "Objects for everyday rituals.",
          description:
            "Quiet essentials, thoughtfully made for the spaces you call home.",
          actionLabel: "Explore the collection",
          actionHref: "/collections/new",
          imageSrc: "/static/storefront/theme-preview-default.png",
          imageAlt: "A neutral collection of ceramic objects",
        },
      },
    ],
  };
  const EMPTY_HOME = { version: 1, sections: [] };
  const AUTHORED_HOME = {
    version: 1,
    sections: [
      {
        id: "author-banner",
        type: "hero",
        enabled: true,
        props: { heading: "The author's own page" },
      },
    ],
  };

  function setHome(home: {
    document: unknown;
    draftRevisionId?: string | null;
    publishedRevisionId?: string | null;
    draftGeneration?: number;
  }) {
    sqlite
      .prepare(
        `UPDATE storefront_theme_templates
         SET document = ?, draft_revision_id = ?, published_revision_id = ?,
             draft_generation = ?
         WHERE id = 'home'`,
      )
      .run(
        JSON.stringify(home.document),
        home.draftRevisionId ?? null,
        home.publishedRevisionId ?? null,
        home.draftGeneration ?? 1,
      );
  }

  function storedHome(themeId = THEME_ID) {
    const row = sqlite
      .prepare(
        `SELECT document, draft_revision_id, published_revision_id,
                draft_generation, updated_at
         FROM storefront_theme_templates
         WHERE theme_id = ? AND type = 'index'`,
      )
      .get(themeId) as {
      document: string;
      draft_revision_id: string | null;
      published_revision_id: string | null;
      draft_generation: number;
      updated_at: string;
    };
    return { ...row, document: JSON.parse(row.document) as unknown };
  }

  /**
   * An author write that lands on the home template's own document: publishing
   * the home, which stores the published document on the template and
   * advances its draft generation (`storefront-theme.dal.ts`).
   */
  function authorPublishesHome() {
    sqlite
      .prepare(
        `UPDATE storefront_theme_templates
         SET document = ?, draft_revision_id = 'rev-author',
             published_revision_id = 'rev-author',
             draft_generation = draft_generation + 1,
             updated_at = 'author-publish'
         WHERE id = 'home'`,
      )
      .run(JSON.stringify(AUTHORED_HOME));
  }

  it.each([
    ["an empty home", EMPTY_HOME],
    ["Morph's legacy home", LEGACY_HOME],
  ])(
    "keeps an author write that lands between the home read and the home write (%s)",
    async (_label, document) => {
      seedTheme({});
      setHome({ document });
      let raced = 0;
      hooks.beforeTemplateWrite = () => {
        hooks.beforeTemplateWrite = null;
        raced += 1;
        authorPublishesHome();
      };

      await expect(storefrontDal.ensureDefault("channel-a")).resolves.toBe(
        undefined,
      );

      expect(raced).toBe(1);
      // The author's write is exactly what is stored: the home rule's write
      // lost its draft-generation condition and changed nothing.
      expect(storedHome()).toEqual({
        document: AUTHORED_HOME,
        draft_revision_id: "rev-author",
        published_revision_id: "rev-author",
        draft_generation: 2,
        updated_at: "author-publish",
      });
      // The record is written as before.
      expect(storedRow().metadata).toEqual({
        starterTemplateVersion: CURRENT,
        starterUpgradeRecordRevision: 1,
      });
    },
  );

  it.each([
    [
      "published",
      { draftRevisionId: "rev-a", publishedRevisionId: "rev-a", draftGeneration: 3 },
    ],
    [
      "saved as a draft",
      { draftRevisionId: "rev-b", publishedRevisionId: null, draftGeneration: 2 },
    ],
  ])("does not refill a home an author emptied and %s", async (_label, pointers) => {
    seedTheme({});
    setHome({ document: EMPTY_HOME, ...pointers });
    const before = storedHome();

    await storefrontDal.ensureDefault("channel-a");

    expect(storedHome()).toEqual(before);
    expect(storedRow().metadata.starterTemplateVersion).toBe(CURRENT);
  });

  it("does not refill an emptied home when the author applies the upgrade either", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    setHome({
      document: EMPTY_HOME,
      draftRevisionId: "rev-a",
      publishedRevisionId: "rev-a",
      draftGeneration: 3,
    });
    const before = storedHome();

    await expect(applyReviewed()).resolves.toBe(true);

    expect(storedHome()).toEqual(before);
    expect(storedRow().metadata.starterTemplateVersion).toBe(CURRENT);
  });

  it.each([
    [
      "no revision",
      { draftRevisionId: null, publishedRevisionId: null, draftGeneration: 1 },
    ],
    [
      "a published revision",
      { draftRevisionId: "rev-a", publishedRevisionId: "rev-a", draftGeneration: 4 },
    ],
  ])(
    "still upgrades Morph's legacy home when nothing raced (%s)",
    async (_label, pointers) => {
      seedTheme({});
      setHome({ document: LEGACY_HOME, ...pointers });

      await storefrontDal.ensureDefault("channel-a");

      const home = storedHome();
      expect(home.document).toEqual(createDefaultStorefrontHomeDocument());
      expect(home.draft_revision_id).toBe(pointers.draftRevisionId);
      expect(home.published_revision_id).toBe(pointers.publishedRevisionId);
      // A document write names a new generation, as every other one does.
      expect(home.draft_generation).toBe(pointers.draftGeneration + 1);
      expect(storedRow().metadata.starterTemplateVersion).toBe(CURRENT);
    },
  );

  it("fills an empty home no content write ever reached", async () => {
    seedTheme({});
    setHome({ document: EMPTY_HOME });

    await storefrontDal.ensureDefault("channel-a");

    const home = storedHome();
    expect(home.document).toEqual(createDefaultStorefrontHomeDocument());
    expect(home.draft_revision_id).toBeNull();
    expect(home.published_revision_id).toBeNull();
    expect(home.draft_generation).toBe(2);
  });

  it("gives a Theme store initialization creates its default home", async () => {
    await storefrontDal.ensureDefault("channel-new");

    const storefront = sqlite
      .prepare(
        "SELECT id, active_theme_id FROM storefronts WHERE sales_channel_id = ?",
      )
      .get("channel-new") as { id: string; active_theme_id: string };
    const home = storedHome(storefront.active_theme_id);
    expect(home.document).toEqual(createDefaultStorefrontHomeDocument());
    expect(home.draft_revision_id).toBeNull();
    expect(home.draft_generation).toBe(1);
    expect(storedRow(storefront.active_theme_id).metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });
  });
});

describe("a Starter version that is not a number", () => {
  it.each([["28"], [true], [{ version: 28 }]])(
    "is logged with the Theme's ids and a fixed reason only, then recorded as before (%j)",
    async (stored) => {
      seedTheme({
        starterTemplateVersion: stored,
        unrelated: "kept",
      });

      await expect(storefrontDal.ensureDefault("channel-a")).resolves.toBe(
        undefined,
      );

      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        "Starter template version is not a number:",
        JSON.stringify({
          storefrontId: STOREFRONT_ID,
          themeId: THEME_ID,
          reason: "non-number-starter-template-version",
        }),
      );
      // Overwritten as before (option c1).
      expect(storedRow().metadata).toEqual({
        starterTemplateVersion: CURRENT,
        starterUpgradeRecordRevision: 1,
        unrelated: "kept",
      });
    },
  );

  it.each([
    ["a missing version", {}],
    ["a JSON-null version", { starterTemplateVersion: null }],
    ["a legacy number", { starterTemplateVersion: 3 }],
  ])("is not logged for %s", async (_label, metadata) => {
    seedTheme(metadata);

    await storefrontDal.ensureDefault("channel-a");

    expect(console.error).not.toHaveBeenCalled();
    expect(storedRow().metadata.starterTemplateVersion).toBe(CURRENT);
  });
});

describe("opening the editor and store initialization on a Theme that has files", () => {
  function storedTemplates() {
    return sqlite
      .prepare(
        "SELECT id, document, draft_generation, updated_at FROM storefront_theme_templates ORDER BY id",
      )
      .all();
  }

  it.each([
    ["an older version", { starterTemplateVersion: LEGACY_VERSION }],
    ["no version", {}],
    ["a SQL NULL column", null],
    ["a version that is not a number", { starterTemplateVersion: "28" }],
  ])(
    "writes no file, Document or version for %s",
    async (_label, metadata) => {
      seedTheme(metadata);
      workspace.files.set(THEME_ID, legacyWorkspace());
      workspace.generation.set(THEME_ID, 5);
      const before = { row: storedRawRow(), templates: storedTemplates() };
      const filesBefore = workspace.files.get(THEME_ID);

      await expect(openEditor()).resolves.toBe(false);
      await expect(storefrontDal.ensureDefault("channel-a")).resolves.toBe(
        undefined,
      );

      expect(storedRawRow()).toEqual(before.row);
      expect(storedTemplates()).toEqual(before.templates);
      expect(workspace.files.get(THEME_ID)).toBe(filesBefore);
      expect(workspace.saveFilesBatch).not.toHaveBeenCalled();
      expect(workspace.initStarterTheme).not.toHaveBeenCalled();
      expect(hooks.recordWriteAttempts).toBe(0);
    },
  );

  it("leaves a version that says nothing pending, not the latest", async () => {
    seedTheme({});
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await storefrontDal.ensureDefault("channel-a");

    await expect(
      storefrontDal.readStarterUpgradeStatus({
        storefrontId: STOREFRONT_ID,
        themeId: THEME_ID,
      }),
    ).resolves.toEqual({
      versionState: "pending",
      storedVersion: null,
      currentVersion: CURRENT,
    });
  });
});

describe("applying a reviewed Starter upgrade", () => {
  async function review() {
    const reviewed = await storefrontDal.reviewStarterUpgrade({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
    });
    if (!reviewed) throw new Error("no review");
    return reviewed;
  }

  function apply(expectedSourceGeneration: number, planDigest: string) {
    return storefrontDal.applyReviewedStarterUpgrade({
      storefrontId: STOREFRONT_ID,
      themeId: THEME_ID,
      createdBy: "user-a",
      expectedSourceGeneration,
      planDigest,
    });
  }

  it("lists the change, writes nothing while reviewing, and applies only what was reviewed", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    const before = storedRawRow();

    const reviewed = await review();

    expect(reviewed.versionState).toBe("available");
    expect(reviewed.review.changes.map((change) => change.path)).toEqual([
      "src/morph/content.ts",
    ]);
    expect(storedRawRow()).toEqual(before);
    expect(workspace.saveFilesBatch).not.toHaveBeenCalled();

    await expect(apply(5, reviewed.review.digest)).resolves.toEqual({
      status: "applied",
      filesSaved: true,
      sourceGeneration: 6,
    });
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(workspace.saveFilesBatch).toHaveBeenCalledWith(
      STOREFRONT_ID,
      THEME_ID,
      reviewed.review.plan.files,
      expect.objectContaining({
        expectedSourceGeneration: 5,
        createRevision: true,
        createdBy: "user-a",
      }),
    );
    expect(storedRow().metadata.starterTemplateVersion).toBe(CURRENT);
  });

  it("writes nothing when the workspace moved on since the review", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    const reviewed = await review();
    workspace.generation.set(THEME_ID, 6);
    const before = storedRawRow();

    await expect(apply(5, reviewed.review.digest)).resolves.toEqual({
      status: "stale",
      sourceGeneration: 6,
    });
    expect(workspace.saveFilesBatch).not.toHaveBeenCalled();
    expect(storedRawRow()).toEqual(before);
  });

  it("writes nothing when the plan is not the one reviewed", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    const before = storedRawRow();

    await expect(apply(5, "0".repeat(64))).resolves.toEqual({
      status: "stale",
      sourceGeneration: 5,
    });
    expect(workspace.saveFilesBatch).not.toHaveBeenCalled();
    expect(storedRawRow()).toEqual(before);
  });

  it("records a pending version only once the author applies the review", async () => {
    seedTheme({});
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    const reviewed = await review();
    expect(reviewed.versionState).toBe("pending");
    expect(reviewed.review.changes).toEqual([]);
    expect(storedRow().metadata).toEqual({});

    await expect(apply(5, reviewed.review.digest)).resolves.toMatchObject({
      status: "applied",
      filesSaved: false,
    });
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });
  });
});
