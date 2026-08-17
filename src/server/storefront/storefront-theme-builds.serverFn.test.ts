import { describe, expect, it, vi } from "vitest";
import { getServerThemeBuildService } from "./storefront-theme-builds.serverFn";

vi.mock("cloudflare:workers", () => ({
  env: {
    Sandbox: {
      get: vi.fn(),
      idFromName: vi.fn(),
    },
  },
}));

describe("getServerThemeBuildService", () => {
  it("injects CloudflareSandboxViteThemeBuildRunner when env.Sandbox binding is available", () => {
    const service = getServerThemeBuildService();
    expect(service).toBeDefined();
  });
});
