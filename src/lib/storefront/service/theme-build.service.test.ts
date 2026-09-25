import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeThemeBuildArtifactStore } from "../compiler/fake-theme-build-artifact-store";
import { FakeThemeBuildRunner } from "../compiler/fake-theme-build-runner";
import { materializeThemeBuildInput } from "../compiler/theme-build-materializer";
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
      source_index_version integer,
      source_index_status text,
      source_index text,
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
      deleted_at text,
      encoding text DEFAULT 'utf8' NOT NULL,
      blob_digest text,
      size_bytes integer
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      revision_number integer NOT NULL,
      source_generation integer,
      message text,
      source text DEFAULT 'manual' NOT NULL,
      snapshot text NOT NULL,
      source_manifest text,
      source_index text,
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
      status text NOT NULL,
      input_hash text,
      compiler_id text,
      compiler_version text,
      dependencies_json text,
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
  service = new ThemeBuildService(
    storefrontThemeBuildDal,
    undefined,
    undefined,
    new FakeThemeBuildArtifactStore(),
  );
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
      {
        path: "src/index.tsx",
        content: "export default () => <h1>Queued</h1>;",
      },
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
          {
            path: "index.js",
            sizeBytes: 1024,
            mimeType: "application/javascript",
          },
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
    expect(build.artifactPrefix).toBe(
      `storefronts/storefront-1/themes/theme-1/builds/${build.id}`,
    );
    expect(build.inputHash).toBeDefined();
    expect(build.inputHash?.length).toBe(64);
    expect(build.compilerId).toBe("tailwind-v4-build");
    expect(build.compilerVersion).toBeDefined();
    expect(build.manifestJson.buildId).toBe(build.id);
    expect(build.manifestJson.storefrontId).toBe("storefront-1");
    expect(build.manifestJson.themeId).toBe("theme-1");
    expect(build.manifestJson.filesCount).toBeGreaterThan(0);
    expect(build.startedAt).toBeDefined();
    expect(build.completedAt).toBeDefined();
  });

  it("transitions to failed when artifact store throws an exception during file upload", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-store-fail", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const fakeRunner = new FakeThemeBuildRunner({ shouldSucceed: true });
    const failingStore = new FakeThemeBuildArtifactStore({ shouldFail: true });

    const failedBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-store-fail",
      runner: fakeRunner,
      artifactStore: failingStore,
    });

    expect(failedBuild.status).toBe("failed");
    expect(failedBuild.errorMessage).toContain("Artifact persistence failed");
    expect(failedBuild.diagnosticsJson?.stage).toBe("artifact-storage");
  });

  it("transitions to failed when artifact store fails during manifest write", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-manifest-fail", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const fakeRunner = new FakeThemeBuildRunner({ shouldSucceed: true });
    const failingStore = new FakeThemeBuildArtifactStore({
      failAtManifest: true,
    });

    const failedBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-manifest-fail",
      runner: fakeRunner,
      artifactStore: failingStore,
    });

    expect(failedBuild.status).toBe("failed");
    expect(failedBuild.errorMessage).toContain("FAKE_MANIFEST_FAILURE");
  });

  it("transitions to failed when runner succeeds but no artifactStore is configured", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-no-store", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const serviceWithoutStore = new ThemeBuildService(storefrontThemeBuildDal);
    const fakeRunner = new FakeThemeBuildRunner({ shouldSucceed: true });

    const failedBuild = await serviceWithoutStore.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-no-store",
      runner: fakeRunner,
    });

    expect(failedBuild.status).toBe("failed");
    expect(failedBuild.errorMessage).toContain("NO_ARTIFACT_STORE_CONFIGURED");
    expect(failedBuild.diagnosticsJson?.stage).toBe("artifact-storage");
  });

  it("transitions to failed when DB finalize (markBuildSucceeded) fails after R2 persistence", async () => {
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-finalize-fail", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const fakeRunner = new FakeThemeBuildRunner({ shouldSucceed: true });
    const fakeStore = new FakeThemeBuildArtifactStore();

    // Mock dal.markBuildSucceeded to simulate DB constraint or network error during commit
    const markSucceededSpy = vi
      .spyOn(storefrontThemeBuildDal, "markBuildSucceeded")
      .mockRejectedValueOnce(new Error("D1_COMMIT_FAILURE: SQLite disk full"));

    const failedBuild = await service.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-finalize-fail",
      runner: fakeRunner,
      artifactStore: fakeStore,
    });

    expect(failedBuild.status).toBe("failed");
    expect(failedBuild.errorMessage).toContain("DB finalize failed");
    expect(failedBuild.errorMessage).toContain("D1_COMMIT_FAILURE");
    expect(failedBuild.diagnosticsJson?.stage).toBe("finalize");

    markSucceededSpy.mockRestore();
  });

  it("reports the build's own cost, separated from the artifact stage and attributed to a runner", async () => {
    // Three numbers that a build record cannot keep apart on its own:
    // `completed_at - started_at` contains the runner *and* the artifact upload,
    // and the reuse identity (sourceRevisionId, inputHash, compilerId,
    // compilerVersion) cannot say which plane ran it, because both runners
    // deliberately share that identity so their artifacts are interchangeable.
    // Right for shipping, wrong for taking a sample.
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-timings", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const build = await service.requestPreviewBuild({
        storefrontId: "storefront-1",
        themeId: "theme-1",
        sourceRevisionId: "rev-timings",
        runner: new FakeThemeBuildRunner({ shouldSucceed: true, delayMs: 20 }),
        artifactStore: new FakeThemeBuildArtifactStore(),
      });

      expect(build.status).toBe("succeeded");

      const timing = lines
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, any>;
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.scope === "storefront.theme.build.timings");
      expect(timing, "no build timing line was emitted").toBeDefined();

      // Which plane ran it, and that a runner ran at all.
      expect(timing!.runner).toMatchObject({
        isolation: "fake-mock",
        ran: true,
      });
      expect(typeof timing!.runner.id).toBe("string");

      // The build's own cost — the number a duration budget is about. The bound
      // is deliberately below the fake's 20ms delay: `setTimeout(20)` can
      // resolve at 19.x by `Date.now()`, and asserting the exact figure put the
      // boundary on the assertion, which failed once in a full run. What is
      // being checked is that the reported duration is the runner's own work
      // rather than zero or the orchestration's, and the relationship below is
      // what pins it precisely.
      expect(timing!.runner.durationMs).toBeGreaterThanOrEqual(10);

      // Kept apart from the artifact stage, and both inside the whole. This is
      // the boundary that makes the two stages unsplittable after the fact.
      expect(typeof timing!.artifactMs).toBe("number");
      expect(timing!.totalMs).toBeGreaterThanOrEqual(
        timing!.runner.durationMs + timing!.artifactMs,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("emits no timing line for a build that failed, so a failed sample cannot be read as a cost", async () => {
    // A failed build returns in milliseconds and is not a sample of build cost.
    // Asserted rather than assumed, because "no line" and "a line with a small
    // number" are the two possible behaviours and only one of them is safe to
    // average over.
    seedStorefront("storefront-1");
    seedTheme("storefront-1", "theme-1");
    seedRevision("storefront-1", "theme-1", "rev-timings-failed", 1, [
      { path: "src/index.tsx", content: "export default () => <h1>Home</h1>;" },
    ]);

    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const build = await service.requestPreviewBuild({
        storefrontId: "storefront-1",
        themeId: "theme-1",
        sourceRevisionId: "rev-timings-failed",
        runner: new FakeThemeBuildRunner({
          shouldSucceed: false,
          errorMessage: "COMPILE_ERROR: bad jsx",
        }),
        artifactStore: new FakeThemeBuildArtifactStore(),
      });

      expect(build.status).toBe("failed");
      expect(
        lines.some((line) => line.includes("storefront.theme.build.timings")),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
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
      {
        path: "src/index.tsx",
        content: "export default () => <h1>Rev 1</h1>;",
      },
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
      {
        path: "src/index.tsx",
        content: "export default () => <h1>Rev 2</h1>;",
      },
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
    expect(buildA.manifestJson.themeId).toBe("theme-A");
    expect(buildA.manifestJson.sourceRevisionId).toBe("rev-A");
    expect(buildA.artifactPrefix).toBe(
      `storefronts/storefront-1/themes/theme-A/builds/${buildA.id}`,
    );

    expect(buildB.themeId).toBe("theme-B");
    expect(buildB.manifestJson.themeId).toBe("theme-B");
    expect(buildB.manifestJson.sourceRevisionId).toBe("rev-B");
    expect(buildB.artifactPrefix).toBe(
      `storefronts/storefront-1/themes/theme-B/builds/${buildB.id}`,
    );

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
      {
        path: "src/index.tsx",
        content: "export default () => <h1>Reused</h1>;",
      },
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
      compilerIdentity: {
        compilerId: "tailwind-v4",
        compilerVersion: "4.1.17",
      },
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
      compilerIdentity: {
        compilerId: "tailwind-v4",
        compilerVersion: "4.1.17",
      },
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
      {
        path: "src/index.tsx",
        content: "export default () => <h1>Concurrent</h1>;",
      },
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
      compilerIdentity: {
        compilerId: "tailwind-v4",
        compilerVersion: "4.1.17",
      },
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
    expect(resultA.manifestJson.buildId).toBe(build.id);
    expect(resultA.manifestJson.storefrontId).toBe("storefront-1");
    expect(resultA.manifestJson.themeId).toBe("theme-1");
    expect(resultA.artifactPrefix).toBe(
      `storefronts/storefront-1/themes/theme-1/builds/${build.id}`,
    );

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

describe("ThemeBuildService cancellation", () => {
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
  const seedRevision = (revisionId = "rev-1") => {
    sqlite
      .prepare(
        "INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        revisionId,
        "storefront-1",
        "theme-1",
        1,
        "Checkpoint",
        "manual",
        JSON.stringify([]),
        new Date().toISOString(),
        new Date().toISOString(),
      );
  };

  const setup = async (terminator?: {
    terminate: (id: string) => Promise<void>;
  }) => {
    seedStorefront();
    seedTheme();
    seedRevision();
    const cancelService = new ThemeBuildService(
      storefrontThemeBuildDal,
      undefined,
      undefined,
      new FakeThemeBuildArtifactStore(),
      undefined,
      terminator,
    );
    const build = await storefrontThemeBuildDal.createBuild(
      "storefront-1",
      "theme-1",
      { sourceRevisionId: "rev-1" },
    );
    return { cancelService, build };
  };

  it("claims a queued build and ends its session", async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const { cancelService, build } = await setup({ terminate });

    const result = await cancelService.cancelBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      buildId: build.id,
    });

    expect(result.cancelled).toBe(true);
    expect(result.build.status).toBe("cancelled");
    expect(terminate).toHaveBeenCalledWith(build.id);
  });

  it("claims the row before ending the session", async () => {
    // Destroying first would make the runner fail before anything recorded
    // why, and the cancellation would surface as a build failure.
    let statusWhenTerminated: string | undefined;
    const { cancelService, build } = await setup({
      terminate: async (id) => {
        const row = await storefrontThemeBuildDal.getBuild(
          "storefront-1",
          "theme-1",
          id,
        );
        statusWhenTerminated = row?.status;
      },
    });

    await cancelService.cancelBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      buildId: build.id,
    });

    expect(statusWhenTerminated).toBe("cancelled");
  });

  it("still reports a completed cancellation when the session cannot be reached", async () => {
    // The row is already claimed, so every reader sees a cancelled build. An
    // unreachable container must not turn that into an error.
    const { cancelService, build } = await setup({
      terminate: async () => {
        throw new Error("container gone");
      },
    });

    const result = await cancelService.cancelBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      buildId: build.id,
    });

    expect(result.cancelled).toBe(true);
    expect(result.build.status).toBe("cancelled");
  });

  it("lets a build that already succeeded keep its result", async () => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const { cancelService, build } = await setup({ terminate });
    await storefrontThemeBuildDal.markBuildStarted(
      "storefront-1",
      "theme-1",
      build.id,
      {
        inputHash: "a".repeat(64),
        compilerId: "tailwind-v4",
        compilerVersion: "4.1.17",
      },
    );
    await storefrontThemeBuildDal.markBuildSucceeded(
      "storefront-1",
      "theme-1",
      build.id,
      {
        artifactPrefix: "r2://artifacts/build-1",
        manifestJson: { entry: "src/index.tsx", filesCount: 1 },
      },
    );

    const result = await cancelService.cancelBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      buildId: build.id,
    });

    expect(result.cancelled).toBe(false);
    expect(result.build.status).toBe("succeeded");
    // Nothing to end, and ending a finished build's session would be pointless
    // work against a container that already released itself.
    expect(terminate).not.toHaveBeenCalled();
  });

  it("does not cancel a build owned by another storefront", async () => {
    const { cancelService, build } = await setup();

    await expect(
      cancelService.cancelBuild({
        storefrontId: "storefront-other",
        themeId: "theme-1",
        buildId: build.id,
      }),
    ).rejects.toThrow(/not found/);
  });
});

