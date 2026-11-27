// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMorph, MorphError, type MorphFetch } from "./index";
import { createMorphReader } from "./client";

/**
 * The scoped reads: `layouts.get("default")` and
 * `pages.get(path, { scope: "page" })`, beside the unchanged merged read.
 * The wire format is the server's (`storefront-content-read.ts`).
 */
const BASE = "https://shop.example.com";

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: MorphFetch = async (url, init) => {
    calls.push({ url, init });
    return answer(new URL(url));
  };
  return { fetch, calls };
}

async function failure(promise: Promise<unknown>): Promise<MorphError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MorphError);
    return error as MorphError;
  }
  throw new Error("expected a MorphError");
}

/** A server that answers each read as Core does, from one layout and page. */
function core(url: URL): Response {
  const scope = url.searchParams.get("scope");
  const layout = {
    slots: { header: { title: "Shop" } },
    hiddenSlots: ["announcement"],
  };
  const page = { slots: { hero: { heading: "Hi" } }, hiddenSlots: [] };
  if (scope === "layout") return json({ scope, layout: "default", ...layout });
  if (scope === "page") return json({ scope, ...page });
  return json({
    slots: { ...layout.slots, ...page.slots },
    hiddenSlots: layout.hiddenSlots,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layouts.get", () => {
  it("reads the shared layout alone, and isHidden reads its hidden sections", async () => {
    const { fetch, calls } = fakeFetch(core);
    const morph = createMorph({ baseUrl: BASE, fetch });

    const layout = await morph.layouts.get("default");

    expect(layout).toEqual({
      header: { title: "Shop" },
      _hidden: ["announcement"],
    });
    // Hidden: named, never carrying values.
    expect(morph.layouts.isHidden(layout, "announcement")).toBe(true);
    expect(layout.announcement).toBeUndefined();
    expect(morph.layouts.isHidden(layout, "header")).toBe(false);
    expect(morph.pages.isHidden(layout, "announcement")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      BASE + "/_morph/content?scope=layout&layout=default",
    );
    expect(calls[0]!.init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "manual",
    });
  });

  it("refuses any other layout name before sending anything", async () => {
    const { fetch, calls } = fakeFetch(core);
    const morph = createMorph({ baseUrl: BASE, fetch });
    for (const name of ["main", "", "Default", undefined, null, 1]) {
      const error = await failure(morph.layouts.get(name as never));
      expect(error).toMatchObject({ code: "invalid_request", resource: "page" });
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses to read in a browser, before sending anything", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const { fetch, calls } = fakeFetch(core);
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).layouts.get("default"),
    );
    expect(error).toMatchObject({
      code: "invalid_content_origin",
      resource: "page",
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [
      "an old source that ignores the scope and answers merged content",
      { slots: { header: {} }, hiddenSlots: [] },
    ],
    [
      "an answer for the page scope",
      { scope: "page", slots: {}, hiddenSlots: [] },
    ],
    [
      "an answer naming another layout",
      { scope: "layout", layout: "other", slots: {}, hiddenSlots: [] },
    ],
    [
      "an answer naming no layout",
      { scope: "layout", slots: {}, hiddenSlots: [] },
    ],
  ])("refuses %s, never reading it as the layout", async (_, body) => {
    const { fetch } = fakeFetch(() => json(body));
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).layouts.get("default"),
    );
    expect(error).toMatchObject({
      code: "invalid_response",
      resource: "page",
      status: 200,
    });
  });

  it("fails with the page read's errors", async () => {
    const notFound = fakeFetch(() => new Response("no store", { status: 404 }));
    expect(
      await failure(
        createMorph({ baseUrl: BASE, fetch: notFound.fetch }).layouts.get(
          "default",
        ),
      ),
    ).toMatchObject({ code: "content_not_found", resource: "page" });
    const broken = fakeFetch(() => json({ error: "x" }, 500));
    expect(
      await failure(
        createMorph({ baseUrl: BASE, fetch: broken.fetch }).layouts.get(
          "default",
        ),
      ),
    ).toMatchObject({ code: "store_error", resource: "page", status: 500 });
    const reserved = fakeFetch(() =>
      json({
        scope: "layout",
        layout: "default",
        slots: { _hidden: {} },
        hiddenSlots: [],
      }),
    );
    expect(
      await failure(
        createMorph({ baseUrl: BASE, fetch: reserved.fetch }).layouts.get(
          "default",
        ),
      ),
    ).toMatchObject({ code: "reserved_slot", resource: "page" });
  });

  it("makes media absolute from createMorph and leaves it relative from a hosted reader", async () => {
    const media = "/_storefront-media/abc";
    const answer = () =>
      json({
        scope: "layout",
        layout: "default",
        slots: { header: { logo: media } },
        hiddenSlots: [],
      });
    const external = await createMorph({
      baseUrl: BASE,
      fetch: fakeFetch(answer).fetch,
    }).layouts.get("default");
    expect(external.header.logo).toBe(BASE + media);
    const hosted = await createMorphReader(
      { baseUrl: BASE, fetch: fakeFetch(answer).fetch },
      { mediaUrls: "relative" },
    ).layouts.get("default");
    expect(hosted.header.logo).toBe(media);
  });

  it("sends a hosted reader's render context, as a page read does", async () => {
    const { fetch, calls } = fakeFetch(core);
    const reader = createMorphReader(
      { baseUrl: BASE, fetch },
      { mediaUrls: "relative", renderContext: "ctx-1" },
    );
    await reader.layouts.get("default");
    await reader.pages.get("/", { scope: "page" });
    await reader.pages.get("/");
    for (const call of calls) {
      expect(new Headers(call.init.headers).get("x-morph-render-context")).toBe(
        "ctx-1",
      );
    }
    // createMorph never does.
    const external = fakeFetch(core);
    await createMorph({ baseUrl: BASE, fetch: external.fetch }).layouts.get(
      "default",
    );
    expect(
      new Headers(external.calls[0]!.init.headers).get(
        "x-morph-render-context",
      ),
    ).toBeNull();
  });
});

