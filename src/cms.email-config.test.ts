import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { createServerOnlyFn } from "@tanstack/react-start";
import { cmsConfig } from "./cms.config";
import { defineConfig, type CMSUserConfig } from "./lib/config/create-config";
import { cloudflareAdapter } from "./lib/email/adapters";
import type { EmailAdapter } from "./lib/email/types";

const resend = vi.hoisted(() => ({ construct: vi.fn(), send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resend.send };
    constructor(key: string) {
      resend.construct(key);
    }
  },
}));
vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: (fn: () => unknown) => fn,
}));
vi.mock("./routes/_backend/dashboard/-collections", () => ({
  Account: {},
  Contents: {},
  CustomerManagement: {},
  General: {},
  Marketing: {},
  OnlineStore: {},
}));

const message = {
  to: "recipient@example.com",
  subject: "Hello",
  html: "Hello",
};
const fakeFetch = vi.fn<typeof fetch>();

// The public configuration API: replace only the root factory to choose a service.
function cloudflareConfig() {
  return defineConfig({
    ...cmsConfig,
    email: createServerOnlyFn(() =>
      cloudflareAdapter({
        defaultFromAddress:
          process.env.EMAIL_FROM_ADDRESS ?? "mail@example.com",
        defaultFromName: process.env.EMAIL_FROM_NAME ?? "Example",
        supportAddress: process.env.EMAIL_SUPPORT_ADDRESS ?? "help@example.com",
        accountId: process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID ?? "",
        apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
      }),
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of [
    "EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "CLOUDFLARE_EMAIL_ACCOUNT_ID",
    "CLOUDFLARE_EMAIL_API_TOKEN",
    "EMAIL_FROM_ADDRESS",
    "EMAIL_FROM_NAME",
    "EMAIL_SUPPORT_ADDRESS",
  ])
    vi.stubEnv(key, undefined);
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  resend.send.mockResolvedValue({ data: { id: "resend-1" }, error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("single root server-only email configuration", () => {
  it("constructs no adapter or credentials at config module load", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-import-token");
    vi.resetModules();
    const loaded = await import("./cms.config");
    expect(typeof loaded.cmsConfig.email).toBe("function");
    expect(resend.construct).not.toHaveBeenCalled();
    expect(JSON.stringify(loaded.cmsConfig)).not.toContain("fake-import-token");
    loaded.cmsConfig.email();
    expect(resend.construct).toHaveBeenCalledExactlyOnceWith(
      "fake-import-token",
    );
  });

  it("keeps Resend as the authored default, not a credential or environment-name heuristic", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-cf-token");
    // The former convenience selector is no longer a selection API.
    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
    const adapter = cmsConfig.email();
    expect(adapter.id).toBe("resend");
    expect(adapter.supportAddress).toBe("support@morph.com");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: true,
    });
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "medusa <medusa@mail.cmsapp.org>",
      }),
    );
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(cmsConfig.server()).not.toHaveProperty("email");
    expect(cmsConfig.server()).not.toHaveProperty("emailSupportAddress");
  });

  it("preserves missing-Resend-key failure without network calls", async () => {
    const adapter = cmsConfig.email();
    expect(adapter.id).toBe("resend");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("not configured"),
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("reads identity, credentials and support from the one factory at call time", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-first-key");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "override@example.com");
    vi.stubEnv("EMAIL_FROM_NAME", "Override");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "support@example.com");
    const first = cmsConfig.email();
    expect(first.supportAddress).toBe("support@example.com");
    await first.send(message);
    expect(resend.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "Override <override@example.com>",
      }),
    );
    vi.stubEnv("RESEND_API_KEY", "fake-next-key");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "next@example.com");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "next-help@example.com");
    const next = cmsConfig.email();
    expect(next.supportAddress).toBe("next-help@example.com");
    await next.send(message);
    expect(resend.construct).toHaveBeenLastCalledWith("fake-next-key");
    expect(resend.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "Override <next@example.com>",
      }),
    );
    expect(JSON.stringify(cmsConfig)).not.toContain("fake-next-key");
  });

  it("allows an explicitly empty display name", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    vi.stubEnv("EMAIL_FROM_NAME", "");
    await cmsConfig.email().send(message);
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "medusa@mail.cmsapp.org",
      }),
    );
  });

  it("changes provider by replacing only the root factory, without duplicating identity", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-first-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "mail@example.com");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "first-help@example.com");
    fakeFetch.mockImplementation(async () =>
      Response.json({
        success: true,
        errors: [],
        result: { delivered: [message.to], queued: [], permanent_bounces: [] },
      }),
    );
    const configured = cloudflareConfig();
    const first = configured.email();
    expect(first.id).toBe("cloudflare");
    expect(first.supportAddress).toBe("first-help@example.com");
    await expect(first.send(message)).resolves.toMatchObject({ success: true });
    expect(fakeFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fake-first-token",
    });
    expect(
      JSON.parse(String(fakeFetch.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      from: { address: "mail@example.com", name: "Example" },
    });
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-next-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "next@example.com");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "next-help@example.com");
    const next = configured.email();
    expect(next.supportAddress).toBe("next-help@example.com");
    await expect(next.send(message)).resolves.toMatchObject({ success: true });
    expect(fakeFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fake-next-token",
    });
    expect(
      JSON.parse(String(fakeFetch.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      from: { address: "next@example.com" },
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(JSON.stringify(configured)).not.toContain("fake-next-token");
  });

  it("never falls back to Resend when the chosen Cloudflare adapter is unconfigured", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    const adapter = cloudflareConfig().email();
    expect(adapter.id).toBe("cloudflare");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: false,
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never falls back after the chosen Cloudflare adapter rejects a send", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-token");
    fakeFetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(
      cloudflareConfig().email().send(message),
    ).resolves.toMatchObject({
      success: false,
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("types the root as a factory and rejects the old duplicate server email fields", () => {
    expectTypeOf<CMSUserConfig["email"]>().toEqualTypeOf<
      (() => EmailAdapter) | undefined
    >();
    expectTypeOf<
      ReturnType<CMSUserConfig["server"]>["email"]
    >().toEqualTypeOf<undefined>();
    expectTypeOf<
      ReturnType<CMSUserConfig["server"]>["emailSupportAddress"]
    >().toEqualTypeOf<undefined>();
  });

  it.todo(
    "configured production sender must not use cmsapp.org or a subdomain; requires owner-approved replacement",
  );
});
