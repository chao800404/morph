import { FakeThemeBuildArtifactStore } from "@/lib/storefront/compiler/fake-theme-build-artifact-store";
import { FakeThemeBuildRunner } from "@/lib/storefront/compiler/fake-theme-build-runner";
import { describe, expect, it } from "vitest";
import { createServerThemeBuildService } from "./theme-build-service.factory";

describe("createServerThemeBuildService", () => {
  it("creates a ThemeBuildService with default environment bindings", () => {
    const service = createServerThemeBuildService();
    expect(service).toBeDefined();
  });

  it("accepts an injected runner and artifactStore for testing and custom workflows", () => {
    const fakeRunner = new FakeThemeBuildRunner();
    const fakeStore = new FakeThemeBuildArtifactStore();
    const service = createServerThemeBuildService({
      runner: fakeRunner,
      artifactStore: fakeStore,
    });
    expect(service).toBeDefined();
  });
});
