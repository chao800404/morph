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
  themeSourceStore: { saveFilesBatch: workspace.saveFilesBatch },
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
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
  hooks.beforeRecordWrite = null;
  hooks.recordWriteAttempts = 0;
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

    await expect(openEditor()).resolves.toBe(true);

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
      await expect(openEditor()).resolves.toBe(true);
    };

    await expect(openEditor()).resolves.toBe(true);

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

    await expect(openEditor()).resolves.toBe(true);

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

    await expect(openEditor()).resolves.toBe(true);

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

    await expect(openEditor()).resolves.toBe(true);

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

    await expect(openEditor()).resolves.toBe(true);

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

    await storefrontDal.ensureDefault("channel-a");

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

    const error = await openEditor().then(
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

  it("is not reported as success by store initialization", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, upgradedWorkspace());
    workspace.generation.set(THEME_ID, 5);

    await expect(storefrontDal.ensureDefault("channel-a")).rejects.toThrow(
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

  it("re-plans on the next load, writes no file twice and then records the version", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    crashOnFirstRecordWrite();

    await expect(openEditor()).rejects.toThrow("process stopped");
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: LEGACY_VERSION,
    });

    // Next load: still on the old version, so the plan runs again against
    // the already-upgraded files and finds nothing to write.
    await expect(openEditor()).resolves.toBe(true);
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(storedRow().metadata).toEqual({
      starterTemplateVersion: CURRENT,
      starterUpgradeRecordRevision: 1,
    });

    // And the load after that is a no-op.
    await expect(openEditor()).resolves.toBe(false);
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
    expect(hooks.recordWriteAttempts).toBe(2);
  });

  it("KNOWN LIMIT: nothing writes the stopped run's record once another writer advances the version", async () => {
    seedTheme({ starterTemplateVersion: LEGACY_VERSION });
    workspace.files.set(THEME_ID, legacyWorkspace());
    workspace.generation.set(THEME_ID, 5);
    crashOnFirstRecordWrite();

    await expect(openEditor()).rejects.toThrow("process stopped");
    // Before the next load, another writer brings the version to current.
    competingRecordWrite(CURRENT);
    const afterOtherWriter = storedRow();

    await expect(openEditor()).resolves.toBe(false);

    // This is the known limit, asserted so it cannot be mistaken for a
    // guarantee: the next load sees a current version and does not run the
    // upgrade, so the stopped run's own record is never written by anything.
    // There is no recovery mechanism for it. Today the record holds only the
    // version, which the other writer set; anything the record later carries
    // per run would be lost here.
    expect(storedRow()).toEqual(afterOtherWriter);
    expect(hooks.recordWriteAttempts).toBe(1);
    expect(workspace.saveFilesBatch).toHaveBeenCalledTimes(1);
  });
});
