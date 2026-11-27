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
import { cloudflareAdapter, resendAdapter } from "./lib/email/adapters";
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

// The public configuration API: select the adapter inside the server callback.
// Replacing only the adapter call is how an owner switches back to Resend.
function resendConfig() {
  return defineConfig({
    ...cmsConfig,
    server: createServerOnlyFn(() => ({
      email: resendAdapter({
        defaultFromAddress:
          process.env.EMAIL_FROM_ADDRESS ?? "mail@example.com",
        defaultFromName: process.env.EMAIL_FROM_NAME ?? "Example",
        supportAddress: process.env.EMAIL_SUPPORT_ADDRESS ?? "help@example.com",
        apiKey: process.env.RESEND_API_KEY ?? "",
      }),
    })),
  });
}

function cloudflareConfig() {
  return defineConfig({
    ...cmsConfig,
    server: createServerOnlyFn(() => ({
      email: cloudflareAdapter({
        defaultFromAddress:
          process.env.EMAIL_FROM_ADDRESS ?? "mail@example.com",
        defaultFromName: process.env.EMAIL_FROM_NAME ?? "Example",
        supportAddress: process.env.EMAIL_SUPPORT_ADDRESS ?? "help@example.com",
        accountId: process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID ?? "",
        apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
      }),
    })),
  });
}

const okResponse = () =>
  Response.json({
    success: true,
    errors: [],
    result: { delivered: [message.to], queued: [], permanent_bounces: [] },
  });

function emailFrom(config: CMSUserConfig = cmsConfig): EmailAdapter {
  const adapter = config.server().email;
  if (!adapter) throw new Error("Expected an explicitly configured adapter");
  return adapter;
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

describe("single server-only email configuration", () => {
  it("constructs no adapter or credentials at config module load", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-import-token");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    fakeFetch.mockImplementation(async () => okResponse());
    vi.resetModules();
    const loaded = await import("./cms.config");
    expect(typeof loaded.cmsConfig.server).toBe("function");
    expect(loaded.cmsConfig).not.toHaveProperty("email");
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(loaded.cmsConfig)).not.toContain("fake-import-token");
    const adapter = emailFrom(loaded.cmsConfig);
    expect(fakeFetch).not.toHaveBeenCalled();
    await adapter.send(message);
    expect(fakeFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fake-import-token",
    });
  });

  it("keeps Cloudflare as the authored default, not a credential or environment-name heuristic", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-cf-token");
    // The former convenience selector is no longer a selection API.
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    fakeFetch.mockImplementation(async () => okResponse());
    const adapter = emailFrom();
    expect(adapter.id).toBe("cloudflare");
    expect(adapter.supportAddress).toBe("support@morph.com");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: true,
    });
    expect(
      JSON.parse(String(fakeFetch.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      from: { address: "medusa@mail.cmsapp.org", name: "medusa" },
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(cmsConfig).not.toHaveProperty("email");
    expect(cmsConfig.server()).not.toHaveProperty("emailSupportAddress");
  });

  it("ignores the presence of RESEND_API_KEY when Cloudflare is unconfigured, without network or fallback", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    const adapter = emailFrom();
    expect(adapter.id).toBe("cloudflare");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: false,
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("preserves missing-Cloudflare-credentials failure without network calls", async () => {
    const adapter = emailFrom();
    expect(adapter.id).toBe("cloudflare");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("NOT_CONFIGURED"),
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("does not retry or fall back to Resend when the default Cloudflare adapter rejects a send", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-token");
    fakeFetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(emailFrom().send(message)).resolves.toMatchObject({
      success: false,
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("still works with Resend when it is chosen explicitly in the server callback", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-cf-token");
    const adapter = emailFrom(resendConfig());
    expect(adapter.id).toBe("resend");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: true,
    });
    expect(resend.construct).toHaveBeenCalledExactlyOnceWith(
      "fake-resend-key",
    );
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Example <mail@example.com>" }),
    );
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("keeps the explicit Resend missing-key failure without network calls", async () => {
    const adapter = emailFrom(resendConfig());
    expect(adapter.id).toBe("resend");
    await expect(adapter.send(message)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("not configured"),
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("reads identity, credentials and support from the server callback at call time", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-first-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "override@example.com");
    vi.stubEnv("EMAIL_FROM_NAME", "Override");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "support@example.com");
    fakeFetch.mockImplementation(async () => okResponse());
    const first = emailFrom();
    expect(first.supportAddress).toBe("support@example.com");
    await first.send(message);
    expect(fakeFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fake-first-token",
    });
    expect(
      JSON.parse(String(fakeFetch.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      from: { address: "override@example.com", name: "Override" },
    });
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-next-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "next@example.com");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "next-help@example.com");
    const next = emailFrom();
    expect(next.supportAddress).toBe("next-help@example.com");
    await next.send(message);
    expect(fakeFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fake-next-token",
    });
    expect(
      JSON.parse(String(fakeFetch.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      from: { address: "next@example.com", name: "Override" },
    });
    expect(JSON.stringify(cmsConfig)).not.toContain("fake-next-token");
  });

  it("allows an explicitly empty display name", async () => {
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-token");
    vi.stubEnv("EMAIL_FROM_NAME", "");
    fakeFetch.mockImplementation(async () => okResponse());
    await emailFrom().send(message);
    const from = JSON.parse(String(fakeFetch.mock.calls[0]?.[1]?.body)).from;
    expect(from).toMatchObject({ address: "medusa@mail.cmsapp.org" });
    expect(from.name || undefined).toBeUndefined();
  });

  it("changes provider by replacing only the server email adapter, without duplicating identity", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-first-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-cf-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "mail@example.com");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "first-help@example.com");
    const configured = resendConfig();
    const first = emailFrom(configured);
    expect(first.id).toBe("resend");
    expect(first.supportAddress).toBe("first-help@example.com");
    await expect(first.send(message)).resolves.toMatchObject({ success: true });
    expect(resend.construct).toHaveBeenLastCalledWith("fake-first-key");
    expect(resend.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "Example <mail@example.com>" }),
    );
    vi.stubEnv("RESEND_API_KEY", "fake-next-key");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "next@example.com");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "next-help@example.com");
    const next = emailFrom(configured);
    expect(next.supportAddress).toBe("next-help@example.com");
    await expect(next.send(message)).resolves.toMatchObject({ success: true });
    expect(resend.construct).toHaveBeenLastCalledWith("fake-next-key");
    expect(resend.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "Example <next@example.com>" }),
    );
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(configured)).not.toContain("fake-next-key");
  });

  it("never falls back to Resend when the chosen Cloudflare adapter is unconfigured", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    const adapter = emailFrom(cloudflareConfig());
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
      emailFrom(cloudflareConfig()).send(message),
    ).resolves.toMatchObject({
      success: false,
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("types server email as an adapter and rejects duplicate root or support settings", () => {
    expectTypeOf<CMSUserConfig["email"]>().toEqualTypeOf<undefined>();
    expectTypeOf<ReturnType<CMSUserConfig["server"]>["email"]>().toEqualTypeOf<
      EmailAdapter | undefined
    >();
    expectTypeOf<
      ReturnType<CMSUserConfig["server"]>["emailSupportAddress"]
    >().toEqualTypeOf<undefined>();
  });

  it.todo(
    "configured production sender must not use cmsapp.org or a subdomain; requires owner-approved replacement",
  );
});
