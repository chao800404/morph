// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  finishPreviewResponse,
  proxyPreviewModuleRequest,
  uncacheablePreviewError,
} from "./preview-proxy-response";
import { readPreviewErrorCode } from "./preview-proxy-observation";
import {
  PREVIEW_RUNTIME_INTERRUPTED_CODE,
  PREVIEW_RUNTIME_INTERRUPTED_STATUS,
} from "./preview-runtime-interruption";

describe("bounded recovery of SDK module routing failures", () => {
  const interrupted = () =>
    new Response("Proxy routing error", { status: 500 });
  const request = (path = "/src/components/Hero.tsx", method = "GET") =>
    new Request(`https://preview.example${path}`, { method });

  it("retries an interrupted module, keeping the original credentials and URL", async () => {
    const input = request();
    const success = new Response("export default {}", {
      headers: { ETag: "v1" },
    });
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(interrupted())
      .mockResolvedValueOnce(success);
    const pause = vi.fn().mockResolvedValue(undefined);
    expect(await proxyPreviewModuleRequest(input, proxy, pause)).toBe(success);
    expect(proxy.mock.calls).toEqual([[input], [input]]);
    expect(pause.mock.calls).toEqual([[100]]);
  });

  it("stops after two retries and answers with the interruption status", async () => {
    const proxy = vi.fn().mockImplementation(async () => interrupted());
    const pause = vi.fn().mockResolvedValue(undefined);
    const response = await proxyPreviewModuleRequest(request(), proxy, pause);
    expect(proxy).toHaveBeenCalledTimes(3);
    expect(pause.mock.calls).toEqual([[100], [250]]);
    const finished = finishPreviewResponse(response!);
    // Not the SDK's 500, which a Theme's compile error shares: the editor
    // reloads a page broken by this status and leaves a Theme's 500 alone.
    expect(finished.status).toBe(PREVIEW_RUNTIME_INTERRUPTED_STATUS);
    expect(finished.headers.get("cache-control")).toBe("no-store");
    expect(await readPreviewErrorCode(finished)).toBe(
      PREVIEW_RUNTIME_INTERRUPTED_CODE,
    );
  });

  it("passes the container's own 500 through on the last attempt", async () => {
    const compileError = new Response("Proxy routing error", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(interrupted())
      .mockResolvedValueOnce(interrupted())
      .mockResolvedValueOnce(compileError);
    expect(await proxyPreviewModuleRequest(request(), proxy, vi.fn())).toBe(
      compileError,
    );
    expect(proxy).toHaveBeenCalledTimes(3);
  });

  it("leaves the SDK's 500 alone for a request it never retries", async () => {
    const refused = interrupted();
    const proxy = vi.fn().mockResolvedValue(refused);
    expect(
      await proxyPreviewModuleRequest(request("/", "GET"), proxy, vi.fn()),
    ).toBe(refused);
  });

  it.each([
    "/@react-refresh",
    "/@vite/client",
    "/@vite/env",
    "/@id/virtual:tanstack-start-dev-client-entry",
    "/@tanstack-start/styles.css?routes=__root__,/compat-ssr-data",
    "/__morph_preview_client.ts",
    "/__morph-theme-preview__/@react-refresh",
    "/__morph-theme-preview__/src/index.tsx",
    "/__morph-theme-preview__/__entry.tsx",
    "/__morph-theme-preview__/@id/__x00__morph-theme-start-server-stub",
    "/__morph-theme-preview__/@id/__x00__morph-theme-preview-async-hooks-stub",
    "/__morph-theme-preview__/@id/__x00__morph-theme-start-fn-stubs",
  ])("also recovers Vite's extensionless module %s", async (path) => {
    const success = new Response("export {}");
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(interrupted())
      .mockResolvedValueOnce(success);
    expect(await proxyPreviewModuleRequest(request(path), proxy, vi.fn())).toBe(
      success,
    );
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it("answers a Morph stub interrupted past the retries with the interruption status", async () => {
    // Observed in a local container run: the SDK's 500 for this module went
    // to the browser as it was, the page's entry failed with it, and the
    // editor could not tell it from a Theme's compile error, so it never
    // reconnected the frame.
    const proxy = vi.fn().mockImplementation(async () => interrupted());
    const response = await proxyPreviewModuleRequest(
      request(
        "/__morph-theme-preview__/@id/__x00__morph-theme-start-server-stub",
      ),
      proxy,
      vi.fn().mockResolvedValue(undefined),
    );
    expect(proxy).toHaveBeenCalledTimes(3);
    expect(response?.status).toBe(PREVIEW_RUNTIME_INTERRUPTED_STATUS);
  });

  it("does not turn an unreadable error body into a routing exception", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("stream lost"));
        },
      }),
      { status: 500, headers: { "content-type": "text/plain" } },
    );
    const proxy = vi.fn().mockResolvedValue(response);
    expect(await proxyPreviewModuleRequest(request(), proxy, vi.fn())).toBe(
      response,
    );
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["/", "GET"],
    ["/api/example", "GET"],
    ["/_serverFn/example", "GET"],
    ["/src/example.ts", "POST"],
    ["/src/example.ts", "HEAD"],
    ["/src/example.svg", "GET"],
    ["/@id/virtual:tanstack-start-validate-server-fn-id?id=example", "GET"],
    ["/@id/virtual:unknown", "GET"],
    ["/@id/__x00__theme-own-virtual-module", "GET"],
    [
      "/__morph-theme-preview__/@id/__x00__morph-theme-start-server-stub",
      "POST",
    ],
    ["/@tanstack-start/unknown", "GET"],
    ["/@id/virtual:tanstack-start-dev-client-entry", "POST"],
    ["/@tanstack-start/styles.css", "POST"],
  ])("never replays %s %s", async (path, method) => {
    const proxy = vi.fn().mockResolvedValue(interrupted());
    const pause = vi.fn();
    await proxyPreviewModuleRequest(request(path, method), proxy, pause);
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it.each([
    new Response("compiler failed", { status: 500 }),
    new Response("Proxy routing error", { status: 401 }),
    new Response("Proxy routing error", { status: 403 }),
    new Response("Proxy routing error", {
      status: 500,
      headers: { "content-type": "text/html" },
    }),
    new Response("Proxy routing error".repeat(100), { status: 500 }),
  ])("passes other refusals through untouched", async (response) => {
    const proxy = vi.fn().mockResolvedValue(response);
    expect(await proxyPreviewModuleRequest(request(), proxy, vi.fn())).toBe(
      response,
    );
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(false);
  });
});

