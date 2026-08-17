import type { StorefrontThemeBuildDTO } from "@/lib/storefront/dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { ThemeRevisionStore } from "@/lib/storefront/storage/theme-storage.types";
import { describe, expect, it, vi } from "vitest";
import { ThemeBuildService } from "./theme-build.service";

function makeBuild(
  overrides: Partial<StorefrontThemeBuildDTO> = {},
): StorefrontThemeBuildDTO {
  const now = new Date().toISOString();
  return {
    id: "build-1",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    status: "queued",
    inputHash: null,
    compilerId: null,
    compilerVersion: null,
    artifactPrefix: null,
    manifestJson: null,
    diagnosticsJson: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRevision(): StorefrontThemeRevisionDTO {
  return {
    id: "rev-1",
    storefrontId: "store-1",
    themeId: "theme-1",
    revisionNumber: 1,
    message: "immutable",
    source: "manual",
    snapshot: [
      {
        path: "src/pages/index.tsx",
        content: "export default () => <div>R1</div>;",
        mimeType: "text/typescript",
        isEntry: true,
      },
    ],
    createdBy: null,
    createdAt: new Date().toISOString(),
  };
}

function makeRevisionStore(
  revision: StorefrontThemeRevisionDTO,
): ThemeRevisionStore {
  return {
    createRevision: vi.fn(),
    getRevision: vi.fn(async () => revision),
    materializeRevision: vi.fn(async () => revision),
    listRevisions: vi.fn(async () => [revision]),
    rollbackToRevision: vi.fn(),
    getLatestPublishedRevision: vi.fn(async () => null),
  } as unknown as ThemeRevisionStore;
}

describe("ThemeBuildService storage boundary", () => {
  it("uses ThemeRevisionStore for reuse identity instead of reading revision storage from the build DAL", async () => {
    const revision = makeRevision();
    const revisionStore = makeRevisionStore(revision);
    const succeeded = makeBuild({
      id: "build-existing",
      status: "succeeded",
      inputHash: "hash-1",
      compilerId: "compiler",
      compilerVersion: "1",
      artifactPrefix: "storefronts/store-1/themes/theme-1/builds/build-existing",
      manifestJson: { files: [] },
    });

    const dal = {
      getRevision: vi.fn(() => {
        throw new Error("build DAL revision access must not be used");
      }),
      findSucceededBuildByIdentity: vi.fn(async () => succeeded),
      createBuild: vi.fn(),
    } as any;

    const materializer = vi.fn(() => ({
      buildId: "temp",
      storefrontId: "store-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-1",
      revisionNumber: 1,
      files: revision.snapshot,
      entry: "src/pages/index.tsx",
      inputHash: "hash-1",
      compilerId: "compiler",
      compilerVersion: "1",
    }));

    const service = new ThemeBuildService(
      dal,
      undefined,
      materializer as any,
      undefined,
      revisionStore,
    );

    const result = await service.requestPreviewBuild({
      storefrontId: "store-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-1",
      reuseExisting: true,
      compilerIdentity: {
        compilerId: "compiler",
        compilerVersion: "1",
      },
    });

    expect(result.id).toBe("build-existing");
    expect(revisionStore.getRevision).toHaveBeenCalledWith(
      "store-1",
      "theme-1",
      "rev-1",
    );
    expect(dal.getRevision).not.toHaveBeenCalled();
    expect(dal.createBuild).not.toHaveBeenCalled();
  });

  it("materializes a queued build through ThemeRevisionStore and never calls the legacy combined DAL source reader", async () => {
    const revision = makeRevision();
    const revisionStore = makeRevisionStore(revision);
    const queued = makeBuild();
    const building = makeBuild({ status: "building", inputHash: "hash-1" });
    const failed = makeBuild({
      status: "failed",
      inputHash: "hash-1",
      errorMessage: "runner failed",
    });

    const dal = {
      getBuild: vi.fn(async () => queued),
      getBuildMaterializationSource: vi.fn(() => {
        throw new Error("legacy combined source reader must not be used");
      }),
      markBuildStarted: vi.fn(async () => building),
      markBuildFailed: vi.fn(async () => failed),
    } as any;

    const materializer = vi.fn(() => ({
      buildId: "build-1",
      storefrontId: "store-1",
      themeId: "theme-1",
      sourceRevisionId: "rev-1",
      revisionNumber: 1,
      files: revision.snapshot,
      entry: "src/pages/index.tsx",
      inputHash: "hash-1",
      compilerId: "compiler",
      compilerVersion: "1",
    }));

    const runner = {
      id: "failing-runner",
      version: "1",
      run: vi.fn(async () => ({
        success: false,
        errorMessage: "runner failed",
        diagnosticsJson: { stage: "runner" },
      })),
    } as any;

    const service = new ThemeBuildService(
      dal,
      runner,
      materializer as any,
      undefined,
      revisionStore,
    );

    const result = await service.executeBuildOrchestration({
      storefrontId: "store-1",
      themeId: "theme-1",
      buildId: "build-1",
      runner,
    });

    expect(result.status).toBe("failed");
    expect(revisionStore.materializeRevision).toHaveBeenCalledWith(
      "store-1",
      "theme-1",
      "rev-1",
    );
    expect(dal.getBuildMaterializationSource).not.toHaveBeenCalled();
    expect(materializer).toHaveBeenCalledWith(
      expect.objectContaining({ build: queued, revision }),
    );
  });
});
