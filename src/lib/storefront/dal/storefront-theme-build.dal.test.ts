import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeBuildDal } from "./storefront-theme-build.dal";

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

describe("Theme Build Domain DAL (Phase 4B-1)", () => {
  const seedStorefront = (storefrontId = "storefront-a") => {
    sqlite
      .prepare(
        "INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(storefrontId, `channel-${storefrontId}`, "Test Store", "draft", new Date().toISOString(), new Date().toISOString());
  };

  const seedTheme = (storefrontId = "storefront-a", themeId = "theme-a") => {
    sqlite
      .prepare(
        "INSERT INTO storefront_themes (id, storefront_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(themeId, storefrontId, "Main Theme", "draft", new Date().toISOString(), new Date().toISOString());
  };

  const seedRevision = (
    storefrontId = "storefront-a",
    themeId = "theme-a",
    revisionId = "rev-100",
    revisionNumber = 1,
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
        "Snapshot",
        "manual",
        JSON.stringify([{ path: "src/styles/global.css", content: ".text-48px { font-size: 48px; }", mimeType: "text/css", isEntry: false }]),
        new Date().toISOString(),
        new Date().toISOString(),
      );
  };

  describe("Build Creation & Ownership Validation", () => {
    it("successfully creates a build permanently bound to requested sourceRevisionId in queued status", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        {
          sourceRevisionId: "rev-100",
          createdBy: "user-1",
        },
      );

      expect(build.id).toBeDefined();
      expect(build.storefrontId).toBe("storefront-a");
      expect(build.themeId).toBe("theme-a");
      expect(build.sourceRevisionId).toBe("rev-100");
      expect(build.status).toBe("queued");
      expect(build.createdBy).toBe("user-1");
      expect(build.startedAt).toBeNull();
      expect(build.completedAt).toBeNull();
    });

    it("rejects build creation if sourceRevisionId does not exist", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");

      await expect(
        storefrontThemeBuildDal.createBuild("storefront-a", "theme-a", {
          sourceRevisionId: "non-existent-rev",
        }),
      ).rejects.toThrow(/Theme source revision not found/);
    });

    it("rejects build creation for cross-storefront revision reference", async () => {
      // Storefront A & Storefront B
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");

      seedStorefront("storefront-b");
      seedTheme("storefront-b", "theme-b");
      seedRevision("storefront-b", "theme-b", "rev-b-100", 1);

      // Attempting to create build for Storefront A using Storefront B's revision
      await expect(
        storefrontThemeBuildDal.createBuild("storefront-a", "theme-a", {
          sourceRevisionId: "rev-b-100",
        }),
      ).rejects.toThrow(/Theme source revision not found or does not belong to specified storefront/);
    });

    it("rejects build creation for cross-theme revision reference within same storefront", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedTheme("storefront-a", "theme-b");
      seedRevision("storefront-a", "theme-b", "rev-theme-b", 1);

      // Attempting to create build for Theme A using Theme B's revision
      await expect(
        storefrontThemeBuildDal.createBuild("storefront-a", "theme-a", {
          sourceRevisionId: "rev-theme-b",
        }),
      ).rejects.toThrow(/Theme source revision not found or does not belong to specified storefront/);
    });

    it("preserves immutable sourceRevisionId binding even when working source files are later mutated", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      // 1. Create build bound to rev-100
      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        {
          sourceRevisionId: "rev-100",
        },
      );

      // 2. Working source changes and new revision rev-101 is created
      seedRevision("storefront-a", "theme-a", "rev-101", 2);

      // 3. Retrieved build record MUST still point permanently to rev-100
      const retrieved = await storefrontThemeBuildDal.getBuild(
        "storefront-a",
        "theme-a",
        build.id,
      );

      expect(retrieved?.sourceRevisionId).toBe("rev-100");
    });
  });

  describe("State Machine Transition Guarantees", () => {
    it("allows valid lifecycle: queued -> building -> succeeded", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        { sourceRevisionId: "rev-100" },
      );
      expect(build.status).toBe("queued");

      // Transition 1: queued -> building with atomic identity freeze
      const building = await storefrontThemeBuildDal.markBuildStarted(
        "storefront-a",
        "theme-a",
        build.id,
        {
          inputHash: "a".repeat(64),
          compilerId: "tailwind-v4",
          compilerVersion: "4.1.17",
        },
      );
      expect(building.status).toBe("building");
      expect(building.startedAt).toBeDefined();
      expect(building.inputHash).toBe("a".repeat(64));
      expect(building.compilerId).toBe("tailwind-v4");
      expect(building.compilerVersion).toBe("4.1.17");

      // Transition 2: building -> succeeded
      const succeeded = await storefrontThemeBuildDal.markBuildSucceeded(
        "storefront-a",
        "theme-a",
        build.id,
        {
          inputHash: "a".repeat(64),
          artifactPrefix: "r2://artifacts/build-1",
        },
      );
      expect(succeeded.status).toBe("succeeded");
      expect(succeeded.completedAt).toBeDefined();
      expect(succeeded.inputHash).toBe("a".repeat(64));
      expect(succeeded.artifactPrefix).toBe("r2://artifacts/build-1");
    });

    it("allows valid failure lifecycle: queued -> building -> failed", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        { sourceRevisionId: "rev-100" },
      );

      await storefrontThemeBuildDal.markBuildStarted(
        "storefront-a",
        "theme-a",
        build.id,
        {
          inputHash: "b".repeat(64),
          compilerId: "tailwind-v4",
          compilerVersion: "4.1.17",
        },
      );

      const failed = await storefrontThemeBuildDal.markBuildFailed(
        "storefront-a",
        "theme-a",
        build.id,
        {
          errorMessage: "Vite build failed due to syntax error in Hero.tsx",
        },
      );

      expect(failed.status).toBe("failed");
      expect(failed.errorMessage).toBe(
        "Vite build failed due to syntax error in Hero.tsx",
      );
      expect(failed.completedAt).toBeDefined();
    });

    it("allows pre-runner launch orchestration failure: queued -> failed", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        { sourceRevisionId: "rev-100" },
      );

      const failed = await storefrontThemeBuildDal.markBuildFailed(
        "storefront-a",
        "theme-a",
        build.id,
        {
          errorMessage: "Runner provisioning timeout",
        },
      );

      expect(failed.status).toBe("failed");
      expect(failed.errorMessage).toBe("Runner provisioning timeout");
    });

    it("strictly disallows illegal state transitions from terminal status succeeded", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        { sourceRevisionId: "rev-100" },
      );
      await storefrontThemeBuildDal.markBuildStarted(
        "storefront-a",
        "theme-a",
        build.id,
        {
          inputHash: "c".repeat(64),
          compilerId: "tailwind-v4",
          compilerVersion: "4.1.17",
        },
      );
      await storefrontThemeBuildDal.markBuildSucceeded(
        "storefront-a",
        "theme-a",
        build.id,
        {},
      );

      // succeeded -> building ❌
      await expect(
        storefrontThemeBuildDal.markBuildStarted(
          "storefront-a",
          "theme-a",
          build.id,
          {
            inputHash: "c".repeat(64),
            compilerId: "tailwind-v4",
            compilerVersion: "4.1.17",
          },
        ),
      ).rejects.toThrow(/INVALID_STATE_TRANSITION/);

      // succeeded -> failed ❌
      await expect(
        storefrontThemeBuildDal.markBuildFailed(
          "storefront-a",
          "theme-a",
          build.id,
          { errorMessage: "Cannot fail succeeded build" },
        ),
      ).rejects.toThrow(/INVALID_STATE_TRANSITION/);
    });

    it("strictly disallows illegal state transitions from terminal status failed", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-100", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        { sourceRevisionId: "rev-100" },
      );
      await storefrontThemeBuildDal.markBuildStarted(
        "storefront-a",
        "theme-a",
        build.id,
        {
          inputHash: "d".repeat(64),
          compilerId: "tailwind-v4",
          compilerVersion: "4.1.17",
        },
      );
      await storefrontThemeBuildDal.markBuildFailed(
        "storefront-a",
        "theme-a",
        build.id,
        { errorMessage: "Build error" },
      );

      // failed -> building ❌
      await expect(
        storefrontThemeBuildDal.markBuildStarted(
          "storefront-a",
          "theme-a",
          build.id,
          {
            inputHash: "d".repeat(64),
            compilerId: "tailwind-v4",
            compilerVersion: "4.1.17",
          },
        ),
      ).rejects.toThrow(/INVALID_STATE_TRANSITION/);

      // failed -> succeeded ❌
      await expect(
        storefrontThemeBuildDal.markBuildSucceeded(
          "storefront-a",
          "theme-a",
          build.id,
          {},
        ),
      ).rejects.toThrow(/INVALID_STATE_TRANSITION/);
    });

    it("retrieves materialization source (build and revision) from DAL", async () => {
      seedStorefront("storefront-a");
      seedTheme("storefront-a", "theme-a");
      seedRevision("storefront-a", "theme-a", "rev-source-1", 1);

      const build = await storefrontThemeBuildDal.createBuild(
        "storefront-a",
        "theme-a",
        { sourceRevisionId: "rev-source-1" },
      );

      const source = await storefrontThemeBuildDal.getBuildMaterializationSource(
        "storefront-a",
        "theme-a",
        build.id,
      );

      expect(source.build.id).toBe(build.id);
      expect(source.revision.id).toBe("rev-source-1");
      expect(source.revision.revisionNumber).toBe(1);
    });

  });
});
