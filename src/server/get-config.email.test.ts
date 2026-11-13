import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CMSUserConfig } from "@/lib/config/create-config";
import type { EmailAdapter } from "@/lib/email/types";
import { cloudflareAdapter, resendAdapter } from "@/lib/email/adapters";
import { getConfig } from "./get-config";

const state = vi.hoisted(() => ({
  client: false,
  server: vi.fn<CMSUserConfig["server"]>(),
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
    state.server.mockReset().mockReturnValue({});
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
      database: { connectionString: "fake-server-only-database" },
      email: resendAdapter({
        apiKey: "fake-resend-key",
        defaultFromAddress: "override@example.com",
        defaultFromName: "Override",
        supportAddress: "help@example.com",
      }),
    });
    const config = getConfig();
    expect(state.server).toHaveBeenCalledTimes(1);
    expect(config.server.database).toEqual({
      connectionString: "fake-server-only-database",
    });
    expect(config.client).not.toHaveProperty("database");
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
      email: cloudflareAdapter({
        defaultFromAddress: "mail@example.com",
        accountId: "a".repeat(32),
        apiToken: "fake-token",
        supportAddress: "cloudflare-help@example.com",
      }),
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
    expect(config.server.emailSupportAddress).toBe(
      "cloudflare-help@example.com",
    );
    expect(state.server).toHaveBeenCalledTimes(1);
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
  it("passes an arbitrary adapter through unchanged without a provider registry", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ success: true, messageId: "custom-1" });
    const sendBatch = vi.fn().mockResolvedValue([{ success: true }]);
    const custom: EmailAdapter = {
      id: "owner-custom-provider",
      supportAddress: "support@example.com",
      async send(params) {
        expect(this).toBe(custom);
        return send(params);
      },
      async sendBatch(params) {
        expect(this).toBe(custom);
        return sendBatch(params);
      },
    };
    const server: CMSUserConfig["server"] = () => ({ email: custom });
    state.server.mockImplementation(server);
    const config = getConfig();
    expect(config.server.email).toBe(custom);
    expect(state.server).toHaveBeenCalledTimes(1);
    expect(config.server.emailSupportAddress).toBe("support@example.com");
    const message = { to: "buyer@example.com", subject: "Hi", html: "Hi" };
    await expect(config.server.email?.send(message)).resolves.toEqual({
      success: true,
      messageId: "custom-1",
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(message);
    await config.server.email?.sendBatch?.([message]);
    expect(sendBatch).toHaveBeenCalledExactlyOnceWith([message]);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("preserves a custom adapter's failure without replacing or retrying it", async () => {
    const custom: EmailAdapter = {
      id: "custom-failure",
      send: vi
        .fn()
        .mockResolvedValue({ success: false, error: "CUSTOM_FAILURE" }),
    };
    state.server.mockReturnValue({ email: custom });
    await expect(
      getConfig().server.email?.send({
        to: "buyer@example.com",
        subject: "Hi",
        html: "Hi",
      }),
    ).resolves.toEqual({ success: false, error: "CUSTOM_FAILURE" });
    expect(custom.send).toHaveBeenCalledTimes(1);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("does not invent a provider when the server callback omits email", () => {
    const config = getConfig();
    expect(config.server.email).toBeUndefined();
    expect(config.server.emailSupportAddress).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("propagates a server adapter construction failure without fallback", () => {
    const failure = new Error("CUSTOM_CONFIGURATION_FAILURE");
    state.server.mockImplementation(() => {
      throw failure;
    });
    expect(() => getConfig()).toThrow(failure);
    expect(state.server).toHaveBeenCalledTimes(1);
    expect(state.send).not.toHaveBeenCalled();
  });
});
