import { afterEach, describe, expect, it, vi } from "vitest";
import { cmsConfig } from "./cms.config";

vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: () => unknown) => fn,
}));
// This suite inspects authored config, not dashboard rendering.
vi.mock("./routes/_backend/dashboard/-collections", () => ({
  Account: {},
  Contents: {},
  CustomerManagement: {},
  General: {},
  Marketing: {},
  OnlineStore: {},
}));

afterEach(() => vi.unstubAllEnvs());

describe("authored email configuration", () => {
  it("reads provider credentials and sender overrides only when the server callback runs", () => {
    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-test-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "mail@example.com");
    vi.stubEnv("EMAIL_FROM_NAME", "Example");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "help@example.com");
    expect(cmsConfig.server().email).toMatchObject({
      provider: "cloudflare",
      defaultFromAddress: "mail@example.com",
      defaultFromName: "Example",
      supportAddress: "help@example.com",
      cloudflare: { accountId: "a".repeat(32), apiToken: "fake-test-token" },
    });
    expect(JSON.stringify(cmsConfig)).not.toContain("fake-test-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "next@example.com");
    expect(cmsConfig.server().email?.defaultFromAddress).toBe(
      "next@example.com",
    );
  });

  // Deliberately not a passing production-domain guard: preserving the old
  // default and choosing no new owner domain are explicit delivery constraints.
  it.todo(
    "configured production sender must not use cmsapp.org or a subdomain; requires owner-approved replacement",
  );
});