describe("pages.get with { scope: \"page\" }", () => {
  it("reads the page's own sections only", async () => {
    const { fetch, calls } = fakeFetch(core);
    const morph = createMorph({ baseUrl: BASE, fetch });

    const page = await morph.pages.get("/pages/about us", { scope: "page" });

    expect(page).toEqual({ hero: { heading: "Hi" }, _hidden: [] });
    expect(calls[0]!.url).toBe(
      BASE + "/_morph/content?path=%2Fpages%2Fabout%20us&scope=page",
    );
  });

  it("keeps the merged read's address and answer exactly as before", async () => {
    const { fetch, calls } = fakeFetch(core);
    const morph = createMorph({ baseUrl: BASE, fetch });

    const merged = await morph.pages.get("/");
    const explicit = await morph.pages.get("/", {});
    const undefinedScope = await morph.pages.get("/", { scope: undefined });

    const expected = {
      header: { title: "Shop" },
      hero: { heading: "Hi" },
      _hidden: ["announcement"],
    };
    expect(merged).toEqual(expected);
    expect(explicit).toEqual(expected);
    expect(undefinedScope).toEqual(expected);
    expect(calls.map((call) => call.url)).toEqual([
      BASE + "/_morph/content?path=%2F",
      BASE + "/_morph/content?path=%2F",
      BASE + "/_morph/content?path=%2F",
    ]);
  });

  it("splits the merged read into layout and page reads with the same keys", async () => {
    const { fetch } = fakeFetch(core);
    const morph = createMorph({ baseUrl: BASE, fetch });
    const [merged, layout, own] = await Promise.all([
      morph.pages.get("/"),
      morph.layouts.get("default"),
      morph.pages.get("/", { scope: "page" }),
    ]);
    const { _hidden: _m, ...mergedSlots } = merged;
    const { _hidden: _l, ...layoutSlots } = layout;
    const { _hidden: _p, ...pageSlots } = own;
    expect(mergedSlots).toEqual({ ...layoutSlots, ...pageSlots });
  });

  it.each([
    ["an unknown scope", { scope: "layout" }],
    ["merged named as a scope", { scope: "merged" }],
    ["an unknown option", { scope: "page", draft: true }],
    ["a non-object", "page"],
    ["null", null],
  ])("refuses %s before sending anything", async (_, options) => {
    const { fetch, calls } = fakeFetch(core);
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("/", options as never),
    );
    expect(error).toMatchObject({ code: "invalid_request", resource: "page" });
    expect(calls).toHaveLength(0);
  });

  it("checks the path first, as the merged read does", async () => {
    const { fetch } = fakeFetch(core);
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("about", {
        scope: "page",
      }),
    );
    expect(error).toMatchObject({ code: "invalid_path", resource: "page" });
  });

  it.each([
    [
      "an old source that ignores the scope and answers merged content",
      { slots: { header: {}, hero: {} }, hiddenSlots: [] },
    ],
    [
      "an answer for the layout scope",
      { scope: "layout", layout: "default", slots: {}, hiddenSlots: [] },
    ],
  ])("refuses %s, never reading it as page-only", async (_, body) => {
    const { fetch } = fakeFetch(() => json(body));
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("/", { scope: "page" }),
    );
    expect(error).toMatchObject({ code: "invalid_response", resource: "page" });
  });

  it("keeps accepting the legacy answer, which names no scope", async () => {
    // The legacy read never asks for a scope, so it does not check one: an
    // answer it accepted before is accepted now.
    const { fetch } = fakeFetch(() =>
      json({ slots: { hero: {} }, hiddenSlots: [] }),
    );
    expect(await createMorph({ baseUrl: BASE, fetch }).pages.get("/")).toEqual(
      { hero: {}, _hidden: [] },
    );
  });
});
