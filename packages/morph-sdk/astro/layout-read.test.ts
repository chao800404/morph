// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MorphError, morph, useMorphRenders } from "./index";

/**
 * `@morph/sdk/astro`'s scoped reads: the same render-scoped source and
 * render context as `pages.get`, through the platform's AsyncLocalStorage
 * (set up as index.test.ts sets it up).
 */
const renders = new AsyncLocalStorage<Request>();

function render<T>(headers: Record<string, string>, page: () => Promise<T>) {
  useMorphRenders(renders);
  return renders.run(new Request("https://theme.invalid/", { headers }), page);
}

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

describe("@morph/sdk/astro scoped reads", () => {
  it("reads the layout and the page-only sections from the render's own source and render context", async () => {
    const service = contentService();
    vi.stubGlobal("fetch", service.fetch);

    const [a, b] = await Promise.all([
      render(
        {
          "x-morph-content-origin": "https://published.example",
          "x-morph-render-context": "v1.pinned.sig",
        },
        async () => ({
          layout: await morph.layouts.get("default"),
          own: await morph.pages.get("/about", { scope: "page" }),
          merged: await morph.pages.get("/about"),
        }),
      ),
      render(
        { "x-morph-content-origin": "http://morph-preview-content.invalid" },
        async () => morph.layouts.get("default"),
      ),
    ]);

    expect(a.layout.from).toEqual({
      origin: "https://published.example",
      scope: "layout",
    });
    expect(morph.layouts.isHidden(a.layout, "promo")).toBe(true);
    expect(a.own.from.scope).toBe("page");
    expect(a.merged.from.scope).toBeNull();
    expect(b.from.origin).toBe("http://morph-preview-content.invalid");
    expect(service.sent).toEqual(
      expect.arrayContaining([
        {
          url: "https://published.example/_morph/content?scope=layout&layout=default",
          context: "v1.pinned.sig",
        },
        {
          url: "https://published.example/_morph/content?path=%2Fabout&scope=page",
          context: "v1.pinned.sig",
        },
        {
          url: "https://published.example/_morph/content?path=%2Fabout",
          context: "v1.pinned.sig",
        },
        {
          url: "http://morph-preview-content.invalid/_morph/content?scope=layout&layout=default",
          context: null,
        },
      ]),
    );
  });

  it("fails outside a wired render, as a page read does", async () => {
    vi.stubGlobal("fetch", contentService().fetch);
    useMorphRenders(renders);
    const error = await morph.layouts
      .get("default")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MorphError);
    expect(error).toMatchObject({ code: "no_content_source" });
  });
});
