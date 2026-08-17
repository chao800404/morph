import { FakeThemeBuildRunner } from "@/lib/storefront/compiler/fake-theme-build-runner";
import { describe, expect, it } from "vitest";
import { getServerThemeBuildService } from "./storefront-theme-builds.serverFn";

describe("getServerThemeBuildService", () => {
  it("creates a ThemeBuildService without runner for Phase 4B-5 queued flow", () => {
    const service = getServerThemeBuildService();
    expect(service).toBeDefined();
  });

  it("accepts an injected runner for testing and custom workflows", () => {
    const fakeRunner = new FakeThemeBuildRunner();
    const service = getServerThemeBuildService({ runner: fakeRunner });
    expect(service).toBeDefined();
  });
});