describe("uncacheablePreviewError", () => {
  it("forbids storing a refusal, keeping everything else about it", async () => {
    const refused = new Response(
      JSON.stringify({ code: "STALE_PREVIEW_URL" }),
      {
        status: 410,
        statusText: "Gone",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "max-age=3600",
        },
      },
    );

    const response = uncacheablePreviewError(refused);

    expect(response.status).toBe(410);
    expect(response.statusText).toBe("Gone");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ code: "STALE_PREVIEW_URL" });
  });

  it("covers every error status, not only 410", () => {
    for (const status of [404, 500, 502]) {
      expect(
        uncacheablePreviewError(new Response(null, { status })).headers.get(
          "Cache-Control",
        ),
      ).toBe("no-store");
    }
  });

  it("returns a successful response untouched", () => {
    const ok = new Response("export {}", {
      headers: { "Cache-Control": "no-cache", ETag: 'W/"1"' },
    });
    expect(uncacheablePreviewError(ok)).toBe(ok);
  });
});

describe("finishPreviewResponse", () => {
  it("isolates an SVG the container sent, and passes a page through", () => {
    const svg = finishPreviewResponse(
      new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    );
    expect(svg.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(svg.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const page = finishPreviewResponse(
      new Response("<p>", { headers: { "Content-Type": "text/html" } }),
    );
    expect(page.headers.get("Content-Security-Policy")).toBeNull();
  });
});
