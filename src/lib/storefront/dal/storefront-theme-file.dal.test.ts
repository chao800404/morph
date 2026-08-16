import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          const hasNumbered = /\?\d+/.test(sql);
          const params = hasNumbered
            ? Object.fromEntries(args.map((val, idx) => [String(idx + 1), val]))
            : args;
          return {
            run: () => {
              const stmt = sqlite.prepare(sql);
              if (sql.trim().toUpperCase().startsWith("SELECT")) {
                const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
                return { results: res };
              }
              const res = hasNumbered ? stmt.run(params) : stmt.run(...args);
              return { meta: { changes: res.changes } };
            },
            all: () => {
              const stmt = sqlite.prepare(sql);
              const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
              return { results: res };
            },
            first: () => {
              const stmt = sqlite.prepare(sql);
              return hasNumbered ? stmt.get(params) : stmt.get(...args);
            },
          };
        },
      }),
      batch: async (statements: Array<any>) => {
        return statements.map((s) => {
          if (typeof s.run === "function") return s.run();
          if (typeof s.all === "function") return s.all();
          return {};
        });
      },
    },
  },
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL,
      sales_channel_id text NOT NULL,
      name text NOT NULL,
      domain text,
      status text NOT NULL,
      active_theme_id text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL,
      published_source_revision_id text,
      source_generation integer DEFAULT 1 NOT NULL,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_files (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      path text NOT NULL,
      content text NOT NULL,
      mime_type text,
      is_entry integer DEFAULT 0,
      version integer DEFAULT 1,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      revision_number integer NOT NULL,
      message text,
      source text,
      snapshot text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_files_unique_path_idx
    ON storefront_theme_files (storefront_id, theme_id, path)
    WHERE deleted_at IS NULL;
  `);

  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Theme A', 'draft', 1, 'now', 'now');
  `);

  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("storefront theme file DAL", () => {
  it("increments source_generation on saveFilesBatch", async () => {
    expect(
      await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).toBe(1);

    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function() { return <div>Home</div>; }",
          expectMissing: true,
        },
      ],
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).toBe(2);
  });

  it("freezes source revision without incrementing source_generation and guards with OCC", async () => {
    // Save a file so source_generation becomes 2
    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function() { return <div>Home</div>; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).toBe(2);

    // Freezing with matching expectedSourceGeneration (2) succeeds and DOES NOT bump generation
    const rev = await storefrontThemeFileDal.createRevision("storefront-a", "theme-a", {
      expectedSourceGeneration: 2,
      message: "Frozen checkpoint",
      source: "publish",
    });

    expect(rev.id).toBeDefined();
    expect(rev.message).toBe("Frozen checkpoint");
    expect(rev.source).toBe("publish");

    // Generation must remain 2 after snapshot
    expect(
      await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).toBe(2);

    // Attempting to freeze with stale expectedSourceGeneration (e.g. 1) rejects due to OCC
    await expect(
      storefrontThemeFileDal.createRevision("storefront-a", "theme-a", {
        expectedSourceGeneration: 1,
        message: "Stale checkpoint",
      }),
    ).rejects.toThrow("CONFLICT_SOURCE_GENERATION_MISMATCH");
  });

  it("rejects saveFilesBatch with CONFLICT_SOURCE_GENERATION_MISMATCH when expectedSourceGeneration does not match server", async () => {
    // Server generation is 1. Client attempts to save expecting 99
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/pages/index.tsx",
            content: "export default function() { return <div>Home</div>; }",
            expectMissing: true,
          },
        ],
        { expectedSourceGeneration: 99 },
      ),
    ).rejects.toThrow("CONFLICT_SOURCE_GENERATION_MISMATCH");
  });

  it("rejects saveFilesBatch with CONFLICT_VERSION_MISMATCH when file version mismatches but generation matches", async () => {
    // Save file at gen 1 -> gen becomes 2, file version becomes 1
    const [file] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "initial content",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    // Attempt to update with wrong expectedVersion (e.g. 99) while expectedSourceGeneration is 2
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/pages/index.tsx",
            content: "new content",
            expectedFileId: file.id,
            expectedVersion: 99,
          },
        ],
        { expectedSourceGeneration: 2 },
      ),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
  });

  it("increments source_generation on deleteFile with matching expectedSourceGeneration", async () => {
    const [file] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/components/Header.tsx",
          content: "export const Header = () => null;",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).toBe(2);

    await storefrontThemeFileDal.deleteFile(
      "storefront-a",
      "theme-a",
      "src/components/Header.tsx",
      file.id,
      file.version,
      { expectedSourceGeneration: 2 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).toBe(3);
  });

  it("initializes starter theme idempotently without duplicating files or revisions", async () => {
    const files1 = await storefrontThemeFileDal.initStarterTheme("storefront-a", "theme-a");
    expect(files1.length).toBeGreaterThan(0);
    const gen1 = await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a");

    // Second call should return existing files cleanly without incrementing generation
    const files2 = await storefrontThemeFileDal.initStarterTheme("storefront-a", "theme-a");
    expect(files2.length).toBe(files1.length);
    const gen2 = await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a");
    expect(gen2).toBe(gen1);
  });

  it("rolls back to revision with expectedSourceGeneration OCC guard", async () => {
    await storefrontThemeFileDal.initStarterTheme("storefront-a", "theme-a");
    const gen = await storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a");

    // Rollback with matching generation
    const rolledBack = await storefrontThemeFileDal.rollbackToRevision(
      "storefront-a",
      "theme-a",
      1,
      { expectedSourceGeneration: gen ?? 1 },
    );
    expect(rolledBack.length).toBeGreaterThan(0);

    // Rollback with stale generation should fail
    await expect(
      storefrontThemeFileDal.rollbackToRevision(
        "storefront-a",
        "theme-a",
        1,
        { expectedSourceGeneration: 999 },
      ),
    ).rejects.toThrow();
  });
});
