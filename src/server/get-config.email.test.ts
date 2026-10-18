import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailProviderConfig } from "@/lib/email/types";
import { getConfig } from "./get-config";

const state = vi.hoisted(() => ({
  client: false,
  server: vi.fn<() => { email: EmailProviderConfig }>(),
  send: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createIsomorphicFn: () => ({
    server: (server: () => unknown) => ({
      client: (client: () => unknown) => () =>
        state.client ? client() : server(),
    }),
  }),
}));
vi.mock("@/cms.config", () => ({
  cmsConfig: {
    appName: "Example",
    collections: { global: [], settings: [] },
    localization: { defaultLocale: "en" },
    trustedOrigins: [],
    upload: {
      maxFileSize: 1,
      minFiles: 1,
      maxFiles: 1,
      maxAssetsPerRecord: 1,
      allowedTypes: [],
    },
    email: {
      defaultFromAddress: "mail@example.com",
      defaultFromName: "Example",
      supportAddress: "support@example.com",
    },
    server: state.server,
  },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: state.send };
  },
}));
vi.mock(
  "@/lib/fulfillment/providers/fulfillment-provider-registry.server",
  () => ({ fulfillmentProviderRegistry: { configure: vi.fn() } }),
);
vi.mock(
  "@/lib/shipping/providers/shipping-rate-provider-registry.server",
  () => ({ shippingRateProviderRegistry: { configure: vi.fn() } }),
);
vi.mock("@/lib/tax/providers/tax-provider-registry.server", () => ({
  taxProviderRegistry: { configure: vi.fn() },
}));

describe("server-only email composition", () => {
  beforeEach(() => {
    state.client = false;
    state.server.mockReset();
    state.send
      .mockReset()
      .mockResolvedValue({ data: { id: "fake-message" }, error: null });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("wires configured sender and support values into the actual server config", async () => {
    state.server.mockReturnValue({
      email: {
        apiKey: "fake-resend-key",
        defaultFromAddress: "override@example.com",
        defaultFromName: "Override",
        supportAddress: "help@example.com",
      },
    });
    const config = getConfig();
    expect(config.server.emailSupportAddress).toBe("help@example.com");
    await config.server.email?.send({
      to: "buyer@example.com",
      subject: "Hello",
      html: "Hello",
    });
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Override <override@example.com>" }),
    );
    expect(config.client).not.toHaveProperty("emailSupportAddress");
  });

  it("wires an explicit Cloudflare provider without a Worker binding", async () => {
    state.server.mockReturnValue({
      email: {
        provider: "cloudflare",
        cloudflare: { accountId: "a".repeat(32), apiToken: "fake-token" },
      },
    });
    const fakeFetch = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        errors: [],
        result: {
          delivered: ["buyer@example.com"],
          queued: [],
          permanent_bounces: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fakeFetch);
    const config = getConfig();
    expect(config.server.email?.id).toBe("cloudflare");
    expect(
      (
        await config.server.email?.send({
          to: "buyer@example.com",
          subject: "Hi",
          html: "Hi",
        })
      )?.success,
    ).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("never reads server credentials or constructs an adapter for the client view", () => {
    state.client = true;
    state.server.mockImplementation(() => {
      throw new Error("must not run");
    });
    const config = getConfig();
    expect(state.server).not.toHaveBeenCalled();
    expect(config.server.email).toBeUndefined();
    expect(config.server.emailSupportAddress).toBeUndefined();
    expect(config.client).not.toHaveProperty("email");
    expect(config.client).not.toHaveProperty("cloudflare");
  });
});
