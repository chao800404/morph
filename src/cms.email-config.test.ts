import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmsConfig } from "./cms.config";

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
// This suite inspects authored config, not dashboard rendering.
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

describe("authored email configuration", () => {
  it("constructs Cloudflare only inside the server callback and reads current settings", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-test-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "mail@example.com");
    vi.stubEnv("EMAIL_FROM_NAME", "Example");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "help@example.com");
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    fakeFetch.mockImplementation(async () =>
      Response.json({
        success: true,
        errors: [],
        result: { delivered: [message.to], queued: [], permanent_bounces: [] },
      }),
    );
    const first = cmsConfig.server();
    expect(first.email?.id).toBe("cloudflare");
    expect(first.emailSupportAddress).toBe("help@example.com");
    await expect(first.email?.send(message)).resolves.toMatchObject({
      success: true,
    });
    const firstInit = fakeFetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(firstInit?.body))).toMatchObject({
      from: { address: "mail@example.com", name: "Example" },
    });
    expect(firstInit?.headers).toMatchObject({
      Authorization: "Bearer fake-test-token",
    });
    expect(JSON.stringify(cmsConfig)).not.toContain("fake-test-token");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "next@example.com");
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "next-fake-token");
    await expect(
      cmsConfig.server().email?.send(message),
    ).resolves.toMatchObject({
      success: true,
    });
    const nextInit = fakeFetch.mock.calls[1]?.[1];
    expect(JSON.parse(String(nextInit?.body))).toMatchObject({
      from: { address: "next@example.com" },
    });
    expect(nextInit?.headers).toMatchObject({
      Authorization: "Bearer next-fake-token",
    });
    expect(resend.construct).not.toHaveBeenCalled();
  });

  it("defaults to Resend even when Cloudflare credentials exist", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-resend-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-cf-token");
    const { email } = cmsConfig.server();
    expect(email?.id).toBe("resend");
    expect((await email?.send(message))?.success).toBe(true);
    expect(resend.construct).toHaveBeenCalledWith("fake-resend-key");
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "medusa <medusa@mail.cmsapp.org>" }),
    );
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("preserves missing-Resend-key failure without network calls", async () => {
    const { email } = cmsConfig.server();
    expect(email?.id).toBe("resend");
    await expect(email?.send(message)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("not configured"),
    });
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never falls back to configured Resend when Cloudflare credentials are missing", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    const { email } = cmsConfig.server();
    expect(email?.id).toBe("cloudflare");
    expect((await email?.send(message))?.success).toBe(false);
    expect(resend.construct).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never falls back after Cloudflare rejects a send", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "a".repeat(32));
    vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "fake-token");
    fakeFetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect((await cmsConfig.server().email?.send(message))?.success).toBe(
      false,
    );
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it.each(["", "Cloudflare", "other-provider"])(
    "rejects invalid explicit provider %j",
    async (provider) => {
      vi.stubEnv("EMAIL_PROVIDER", provider);
      vi.stubEnv("RESEND_API_KEY", "fake-key");
      await expect(cmsConfig.server().email?.send(message)).resolves.toEqual({
        success: false,
        error: "Email service failed: INVALID_PROVIDER",
      });
      expect(resend.construct).not.toHaveBeenCalled();
      expect(fakeFetch).not.toHaveBeenCalled();
    },
  );

  it("uses configured sender and support overrides", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "override@example.com");
    vi.stubEnv("EMAIL_FROM_NAME", "Override");
    vi.stubEnv("EMAIL_SUPPORT_ADDRESS", "support@example.com");
    const configured = cmsConfig.server();
    await configured.email?.send(message);
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Override <override@example.com>" }),
    );
    expect(configured.emailSupportAddress).toBe("support@example.com");
  });

  it("allows an explicitly empty display name", async () => {
    vi.stubEnv("RESEND_API_KEY", "fake-key");
    vi.stubEnv("EMAIL_FROM_NAME", "");
    await cmsConfig.server().email?.send(message);
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "medusa@mail.cmsapp.org" }),
    );
  });

  // Deliberately not a passing production-domain guard: preserving the old
  // default and choosing no new owner domain are explicit delivery constraints.
  it.todo(
    "configured production sender must not use cmsapp.org or a subdomain; requires owner-approved replacement",
  );
});
