// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Start's `getRequest()` is request-scoped through AsyncLocalStorage. The
 * stand-in here is the same mechanism, so two requests served at once each
 * see their own request, as they do in Start.
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

import { MorphError, contentOriginFor, morph, morphForRequest } from "./index";

const requests = new AsyncLocalStorage<Request>();
scope.current = requests;

function serve<T>(headers: Record<string, string>, run: () => Promise<T>) {
  return requests.run(new Request("https://theme.invalid/", { headers }), run);
}

const page = (title: string) =>
  new Response(
    JSON.stringify({ slots: { hero: { title } }, hiddenSlots: [] }),
    {
      headers: { "content-type": "application/json" },
    },
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
  vi.unstubAllEnvs();
});

describe("@morph/sdk/start: the platform names each request's source", () => {
  it("reads each request's own origin when two are served at once", async () => {
    const service = contentService();
    vi.stubGlobal("fetch", service.fetch);

    // A starts first and is still waiting on its read when B is served
    // completely; then A reads a second time, after B.
    const a = serve(
      { "x-morph-content-origin": "https://published.example" },
      async () => {
        const first = await morph.pages.get("/");
        const second = await morph.pages.get("/about");
        return [first.hero.title, second.hero.title];
      },
    );
    const b = serve(
      { "x-morph-content-origin": "http://morph-preview-content.invalid" },
      async () => (await morph.pages.get("/")).hero.title,
    );

    await service.release("https://published.example");
    await service.release("http://morph-preview-content.invalid");
    await expect(b).resolves.toBe("http://morph-preview-content.invalid");
    await service.release("https://published.example");

    await expect(a).resolves.toEqual([
      "https://published.example",
      "https://published.example",
    ]);
    expect(service.seen).toEqual([
      "https://published.example/_morph/content?path=%2F",
      "http://morph-preview-content.invalid/_morph/content?path=%2F",
      "https://published.example/_morph/content?path=%2Fabout",
    ]);
  });

  it("creates a reader per call rather than keeping one", async () => {
    const first = await serve(
      { "x-morph-content-origin": "https://one.example" },
      async () => morphForRequest(),
    );
    const second = await serve(
      { "x-morph-content-origin": "https://one.example" },
      async () => morphForRequest(),
    );
    expect(first).not.toBe(second);
  });

  it("fails with no_content_source when the platform names none, and reads nothing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "");

    const read = serve({}, () => morph.pages.get("/"));
    await expect(read).rejects.toBeInstanceOf(MorphError);
    await expect(read).rejects.toMatchObject({ code: "no_content_source" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never falls back to default content when a source is missing or refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );
    await expect(
      serve({ "x-morph-content-origin": "https://shop.example" }, () =>
        morph.pages.get("/"),
      ),
    ).rejects.toMatchObject({ code: "content_not_found" });
  });

  it("uses MORPH_CONTENT_ORIGIN only while developing, and only with no header", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      page(new URL(String(input)).origin),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://local-store.example");

    // Vitest serves this file as a dev server would: `import.meta.env.DEV`.
    await expect(
      serve({}, async () => (await morph.pages.get("/")).hero.title),
    ).resolves.toBe("https://local-store.example");
    // The header wins over the local address.
    await expect(
      serve(
        { "x-morph-content-origin": "https://platform.example" },
        async () => (await morph.pages.get("/")).hero.title,
      ),
    ).resolves.toBe("https://platform.example");

    // A build: Vite replaces `import.meta.env.DEV` with `false`, which Vitest
    // cannot stub after the fact, so the build's value is passed in.
    expect(() =>
      contentOriginFor(new Request("https://theme.invalid/"), false),
    ).toThrow(expect.objectContaining({ code: "no_content_source" }));
  });

  it("refuses an unusable header rather than falling through to the local address", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://local-store.example");

    await expect(
      serve({ "x-morph-content-origin": "not an address" }, () =>
        morph.pages.get("/"),
      ),
    ).rejects.toMatchObject({ code: "invalid_content_origin" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the header the request carries, and nothing else", () => {
    expect(
      contentOriginFor(
        new Request("https://theme.invalid/", {
          headers: { "x-morph-content-origin": "https://named.example" },
        }),
      ),
    ).toBe("https://named.example");
  });
});
