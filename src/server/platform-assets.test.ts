// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

// The repo's own JSONC reader for wrangler.jsonc; a plain .mjs with no types.
// @ts-expect-error TS7016
import { parseJsonc } from "../../scripts/theme-runtime-wiring-scan.mjs";

import { servePlatformAsset } from "./platform-assets";

describe("the Worker's static asset configuration", () => {
  // The hostname check below only runs if the Worker sees the request first.
  // Without run_worker_first, Cloudflare answers a matching path from the
  // assets before the Worker is invoked, on every hostname.
  it("runs the Worker before static assets, and binds them for it", () => {
    const parsed = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
    expect(parsed.ok).toBe(true);
    expect(parsed.value.assets.binding).toBe("ASSETS");
    const rules: string[] = parsed.value.assets.run_worker_first;
    expect(rules).toContain("/*");
    // The only paths assets may answer first are Vite's own dev-server
    // modules, which no deployed asset directory has. Excluding anything else
    // — a favicon, `/assets/*` — would hand that path back to the platform's
    // files on every hostname.
    const exceptions = rules.filter((rule) => rule.startsWith("!"));
    expect(
      exceptions.filter(
        (rule) =>
          ![
            "!/@vite/*",
            "!/@id/*",
            "!/@fs/*",
            "!/@react-refresh",
            "!/src/*",
            "!/node_modules/*",
          ].includes(rule),
      ),
    ).toEqual([]);
  });
});

const assets = (status = 200) => ({
  fetch: vi.fn(
    async () =>
      new Response(status === 404 ? "not found" : "platform-bytes", { status }),
  ),
});
const env = (binding: ReturnType<typeof assets>) => ({
  PUBLIC_URL: "https://admin.client.com",
  ASSETS: binding,
});

describe("servePlatformAsset", () => {
  it("serves a platform file on the platform hostname", async () => {
    const binding = assets();
    const response = await servePlatformAsset(
      new Request("https://admin.client.com/favicon.ico"),
      env(binding),
    );
    expect(await response?.text()).toBe("platform-bytes");
    expect(binding.fetch).toHaveBeenCalledOnce();
  });

  it("never asks the platform's files on a storefront hostname", async () => {
    const binding = assets();
    for (const path of ["/favicon.ico", "/robots.txt", "/assets/index.js"]) {
      expect(
        await servePlatformAsset(
          new Request(`https://client.com${path}`),
          env(binding),
        ),
        path,
      ).toBeNull();
    }
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("hands a path that is not a platform file on to the application", async () => {
    expect(
      await servePlatformAsset(
        new Request("https://admin.client.com/dashboard"),
        env(assets(404)),
      ),
    ).toBeNull();
  });

  it("leaves writes to the application", async () => {
    const binding = assets();
    expect(
      await servePlatformAsset(
        new Request("https://admin.client.com/robots.txt", { method: "POST" }),
        env(binding),
      ),
    ).toBeNull();
    expect(binding.fetch).not.toHaveBeenCalled();
  });
});
