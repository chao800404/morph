// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `@morph/sdk/start`'s scoped reads: the same request-scoped source and
 * render context as `pages.get`, through Start's `getRequest()` (stood in
 * for by the same AsyncLocalStorage mechanism, as in index.test.ts).
 */
const scope = vi.hoisted(() => ({
  current: null as null | { getStore(): Request | undefined },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    const request = scope.current?.getStore();
    if (!request) throw new Error("No Start request in scope.");
    return request;
  },
}));

import { MorphError, morph } from "./index";

const requests = new AsyncLocalStorage<Request>();
scope.current = requests;

function serve<T>(headers: Record<string, string>, run: () => Promise<T>) {
  return requests.run(new Request("https://theme.invalid/", { headers }), run);
}

/** Answers as Core does, naming the origin each read was sent to. */
function contentService() {
  const sent: { url: string; context: string | null }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    sent.push({
      url: url.origin + url.pathname + url.search,
      context: new Headers(init?.headers).get("x-morph-render-context"),
    });
    const scope = url.searchParams.get("scope");
    const slots = { from: { origin: url.origin, scope } };
    const body =
      scope === "layout"
        ? { scope, layout: "default", slots, hiddenSlots: ["promo"] }
        : scope === "page"
          ? { scope, slots, hiddenSlots: [] }
          : { slots, hiddenSlots: [] };
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("@morph/sdk/start scoped reads", () => {
  it("reads the layout and the page-only sections from the request's own source and render context", async () => {
    const service = contentService();
    vi.stubGlobal("fetch", service.fetch);

    const [a, b] = await Promise.all([
      serve(
        {
          "x-morph-content-origin": "https://published.example",
          "x-morph-render-context": "v1.pinned.sig",
        },
        async () => ({
          layout: await morph.layouts.get("default", { path: "/" }),
          own: await morph.pages.get("/about", { scope: "page" }),
        }),
      ),
      serve(
        { "x-morph-content-origin": "http://morph-preview-content.invalid" },
        async () => morph.layouts.get("default", { path: "/" }),
      ),
    ]);

    expect(a.layout.from).toEqual({
      origin: "https://published.example",
      scope: "layout",
    });
    expect(morph.layouts.isHidden(a.layout, "promo")).toBe(true);
    expect(a.own.from).toEqual({
      origin: "https://published.example",
      scope: "page",
    });
    expect(b.from.origin).toBe("http://morph-preview-content.invalid");
    expect(service.sent).toEqual(
      expect.arrayContaining([
        {
          url: "https://published.example/_morph/content?scope=layout&layout=default&path=%2F",
          context: "v1.pinned.sig",
        },
        {
          url: "https://published.example/_morph/content?path=%2Fabout&scope=page",
          context: "v1.pinned.sig",
        },
        {
          url: "http://morph-preview-content.invalid/_morph/content?scope=layout&layout=default&path=%2F",
          context: null,
        },
      ]),
    );
  });

  it("keeps the merged read's address unchanged", async () => {
    const service = contentService();
    vi.stubGlobal("fetch", service.fetch);
    await serve(
      { "x-morph-content-origin": "https://published.example" },
      async () => morph.pages.get("/"),
    );
    expect(service.sent.map((read) => read.url)).toEqual([
      "https://published.example/_morph/content?path=%2F",
    ]);
  });

  it("fails without the platform's source, as a page read does", async () => {
    vi.stubGlobal("fetch", contentService().fetch);
    const error = await serve({}, () => morph.layouts.get("default", { path: "/" })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MorphError);
    expect(error).toMatchObject({ code: "no_content_source" });
  });
});
