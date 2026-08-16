import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeThemeBuildRunner } from "../compiler/fake-theme-build-runner";
import { storefrontThemeBuildDal } from "../dal/storefront-theme-build.dal";

import { ThemeBuildService } from "./theme-build.service";

vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;
let service: ThemeBuildService;

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
  service = new ThemeBuildService(storefrontThemeBuildDal);
});

afterEach(() => {
  sqlite.close();
});

describe("ThemeBuildService Orchestration (Phase 4B-3)", () => {
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
    files: Array<{
      path: string;
      content: string;
      mimeType?: string;
      isEntry?: boolean;
    }>,
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

  it("creates queued build record without fake execution when no runner is injected", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-queued", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Queued</h1>;" },
    ]);

    // Service called without runner (production pre-Sandbox behavior)
    const build = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-queued",
    });

    expect(build.status).toBe("queued");
    expect(build.startedAt).toBeNull();
    expect(build.completedAt).toBeNull();
    expect(build.artifactPrefix).toBeNull();
  });

  it("orchestrates valid build lifecycle: queued -> building -> succeeded with injected runner", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-1", 1, [
      { path: "src/styles/global.css", content: '@import "tailwindcss";' },
      {
        path: "src/pages/index.tsx",
        content: "export default () => <h1>Home</h1>;",
      },
    ]);

    const fakeRunner = new FakeThemeBuildRunner({
      shouldSucceed: true,
      manifest: {
        entry: "src/pages/index.tsx",
        filesCount: 2,
        inputHash: "placeholder",
        bundleFiles: [
          { path: "index.js", sizeBytes: 1024, mimeType: "application/javascript" },
          { path: "global.css", sizeBytes: 512, mimeType: "text/css" },
        ],
      },
    });

    const build = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-1",
      createdBy: "user-test",
      runner: fakeRunner,
    });

    expect(build.status).toBe("succeeded");
    expect(build.inputHash).toBeDefined();
    expect(build.inputHash?.length).toBe(64);
    expect(build.compilerId).toBe("tailwind-v4-build");
    expect(build.compilerVersion).toBeDefined();
    expect(build.manifestJson).toEqual({
      entry: "src/pages/index.tsx",
      filesCount: 2,
      inputHash: "placeholder",
      bundleFiles: [
        { path: "index.js", sizeBytes: 1024, mimeType: "application/javascript" },
        { path: "global.css", sizeBytes: 512, mimeType: "text/css" },
      ],
    });
    expect(build.startedAt).toBeDefined();
    expect(build.completedAt).toBeDefined();
  });


  it("transitions to failed when runner throws an exception", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-throw", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const throwingRunner = new FakeThemeBuildRunner({
      shouldThrow: true,
      errorMessage: "Vite build crashed with OutOfMemory",
    });

    const failedBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-throw",
      runner: throwingRunner,
    });

    expect(failedBuild.status).toBe("failed");
    expect(failedBuild.errorMessage).toContain(
      "Vite build crashed with OutOfMemory",
    );
    expect(failedBuild.diagnosticsJson).toBeDefined();
    expect(failedBuild.completedAt).toBeDefined();
  });

  it("transitions to failed when runner returns failure result", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-fail-result", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const failedResultRunner = new FakeThemeBuildRunner({
      shouldSucceed: false,
      errorMessage: "Syntax error at line 42",
      diagnostics: { line: 42, file: "src/index.tsx" },
    });

    const failedBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-fail-result",
      runner: failedResultRunner,
    });

    expect(failedBuild.status).toBe("failed");
    expect(failedBuild.errorMessage).toBe("Syntax error at line 42");
    expect(failedBuild.diagnosticsJson).toEqual({
      line: 42,
      file: "src/index.tsx",
    });
  });

  it("transitions to failed when materialization fails (e.g. corrupt snapshot)", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    // Seed invalid snapshot (empty)
    sqlite
      .prepare(
        "INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "rev-corrupt",
        "storefront-1",
        "theme-1",
        1,
        "Corrupt",
        "manual",
        "[]",
        new Date().toISOString(),
        new Date().toISOString(),
      );

    const build = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-corrupt",
      runner: new FakeThemeBuildRunner(),
    });

    expect(build.status).toBe("failed");
    expect(build.errorMessage).toContain("EMPTY_OR_CORRUPT_REVISION_SNAPSHOT");
  });

  it("ensures an existing succeeded build is never mutated by a subsequent build failure", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    // Revision 1 (success)
    seedRevision("storefront-1", "theme-1", "rev-success", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Rev 1</h1>;" },
    ]);
    const successBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-success",
      runner: new FakeThemeBuildRunner({ shouldSucceed: true }),
    });
    expect(successBuild.status).toBe("succeeded");

    // Revision 2 (failure)
    seedRevision("storefront-1", "theme-1", "rev-failure", 2, [
      { path: "src/index.tsx", content: "export default () => <h1>Rev 2</h1>;" },
    ]);
    const failedBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-failure",
      runner: new FakeThemeBuildRunner({ shouldThrow: true }),
    });
    expect(failedBuild.status).toBe("failed");

    // Check that successBuild in DB is completely intact
    const originalBuildInDb = await storefrontThemeBuildDal.getBuild(
      "storefront-1",
      "theme-1",
      successBuild.id,
    );
    expect(originalBuildInDb?.status).toBe("succeeded");
    expect(originalBuildInDb?.inputHash).toBe(successBuild.inputHash);
    expect(originalBuildInDb?.errorMessage).toBeNull();
  });

  it("ensures builds for different themes do not cross-contaminate", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-A");
    seedTheme("storefront-1", "theme-B");

    seedRevision("storefront-1", "theme-A", "rev-A", 1, [
      { path: "src/index.tsx", content: "Theme A content" },
    ]);
    seedRevision("storefront-1", "theme-B", "rev-B", 1, [
      { path: "src/index.tsx", content: "Theme B content" },
    ]);

    const buildA = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-A",
      sourceRevisionId: "rev-A",
      runner: new FakeThemeBuildRunner({
        manifest: {
          entry: "src/index.tsx",
          filesCount: 1,
          inputHash: "hash-A",
          metadata: { themeName: "A" },
        },
      }),
    });

    const buildB = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-B",
      sourceRevisionId: "rev-B",
      runner: new FakeThemeBuildRunner({
        manifest: {
          entry: "src/index.tsx",
          filesCount: 1,
          inputHash: "hash-B",
          metadata: { themeName: "B" },
        },
      }),
    });

    expect(buildA.themeId).toBe("theme-A");
    expect(buildA.manifestJson).toEqual({
      entry: "src/index.tsx",
      filesCount: 1,
      inputHash: "hash-A",
      metadata: { themeName: "A" },
    });

    expect(buildB.themeId).toBe("theme-B");
    expect(buildB.manifestJson).toEqual({
      entry: "src/index.tsx",
      filesCount: 1,
      inputHash: "hash-B",
      metadata: { themeName: "B" },
    });

    expect(buildA.inputHash).not.toBe(buildB.inputHash);
  });


  it("verifies runner receives pure immutable revision input and never working files", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");

    seedRevision("storefront-1", "theme-1", "rev-48px", 1, [
      {
        path: "src/Hero.tsx",
        content: '<div className="text-[48px]">Hero 48px</div>',
      },
    ]);

    // Mutate working tree to 80px
    seedWorkingFile(
      "storefront-1",
      "theme-1",
      "src/Hero.tsx",
      '<div className="text-[80px]">Hero 80px Working Mutation</div>',
    );

    let runnerReceivedHeroContent = "";
    const inspectingRunner = new FakeThemeBuildRunner({
      onRun: (input) => {
        const hero = input.files.find((f) => f.path === "src/Hero.tsx");
        runnerReceivedHeroContent = hero?.content ?? "";
      },
    });

    await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-48px",
      runner: inspectingRunner,
    });

    expect(runnerReceivedHeroContent).toBe(
      '<div className="text-[48px]">Hero 48px</div>',
    );
    expect(runnerReceivedHeroContent).not.toContain("80px");
  });

  it("idempotency: reuses existing successful build only when full identity matches and reuseExisting=true", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-reuse", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Reused</h1>;" },
    ]);

    let runnerRunCount = 0;
    const countingRunner = new FakeThemeBuildRunner({
      onRun: () => {
        runnerRunCount++;
      },
    });

    // 1. Initial build request with compiler 4.1.17
    const build1 = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-reuse",
      compilerIdentity: { compilerId: "tailwind-v4", compilerVersion: "4.1.17" },
      runner: countingRunner,
      reuseExisting: false,
    });

    expect(build1.status).toBe("succeeded");
    expect(runnerRunCount).toBe(1);

    // 2. Second build request for the same revision with SAME compiler version and reuseExisting=true
    const build2 = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-reuse",
      compilerIdentity: { compilerId: "tailwind-v4", compilerVersion: "4.1.17" },
      runner: countingRunner,
      reuseExisting: true,
    });

    // Same build reused (0 extra runner invocations)
    expect(build2.id).toBe(build1.id);
    expect(runnerRunCount).toBe(1);

    // 3. Third build request for SAME revision but DIFFERENT compiler version (4.2.0)
    const build3 = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-reuse",
      compilerIdentity: { compilerId: "tailwind-v4", compilerVersion: "4.2.0" },
      runner: countingRunner,
      reuseExisting: true,
    });

    // Must NOT reuse build1 because identity differs
    expect(build3.id).not.toBe(build1.id);
    expect(build3.compilerVersion).toBe("4.2.0");
    expect(runnerRunCount).toBe(2);
  });


  it("competing concurrent orchestrations: Start CAS loser with conflicting compiler version does NOT fail active winner build", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-concurrent", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Concurrent</h1>;" },
    ]);

    // Create single queued build
    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-concurrent" },
    );

    let runnerRunCount = 0;
    const delayedWinnerRunner = new FakeThemeBuildRunner({
      onRun: async () => {
        runnerRunCount++;
        // Simulate in-flight build time
        await new Promise((resolve) => setTimeout(resolve, 60));
      },
      shouldSucceed: true,
      manifest: {
        entry: "src/index.tsx",
        filesCount: 1,
        inputHash: "concurrent-hash",
        metadata: { winner: true },
      },
    });

    const secondWorkerRunner = new FakeThemeBuildRunner({
      onRun: () => {
        runnerRunCount++;
      },
    });

    // Worker A starts with compilerVersion 4.1.17 and takes ownership
    const promiseA = service.executeBuildOrchestration({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      buildId: build.id,
      compilerIdentity: { compilerId: "tailwind-v4", compilerVersion: "4.1.17" },
      runner: delayedWinnerRunner,
    });

    // Small tick to ensure Worker A transitions queued -> building
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Worker B attempts to orchestrate the same build with CONFLICTING compilerVersion 4.2.0 while Worker A is still running
    const resultB = await service.executeBuildOrchestration({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      buildId: build.id,
      compilerIdentity: { compilerId: "tailwind-v4", compilerVersion: "4.2.0" },
      runner: secondWorkerRunner,
    });

    // Worker B must see in-flight building status and MUST NOT mark the build failed!
    expect(resultB.status).toBe("building");
    expect(resultB.compilerVersion).toBe("4.1.17");

    // Worker A finishes
    const resultA = await promiseA;
    expect(resultA.status).toBe("succeeded");
    expect(resultA.compilerVersion).toBe("4.1.17");
    expect(resultA.manifestJson).toEqual({
      entry: "src/index.tsx",
      filesCount: 1,
      inputHash: "concurrent-hash",
      metadata: { winner: true },
    });

    // Total runner invocations was exactly 1 (Worker B did not duplicate execution)
    expect(runnerRunCount).toBe(1);

    // Final state in DB is succeeded with Winner's version 4.1.17
    const finalInDb = await storefrontThemeBuildDal.getBuild(
      "storefront-1",
      "theme-1",
      build.id,
    );
    expect(finalInDb?.status).toBe("succeeded");
    expect(finalInDb?.compilerVersion).toBe("4.1.17");
    expect(finalInDb?.errorMessage).toBeNull();
  });
});