/**
 * Binary files are part of every build: the reuse check and the build itself
 * materialize the same revision the same way, and a build that cannot place
 * them ends failed with no artifact.
 */
describe("ThemeBuildService with binary files", () => {
  const DIGEST = "a".repeat(64);

  const seed = () => {
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at) VALUES ('storefront-1', 'channel-1', 'Store', 'draft', ?, ?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO storefront_themes (id, storefront_id, name, status, created_at, updated_at) VALUES ('theme-1', 'storefront-1', 'Main Theme', 'draft', ?, ?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        "INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, message, source, snapshot, created_at, updated_at) VALUES ('rev-binary', 'storefront-1', 'theme-1', 1, 'Checkpoint', 'manual', ?, ?, ?)",
      )
      .run(
        JSON.stringify([
          {
            path: "src/index.tsx",
            content: "export default () => <h1>Binary</h1>;",
            isEntry: true,
          },
          {
            path: "public/images/hero.png",
            encoding: "binary",
            blobDigest: DIGEST,
            sizeBytes: 16,
            mimeType: "image/png",
            isEntry: false,
          },
        ]),
        now,
        now,
      );
  };

  const request = (target: ThemeBuildService, runner: FakeThemeBuildRunner) =>
    target.requestPreviewBuild({
      storefrontId: "storefront-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-binary",
      runner,
      reuseExisting: true,
    });

  it("hands the runner the files, from the reuse check through the build", async () => {
    seed();
    const carried: number[] = [];
    const materializer: typeof materializeThemeBuildInput = (params) => {
      const input = materializeThemeBuildInput(params);
      carried.push(input.binaryFiles?.length ?? 0);
      return input;
    };
    let received: ReadonlyArray<{ path: string }> | undefined;
    const target = new ThemeBuildService(
      storefrontThemeBuildDal,
      undefined,
      materializer,
      new FakeThemeBuildArtifactStore(),
      undefined,
      undefined,
      async () => new Uint8Array(16),
    );

    const build = await request(
      target,
      new FakeThemeBuildRunner({
        onRun: (input) => {
          received = input.binaryFiles;
        },
      }),
    );

    expect(build.status).toBe("succeeded");
    // Once for the reuse check, once for the build: the same answer.
    expect(carried).toEqual([1, 1]);
    expect(received?.map((file) => file.path)).toEqual([
      "public/images/hero.png",
    ]);
  });

  it("fails before any runner starts when a binary file takes one of the revision's routes", async () => {
    seed();
    sqlite
      .prepare(
        "UPDATE storefront_theme_revisions SET snapshot = ? WHERE id = 'rev-binary'",
      )
      .run(
        JSON.stringify([
          {
            path: "src/routes/index.tsx",
            content:
              'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/")({ component: () => null });',
            isEntry: true,
          },
          {
            path: "src/routes/lookbook[.]png.tsx",
            content:
              'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/lookbook.png")({ component: () => null });',
            isEntry: false,
          },
          {
            path: "public/lookbook.png",
            encoding: "binary",
            blobDigest: DIGEST,
            sizeBytes: 16,
            mimeType: "image/png",
            isEntry: false,
          },
        ]),
      );
    let ran = false;
    const target = new ThemeBuildService(
      storefrontThemeBuildDal,
      undefined,
      undefined,
      new FakeThemeBuildArtifactStore(),
      undefined,
      undefined,
      async () => new Uint8Array(16),
    );

    const build = await request(
      target,
      new FakeThemeBuildRunner({
        onRun: () => {
          ran = true;
        },
      }),
    );

    expect(build.status).toBe("failed");
    expect(build.errorMessage).toContain(
      "A page of the Theme already answers this URL.",
    );
    expect(build.artifactPrefix).toBeNull();
    expect(ran).toBe(false);
  });

  it("fails without an artifact when a binary file cannot be read", async () => {
    seed();
    const store = new FakeThemeBuildArtifactStore();
    let persisted = false;
    const persist = store.persistBuildArtifacts.bind(store);
    store.persistBuildArtifacts = async (input) => {
      persisted = true;
      return persist(input);
    };
    const target = new ThemeBuildService(
      storefrontThemeBuildDal,
      undefined,
      undefined,
      store,
      undefined,
      undefined,
      async (digest) => {
        throw new Error(`SOURCE_BLOB_NOT_FOUND: ${digest}`);
      },
    );

    const build = await request(
      target,
      new FakeThemeBuildRunner({
        // What both real runners do before writing a binary file.
        onRun: async (input) => {
          for (const file of input.binaryFiles ?? []) {
            await input.readBinaryFile!(file.digest);
          }
        },
      }),
    );

    // A failed build with no artifact is what publishing refuses
    // (`PUBLISH_BUILD_NOT_READY`), so nothing here can become a release.
    expect(build.status).toBe("failed");
    expect(build.errorMessage).toContain("SOURCE_BLOB_NOT_FOUND");
    expect(build.artifactPrefix).toBeNull();
    expect(persisted).toBe(false);
  });
});
