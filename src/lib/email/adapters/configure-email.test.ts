import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureEmail } from "./configure-email";

const resend = vi.hoisted(() => ({ construct: vi.fn(), send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resend.send };
    constructor(key: string) {
      resend.construct(key);
    }
  },
}));

const defaults = {
  defaultFromAddress: "sender@example.com",
  defaultFromName: "Shop",
  supportAddress: "help@example.com",
};
const message = {
  to: "recipient@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
};

describe("email provider selection", () => {
  const fakeFetch = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fakeFetch);
    resend.send.mockResolvedValue({ data: { id: "resend-1" }, error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Resend even when Cloudflare credentials exist", async () => {
    const { email } = configureEmail(defaults, {
      apiKey: "fake-resend-key",
      cloudflare: { accountId: "a".repeat(32), apiToken: "fake-cf-token" },
    });
    expect(email.id).toBe("resend");
    expect((await email.send(message)).success).toBe(true);
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Shop <sender@example.com>" }),
    );
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("preserves missing-Resend-key failure without touching the network", async () => {
    const { email } = configureEmail(defaults);
    expect(email.id).toBe("resend");
    await expect(email.send(message)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("not configured"),
    });
    expect(console.error).toHaveBeenCalled();
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("explicitly selects Cloudflare and never constructs Resend", async () => {
    fakeFetch.mockResolvedValue(
      Response.json({
        success: true,
        errors: [],
        result: { delivered: [message.to], queued: [], permanent_bounces: [] },
      }),
    );
    const { email } = configureEmail(defaults, {
      provider: "cloudflare",
      apiKey: "fake-resend-key",
      cloudflare: { accountId: "a".repeat(32), apiToken: "fake-cf-token" },
    });
    expect(email.id).toBe("cloudflare");
    expect((await email.send(message)).success).toBe(true);
    expect(resend.construct).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("never falls back to configured Resend when Cloudflare credentials are missing", async () => {
    const { email } = configureEmail(defaults, {
      provider: "cloudflare",
      apiKey: "fake-resend-key",
    });
    expect(email.id).toBe("cloudflare");
    expect((await email.send(message)).success).toBe(false);
    expect(resend.construct).not.toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never falls back after Cloudflare rejects a send", async () => {
    fakeFetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const { email } = configureEmail(defaults, {
      provider: "cloudflare",
      apiKey: "fake-resend-key",
      cloudflare: { accountId: "a".repeat(32), apiToken: "fake-cf-token" },
    });
    expect((await email.send(message)).success).toBe(false);
    expect(resend.send).not.toHaveBeenCalled();
  });

  it.each(["", "Cloudflare", "other-provider"])(
    "rejects an unknown explicit provider %j instead of choosing the default",
    async (provider) => {
      const { email } = configureEmail(defaults, {
        provider,
        apiKey: "fake-resend-key",
      });
      await expect(email.send(message)).resolves.toEqual({
        success: false,
        error: "Email service failed: INVALID_PROVIDER",
      });
      expect(resend.construct).not.toHaveBeenCalled();
      expect(fakeFetch).not.toHaveBeenCalled();
    },
  );

  it("uses configured identity overrides, including the support address", async () => {
    const configured = configureEmail(defaults, {
      apiKey: "fake-key",
      defaultFromAddress: "override@example.com",
      defaultFromName: "Override",
      supportAddress: "support@example.com",
    });
    await configured.email.send(message);
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Override <override@example.com>" }),
    );
    expect(configured.emailSupportAddress).toBe("support@example.com");
  });

  it("allows an explicitly empty display name", async () => {
    const { email } = configureEmail(defaults, {
      apiKey: "fake-key",
      defaultFromName: "",
    });
    await email.send(message);
    expect(resend.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "sender@example.com" }),
    );
  });
});
