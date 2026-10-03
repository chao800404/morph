// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  finishPreviewResponse,
  proxyPreviewModuleRequest,
  uncacheablePreviewError,
} from "./preview-proxy-response";

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

  it("stops after two retries and still isolates the failed response", async () => {
    const proxy = vi.fn().mockImplementation(async () => interrupted());
    const pause = vi.fn().mockResolvedValue(undefined);
    const response = await proxyPreviewModuleRequest(request(), proxy, pause);
    expect(proxy).toHaveBeenCalledTimes(3);
    expect(pause.mock.calls).toEqual([[100], [250]]);
    const finished = finishPreviewResponse(response!);
    expect(finished.headers.get("cache-control")).toBe("no-store");
    expect(await finished.text()).toBe("Proxy routing error");
  });

  it.each([
    "/@react-refresh",
    "/@vite/client",
    "/@vite/env",
    "/__morph_preview_client.ts",
    "/__morph-theme-preview__/@react-refresh",
    "/__morph-theme-preview__/src/index.tsx",
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
