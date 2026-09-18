// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServerThemePreviewServer } from "./theme-preview-server.factory";
import { validateLoopbackPreviewUrl } from "./theme-preview-server-origin";

/**
 * Which Live Preview transport an environment gets.
 *
 * The shape is `theme-worker-deployer.factory`'s, so the assertions are the same
 * ones that factory is held to: the binding decides, production is refused, and
 * a half-configured environment is explicitly unavailable rather than partly
 * wired. The one addition is that this cannot report success without a
 * transport — "no preview" has to be sayable, because the editor's fallback
 * depends on knowing it.
 */

const SANDBOX = { Sandbox: { fake: "binding" } };
const PREVIEW_HOST = { THEME_PREVIEW_HOSTNAME: "preview.localhost" };
const LOCAL = {
  MORPH_LOCAL_THEME_PREVIEW_ORIGIN: "http://127.0.0.1:5199",
  MORPH_LOCAL_THEME_PREVIEW_TOKEN: "t".repeat(48),
};

describe("choosing the Live Preview transport", () => {
  it("uses the sandbox whenever a container is bound", () => {
    const selection = createServerThemePreviewServer({
      ...SANDBOX,
      ...PREVIEW_HOST,
    });
    expect(selection.enabled).toBe(true);
    if (!selection.enabled) return;
    expect(selection.kind).toBe("cloudflare-sandbox");
    expect(selection.previewHostname).toBe("preview.localhost");
    // File application is the caller's, because it holds the container.
    expect(selection.applyFiles).toBeUndefined();
  });

  it("keeps the container even when the local variables are also set", () => {
    // A deployment cannot end up running the local transport: the binding wins
    // before the local variables are even read, the same way deployment does.
    const selection = createServerThemePreviewServer({
      ...SANDBOX,
      ...PREVIEW_HOST,
      ...LOCAL,
    });
    expect(selection.enabled).toBe(true);
    if (!selection.enabled) return;
    expect(selection.kind).toBe("cloudflare-sandbox");
    // Its addresses are still judged as Cloudflare preview addresses.
    expect(
      selection.admitAddress({ url: "http://127.0.0.1:5199/", env: {} }),
    ).toMatchObject({ ok: false });
  });

  it("stays off when a container is bound and no preview host is configured", () => {
    const selection = createServerThemePreviewServer({ ...SANDBOX });
    expect(selection).toMatchObject({
      enabled: false,
      reason: "MISSING_PREVIEW_HOST",
    });
  });

  it("uses the loopback sidecar when no container is bound and it is configured", () => {
    const selection = createServerThemePreviewServer({ ...LOCAL });
    expect(selection.enabled).toBe(true);
    if (!selection.enabled) return;
    expect(selection.kind).toBe("local-sidecar");
    expect(selection.previewHostname).toBe("127.0.0.1");
    expect(typeof selection.applyFiles).toBe("function");
    // A loopback address is admitted, and judged by the loopback rule.
    expect(
      selection.admitAddress({ url: "http://127.0.0.1:5173/", env: {} }),
    ).toMatchObject({ ok: true, origin: "http://127.0.0.1:5173" });
  });

  it("refuses the local transport in a production runtime", () => {
    const selection = createServerThemePreviewServer({
      ...LOCAL,
      ENVIRONMENT: "production",
    });
    expect(selection).toMatchObject({
      enabled: false,
      reason: "PREVIEW_TRANSPORT_UNAVAILABLE",
    });
  });

  it("refuses a local origin that is not this machine", () => {
    const selection = createServerThemePreviewServer({
      ...LOCAL,
      MORPH_LOCAL_THEME_PREVIEW_ORIGIN: "http://0.0.0.0:5199",
    });
    expect(selection.enabled).toBe(false);
    if (selection.enabled) return;
    expect(selection.reason).toBe("INVALID_LOCAL_THEME_PREVIEW_ORIGIN");
    expect(selection.message).toContain("LOCAL_PREVIEW_SIDECAR_NOT_LOOPBACK");
  });

  it("says so when nothing is configured, rather than falling back", () => {
    const selection = createServerThemePreviewServer({});
    expect(selection).toMatchObject({
      enabled: false,
      reason: "PREVIEW_TRANSPORT_UNAVAILABLE",
    });
    // A token without an origin is not a transport.
    expect(
      createServerThemePreviewServer({
        MORPH_LOCAL_THEME_PREVIEW_TOKEN: LOCAL.MORPH_LOCAL_THEME_PREVIEW_TOKEN,
      }),
    ).toMatchObject({ enabled: false });
    expect(
      createServerThemePreviewServer({
        MORPH_LOCAL_THEME_PREVIEW_ORIGIN: LOCAL.MORPH_LOCAL_THEME_PREVIEW_ORIGIN,
      }),
    ).toMatchObject({ enabled: false });
  });
});

describe("judging a locally-run preview's address", () => {
  it("admits loopback over http and nothing else", () => {
    expect(
      validateLoopbackPreviewUrl({ url: "http://127.0.0.1:5173/", env: {} }),
    ).toMatchObject({ ok: true, origin: "http://127.0.0.1:5173" });
    expect(
      validateLoopbackPreviewUrl({ url: "http://localhost:5173/", env: {} }),
    ).toMatchObject({ ok: true, origin: "http://localhost:5173" });
  });

  it("refuses an address a browser could reach from elsewhere", () => {
    const refused = (url: string) => {
      const result = validateLoopbackPreviewUrl({ url });
      expect(result.ok).toBe(false);
      return result.ok ? "" : result.reason;
    };

    expect(refused("http://0.0.0.0:5173/")).toBe("LOCAL_PREVIEW_OFF_LOOPBACK");
    expect(refused("http://10.0.0.7:5173/")).toBe("LOCAL_PREVIEW_OFF_LOOPBACK");
    expect(refused("http://preview.localhost.evil.example/")).toBe(
      "LOCAL_PREVIEW_OFF_LOOPBACK",
    );
    // A loopback preview has no certificate, so https is a claim rather than a
    // guarantee and is refused instead of trusted.
    expect(refused("https://127.0.0.1:5173/")).toBe("INSECURE_PREVIEW_URL");
    expect(refused("http://user:pass@127.0.0.1:5173/")).toBe(
      "INVALID_PREVIEW_URL",
    );
    expect(refused("not a url")).toBe("INVALID_PREVIEW_URL");
  });

  it("does not apply the storefront routing rule to a loopback address", () => {
    // `collectPlatformHostnames` classifies localhost and 127.0.0.1 as platform
    // surface on purpose, so that a request to them resolves to Morph and not
    // to a merchant's storefront. Applying that rule here would refuse every
    // local preview there can be, which is why the loopback rule replaces it
    // rather than stacking on it.
    expect(
      validateLoopbackPreviewUrl({
        url: "http://127.0.0.1:5173/",
        env: { MORPH_PLATFORM_HOSTNAMES: "127.0.0.1" },
      }),
    ).toMatchObject({ ok: true });
  });
});
