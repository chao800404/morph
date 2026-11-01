// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MorphError, contentOriginFor, morph, useMorphRenders } from "./index";

/**
 * `@morph/sdk/astro` takes each render's request from the platform's
 * middleware. Here it is set up as that middleware does
 * (theme-morph-sdk.ts): one AsyncLocalStorage handed to `useMorphRenders`,
 * and each render run inside it, the page's reads within. The real
 * middleware runs in `astro build` and `astro dev` (astro-sdk-read.build.test.ts,
 * local-vite-preview-server.astro.test.ts).
 */
const renders = new AsyncLocalStorage<Request>();

function render<T>(headers: Record<string, string>, page: () => Promise<T>) {
  useMorphRenders(renders);
  return renders.run(new Request("https://theme.invalid/", { headers }), page);
}

const page = (title: string) =>
  new Response(
    JSON.stringify({ slots: { hero: { title } }, hiddenSlots: [] }),
    { headers: { "content-type": "application/json" } },
  );

/** Answers each content read with the origin it was sent to, once released. */
function contentService() {
  const seen: string[] = [];
  const gates = new Map<string, () => void>();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    seen.push(url.origin + url.pathname + url.search);
    await new Promise<void>((resolve) => gates.set(url.origin, resolve));
    return page(url.origin);
  });
  const release = async (origin: string) => {
    await vi.waitFor(() => expect(gates.has(origin)).toBe(true));
    gates.get(origin)!();
    gates.delete(origin);
  };
  return { fetch, seen, release };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("@morph/sdk/astro", () => {
  it("sends the render's context back on its page reads, and none when the render has none (G3)", async () => {
    const sent: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(new Headers(init?.headers).get("x-morph-render-context"));
        return page("ok");
      }),
    );

    await render(
      {
        "x-morph-content-origin": "https://published.example",
        "x-morph-render-context": "v1.pinned.sig",
      },
      () => morph.pages.get("/"),
    );
    await render({ "x-morph-content-origin": "https://published.example" }, () =>
      morph.pages.get("/"),
    );

    expect(sent).toEqual(["v1.pinned.sig", null]);
  });

  it("reads the content source the platform named for the render", async () => {
    const service = contentService();
    vi.stubGlobal("fetch", service.fetch);

    const read = render(
      { "x-morph-content-origin": "https://draft.morph.invalid" },
      () => morph.pages.get("/"),
    );
    await service.release("https://draft.morph.invalid");

    expect(await read).toMatchObject({
      hero: { title: "https://draft.morph.invalid" },
    });
    expect(service.seen).toEqual([
      "https://draft.morph.invalid/_morph/content?path=%2F",
    ]);
  });

  it("two renders at once each read their own source, whichever finishes first", async () => {
    const service = contentService();
    vi.stubGlobal("fetch", service.fetch);

    const first = render(
      { "x-morph-content-origin": "https://a.invalid" },
      () => morph.pages.get("/"),
    );
    const second = render(
      { "x-morph-content-origin": "https://b.invalid" },
      () => morph.pages.get("/"),
    );
    // The second render answers first; the first is still reading.
    await service.release("https://b.invalid");
    expect(await second).toMatchObject({
      hero: { title: "https://b.invalid" },
    });
    await service.release("https://a.invalid");
    expect(await first).toMatchObject({ hero: { title: "https://a.invalid" } });
  });

  it("a read outside a render the platform wired fails, and nothing is fetched", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const error = await morph.pages.get("/").catch((caught) => caught);

    expect(error).toBeInstanceOf(MorphError);
    expect((error as MorphError).code).toBe("no_content_source");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a render whose request carries no content source fails, and never falls back", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const error = await render({}, () => morph.pages.get("/")).catch(
      (caught) => caught,
    );

    expect((error as MorphError).code).toBe("no_content_source");
    expect(fetch).not.toHaveBeenCalled();
    expect(() =>
      contentOriginFor(new Request("https://theme.invalid/")),
    ).toThrow(MorphError);
  });
});
