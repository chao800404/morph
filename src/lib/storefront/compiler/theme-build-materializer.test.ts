import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeBuildDal } from "../dal/storefront-theme-build.dal";
import { themeBuildMaterializer } from "./theme-build-materializer";

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
      preferences text,
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
      release_generation integer DEFAULT 1 NOT NULL,
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
      snapshot text NOT NULL,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_builds (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      source_revision_id text NOT NULL,
      status text DEFAULT 'queued' NOT NULL,
      input_hash text,
      compiler_id text,
      compiler_version text,
      artifact_prefix text,
      manifest_json text,
      diagnostics_json text,
      error_message text,
      started_at text,
      completed_at text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
  `);

  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
});

describe("Theme Build Input Materializer (Phase 4B-2)", () => {
  const seedStorefront = (storefrontId = "storefront-1") => {
    sqlite
      .prepare(
        "INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        storefrontId,
        `channel-${storefrontId}`,
        "Store",
        "draft",
        new Date().toISOString(),
        new Date().toISOString(),
      );
  };

  const seedTheme = (storefrontId = "storefront-1", themeId = "theme-1") => {
    sqlite
      .prepare(
        "INSERT INTO storefront_themes (id, storefront_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        themeId,
        storefrontId,
        "Main Theme",
        "draft",
        new Date().toISOString(),
        new Date().toISOString(),
      );
  };

  const seedRevision = (
    storefrontId: string,
    themeId: string,
    revisionId: string,
    revisionNumber: number,
    files: Array<{ path: string; content: string; mimeType?: string; isEntry?: boolean }>,
  ) => {
    sqlite
      .prepare(
        "INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        revisionId,
        storefrontId,
        themeId,
        revisionNumber,
        "Checkpoint",
        "manual",
        JSON.stringify(files),
        new Date().toISOString(),
        new Date().toISOString(),
      );
  };

  const seedWorkingFile = (
    storefrontId: string,
    themeId: string,
    path: string,
    content: string,
  ) => {
    sqlite
      .prepare(
        "INSERT INTO storefront_theme_files (id, storefront_id, theme_id, path, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        storefrontId,
        themeId,
        path,
        content,
        new Date().toISOString(),
        new Date().toISOString(),
      );
  };

  it("materializes build input strictly from bound revision snapshot (ignores working tree changes)", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    // 1. Freeze Revision R1 with Hero text-[48px]
    seedRevision("storefront-1", "theme-1", "rev-1", 1, [
      {
        path: "src/styles/global.css",
        content: '@import "tailwindcss";',
        mimeType: "text/css",
        isEntry: false,
      },
      {
        path: "src/components/Hero.tsx",
        content: '<div className="text-[48px]">Hero 48px</div>',
        mimeType: "text/typescript",
        isEntry: false,
      },
      {
        path: "src/pages/index.tsx",
        content: 'import Hero from "../components/Hero"; export default () => <Hero />;',
        mimeType: "text/typescript",
        isEntry: true,
      },
    ]);

    // 2. Create Build B1 pointing to R1
    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      {
        sourceRevisionId: "rev-1",
      },
    );

    // 3. Working source files are mutated to text-[80px]
    seedWorkingFile(
      "storefront-1",
      "theme-1",
      "src/components/Hero.tsx",
      '<div className="text-[80px]">Hero 80px (Working File Mutation)</div>',
    );

    // 4. Materialize Build B1
    const buildInput =
      await themeBuildMaterializer.materializeThemeBuildInput(
        "storefront-1",
        "theme-1",
        build.id,
      );

    // 5. Assert: B1 must strictly contain text-[48px] and NOT text-[80px]
    expect(buildInput.buildId).toBe(build.id);
    expect(buildInput.sourceRevisionId).toBe("rev-1");
    expect(buildInput.revisionNumber).toBe(1);

    const heroFile = buildInput.files.find(
      (f) => f.path === "src/components/Hero.tsx",
    );
    expect(heroFile?.content).toBe(
      '<div className="text-[48px]">Hero 48px</div>',
    );
    expect(heroFile?.content).not.toContain("80px");
  });

  it("produces deterministic file ordering and identical inputHash on repeated materializations", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    // Seed unordered snapshot
    seedRevision("storefront-1", "theme-1", "rev-det", 1, [
      { path: "src/pages/index.tsx", content: "export default () => <div>Index</div>;" },
      { path: "package.json", content: '{"name": "theme"}' },
      { path: "src/components/Header.tsx", content: "export default () => <header />;" },
      { path: "src/styles/global.css", content: '@import "tailwindcss";' },
    ]);

    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-det" },
    );

    const input1 = await themeBuildMaterializer.materializeThemeBuildInput(
      "storefront-1",
      "theme-1",
      build.id,
    );

    const input2 = await themeBuildMaterializer.materializeThemeBuildInput(
      "storefront-1",
      "theme-1",
      build.id,
    );

    // Assert files are sorted alphabetically by path
    expect(input1.files.map((f) => f.path)).toEqual([
      "package.json",
      "src/components/Header.tsx",
      "src/pages/index.tsx",
      "src/styles/global.css",
    ]);

    expect(input1.inputHash).toBe(input2.inputHash);
    expect(input1.inputHash.length).toBe(64); // SHA-256 hex string
  });

  it("verifies working tree mutations do not alter build inputHash", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    seedRevision("storefront-1", "theme-1", "rev-immutable", 1, [
      { path: "src/styles/global.css", content: '@import "tailwindcss";' },
      { path: "src/pages/index.tsx", content: "export default () => <div>Page</div>;" },
    ]);

    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-immutable" },
    );

    const initialInput =
      await themeBuildMaterializer.materializeThemeBuildInput(
        "storefront-1",
        "theme-1",
        build.id,
      );

    // Mutate working tree heavily
    seedWorkingFile("storefront-1", "theme-1", "src/extra.tsx", "extra");
    seedWorkingFile("storefront-1", "theme-1", "src/styles/global.css", "mutated");

    const subsequentInput =
      await themeBuildMaterializer.materializeThemeBuildInput(
        "storefront-1",
        "theme-1",
        build.id,
      );

    expect(subsequentInput.inputHash).toBe(initialInput.inputHash);
    expect(subsequentInput.files).toEqual(initialInput.files);
  });

  it("produces distinct inputHash for distinct immutable revisions", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    seedRevision("storefront-1", "theme-1", "rev-A", 1, [
      { path: "src/Hero.tsx", content: "Hero Version A" },
    ]);
    seedRevision("storefront-1", "theme-1", "rev-B", 2, [
      { path: "src/Hero.tsx", content: "Hero Version B" },
    ]);

    const buildA = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-A" },
    );
    const buildB = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-B" },
    );

    const inputA = await themeBuildMaterializer.materializeThemeBuildInput(
      "storefront-1",
      "theme-1",
      buildA.id,
    );
    const inputB = await themeBuildMaterializer.materializeThemeBuildInput(
      "storefront-1",
      "theme-1",
      buildB.id,
    );

    expect(inputA.inputHash).not.toBe(inputB.inputHash);
    expect(inputA.sourceRevisionId).toBe("rev-A");
    expect(inputB.sourceRevisionId).toBe("rev-B");
  });

  it("fails if build does not exist", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    await expect(
      themeBuildMaterializer.materializeThemeBuildInput(
        "storefront-1",
        "theme-1",
        "non-existent-build",
      ),
    ).rejects.toThrow(/BUILD_NOT_FOUND/);
  });

  it("fails if bound source revision was deleted or does not belong to storefront/theme", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-valid", 1, [
      { path: "src/index.tsx", content: "ok" },
    ]);

    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-valid" },
    );

    // Soft-delete the revision
    sqlite
      .prepare("UPDATE storefront_theme_revisions SET deleted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), "rev-valid");

    await expect(
      themeBuildMaterializer.materializeThemeBuildInput(
        "storefront-1",
        "theme-1",
        build.id,
      ),
    ).rejects.toThrow(/SOURCE_REVISION_NOT_FOUND/);
  });

  it("fails when revision snapshot is empty or corrupt without falling back to working files", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    // Seed working file that could tempt a fallback
    seedWorkingFile(
      "storefront-1",
      "theme-1",
      "src/pages/index.tsx",
      "working fallback candidate",
    );

    // Seed revision with empty snapshot
    sqlite
      .prepare(
        "INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "rev-empty",
        "storefront-1",
        "theme-1",
        1,
        "Empty",
        "manual",
        "[]",
        new Date().toISOString(),
        new Date().toISOString(),
      );

    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-empty" },
    );

    await expect(
      themeBuildMaterializer.materializeThemeBuildInput(
        "storefront-1",
        "theme-1",
        build.id,
      ),
    ).rejects.toThrow(/EMPTY_OR_CORRUPT_REVISION_SNAPSHOT/);
  });
});
