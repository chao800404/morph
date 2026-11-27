// @vitest-environment node
/**
 * The SDK's scoped reads (`layouts.get("default", { path })`,
 * `pages.get(path, { scope: "page" })`) through every content resolver:
 *
 * - public: `StorefrontProductionService` (`/_morph/content` on the merchant
 *   host), read by the real SDK, on the pinned or active publication, across
 *   publish and rollback;
 * - Build Preview: `serveBuildPreviewContent`;
 * - Live Preview: the snapshot Core writes (`createThemePreviewContentSnapshot`)
 *   answered by the resolver the preview Worker, dev server and in-page
 *   fetch shim embed, live edits included;
 * - prerender: the sealed content of a native and a platform build
 *   (`createNativePrerenderContent`, `createThemePrerenderContent`) answered
 *   by the generated content server and `answerSealedScopedRead`.
 *
 * Each answers the same Documents with the same body, both scoped reads are
 * cut from the same path's merged read (one slot namespace), and the legacy
 * merged read is byte for byte what it was.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createMorph,
  MorphError,
} from "../../../../packages/morph-sdk/src/index";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import {
  answerSealedScopedRead,
  createNativePrerenderContent,
  createThemePrerenderContent,
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  themePrerenderContentPluginSource,
} from "../compiler/theme-prerender-content";
import {
  createThemePreviewContentSnapshot,
  themePreviewContentModuleSource,
  themePreviewContentPluginSource,
  type ThemePreviewContentSnapshot,
} from "../compiler/theme-preview-content";
import {
  buildStorefrontContent,
  buildStorefrontScopedContent,
  resolveStorefrontContent,
  type ContentRuntimePorts,
  type PublishedDocument,
} from "./storefront-content-runtime";
import {
  storefrontContentScopedBody,
  storefrontContentScopedRead,
  storefrontScopedContent,
} from "./storefront-content-read";
import { collectVisitorMediaKeys } from "./published-media-authorization";
import { serveBuildPreviewContent } from "./build-preview/build-preview-content";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";
import { StorefrontProductionService } from "./storefront-production.service";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const HOST = "shop.example.com";
const BASE = `https://${HOST}`;

type Doc = StorefrontPageDocument;
const section = (
  id: string,
  props: Record<string, unknown>,
  enabled = true,
) => ({ id, type: id, enabled, props });

/**
 * One publication's Documents: the shared layout and the home page. The
 * home page hides the layout's `footer` (one slot namespace): hidden on `/`
 * in every read, shown on a page with no Document of its own.
 */
function documents(tag: string) {
  const layout = {
    version: 1,
    sections: [
      section("header", { title: `Shop ${tag}` }),
      section("footer", { note: `Footer ${tag}` }),
      // Hidden in the layout: never in any read's output.
      section("announcement", { text: `Hidden sale ${tag}` }, false),
    ],
  } as unknown as Doc;
  const index = {
    version: 1,
    sections: [
      section("hero", { heading: `Home ${tag}` }),
      section("newsletter", { title: "x" }, false),
      section("footer", { note: `Page footer ${tag}` }, false),
    ],
  } as unknown as Doc;
  return { layout, index };
}

const PUBLICATIONS = { pub_a: documents("A"), pub_b: documents("B") } as const;
type PublicationId = keyof typeof PUBLICATIONS;

const contentPorts: ContentRuntimePorts = {
  getPublishedDocument: async ({ publicationId, templateType }) => {
    const docs = PUBLICATIONS[publicationId as PublicationId];
    if (!docs) return null;
    if (templateType === "layout") return docs.layout as PublishedDocument;
    if (templateType === "index") return docs.index as PublishedDocument;
    return null;
  },
};

const QUERIES = {
  merged: "path=%2F",
  page: "path=%2F&scope=page",
  layout: "scope=layout&layout=default&path=%2F",
  contactPage: "path=%2Fcontact&scope=page",
  contactLayout: "scope=layout&layout=default&path=%2Fcontact",
  contactMerged: "path=%2Fcontact",
} as const;

/** What each read must answer for one publication. */
function expected(id: PublicationId) {
  const { layout, index } = PUBLICATIONS[id];
  const L = layout as PublishedDocument;
  const D = index as PublishedDocument;
  return {
    merged: buildStorefrontContent(L, D),
    page: { scope: "page", ...buildStorefrontScopedContent("page", L, D) },
    layout: {
      scope: "layout",
      layout: "default",
      ...buildStorefrontScopedContent("layout", L, D),
    },
    contactMerged: buildStorefrontContent(L, null),
    contactPage: {
      scope: "page",
      ...buildStorefrontScopedContent("page", L, null),
    },
    contactLayout: {
      scope: "layout",
      layout: "default",
      ...buildStorefrontScopedContent("layout", L, null),
    },
  };
}

function resolverDeps(active: () => PublicationId): StorefrontHostResolverDeps {
  return {
    domainDal: {
      findByHostname: async () => ({
        id: "dom_1",
        storefrontId: "sf_1",
        hostname: HOST,
        status: "active",
      }),
    },
    storefrontDalRef: {
      findActive: async () => ({ id: "sf_1", status: "published" }),
    },
    releaseDal: {
      getActive: async () => ({
        id: `rel_${active()}`,
        themeId: "th_1",
        sourceRevisionId: "rev_1",
        themeBuildId: "bld_1",
        contentPublicationId: active(),
      }),
    },
    buildDal: {
      getBuildById: async () => ({
        id: "bld_1",
        storefrontId: "sf_1",
        themeId: "th_1",
        status: "succeeded",
        artifactPrefix: "themes/th_1/builds/bld_1",
        manifestJson: { artifactEntry: "preview/index.html", files: [] },
      }),
    },
  } as unknown as StorefrontHostResolverDeps;
}

function publicSite() {
  let active: PublicationId = "pub_a";
  const service = new StorefrontProductionService({
    runtime: { kind: "local-direct", handle: vi.fn() } as never,
    resolverDeps: resolverDeps(() => active),
    contentPorts,
  });
  const raw = async (query: string) => {
    const response = await service.handleRequest(
      new Request(`${BASE}/_morph/content${query}`),
    );
    return {
      status: response.status,
      text: await response.text(),
      etag: response.headers.get("etag"),
      cache: response.headers.get("cache-control"),
    };
  };
  const morph = createMorph({
    baseUrl: BASE,
    fetch: (input, init) => service.handleRequest(new Request(input, init)),
  });
  return {
    raw,
    morph,
    activate(id: PublicationId) {
      active = id;
    },
  };
}

/** `MorphPage` back to the wire's `{ slots, hiddenSlots }`. */
function wire(page: Record<string, unknown> & { _hidden: readonly string[] }) {
  const { _hidden, ...slots } = page;
  return { slots, hiddenSlots: [..._hidden] };
}

describe("the scoped read query: one path rule for every reader (P2-6)", () => {
  it.each([
    ["?path=/", null],
    ["?path=/about&scope=page", { scope: "page", path: "/about" }],
    ["?path=/about/&scope=page", { scope: "page", path: "/about" }],
    ["?path=/about//&scope=page", { scope: "page", path: "/about" }],
    ["?path=/&scope=page", { scope: "page", path: "/" }],
    [
      `?path=${encodeURIComponent("/關於/")}&scope=page`,
      // One canonical key: the URL pathname spelling.
      { scope: "page", path: encodeURI("/關於") },
    ],
    [
      "?scope=layout&layout=default&path=/about/",
      { scope: "layout", layout: "default", path: "/about" },
    ],
    ["?scope=merged&path=/", "invalid"],
    ["?scope=page", "invalid"],
    ["?scope=page&path=about", "invalid"],
    [`?scope=page&path=/${"a".repeat(500)}`, "invalid"],
    ["?scope=page&path=/&path=/x", "invalid"],
    ["?scope=page&path=/&layout=default", "invalid"],
    ["?scope=page&scope=page&path=/", "invalid"],
    // Malformed percent-encoding in the decoded path: refused, not thrown.
    [`?scope=page&path=${encodeURIComponent("/pages/%ZZ")}`, "invalid"],
    [
      `?scope=layout&layout=default&path=${encodeURIComponent("/pages/%E0%A4%A")}`,
      "invalid",
    ],
    ["?scope=layout&layout=default", "invalid"],
    ["?scope=layout&path=/", "invalid"],
    ["?scope=layout&layout=main&path=/", "invalid"],
  ])("%s", (query, read) => {
    expect(storefrontContentScopedRead(new URLSearchParams(query))).toEqual(
      read,
    );
  });
});

describe("scoped content: cut from the same path's merged read", () => {
  it("splits the merged read into the layout's and the page's own sections", async () => {
    const read = (scope?: "page" | "layout") =>
      resolveStorefrontContent({
        publicationId: "pub_a",
        pathname: "/",
        ports: contentPorts,
        ...(scope ? { scope } : {}),
      });
    const [merged, layout, own] = [
      await read(),
      await read("layout"),
      await read("page"),
    ];
    expect(own).toEqual({
      slots: { hero: { heading: "Home A" } },
      hiddenSlots: merged.hiddenSlots,
    });
    expect(layout).toEqual({
      slots: { header: { title: "Shop A" } },
      // Every id the merged read hides on this page: the page hides the
      // layout's footer here (P1-1).
      hiddenSlots: merged.hiddenSlots,
    });
    expect(merged.hiddenSlots).toEqual(["announcement", "newsletter", "footer"]);
    expect(merged.slots).toEqual({ ...layout.slots, ...own.slots });
    for (const result of [merged, layout, own]) {
      expect(JSON.stringify(result)).not.toContain("Hidden sale");
      expect(JSON.stringify(result)).not.toContain("Footer A");
    }
  });

  it("a page hiding a layout section hides it in the layout read of that page only (P1-1)", () => {
    const { layout, index } = PUBLICATIONS.pub_a;
    const onHome = buildStorefrontScopedContent(
      "layout",
      layout as PublishedDocument,
      index as PublishedDocument,
    );
    const elsewhere = buildStorefrontScopedContent(
      "layout",
      layout as PublishedDocument,
      null,
    );
    expect(onHome.slots).not.toHaveProperty("footer");
    expect(onHome.hiddenSlots).toContain("footer");
    expect(elsewhere.slots.footer).toEqual({ note: "Footer A" });
    expect(elsewhere.hiddenSlots).not.toContain("footer");
  });

  it("a page showing its own section under a layout id: both reads carry the value the page renders", () => {
    const layout = {
      sections: [{ id: "header", enabled: true, props: { title: "Shell" } }],
    } satisfies PublishedDocument;
    const page = {
      sections: [{ id: "header", enabled: true, props: { title: "Own" } }],
    } satisfies PublishedDocument;
    expect(buildStorefrontContent(layout, page).slots).toEqual({
      header: { title: "Own" },
    });
    expect(buildStorefrontScopedContent("page", layout, page).slots).toEqual({
      header: { title: "Own" },
    });
    expect(buildStorefrontScopedContent("layout", layout, page).slots).toEqual(
      { header: { title: "Own" } },
    );
  });

  it("hides, in the layout read, a slot the layout renders from defaults when the page hides it (round 2)", () => {
    // The layout Document never declares `promo`; its component renders the
    // defaults. The page hides `promo`: the merged read hides it, so must the
    // layout read the layout component reads.
    const layout = {
      sections: [{ id: "header", enabled: true, props: { title: "Shell" } }],
    } satisfies PublishedDocument;
    const page = {
      sections: [{ id: "promo", enabled: false, props: {} }],
    } satisfies PublishedDocument;
    expect(buildStorefrontContent(layout, page).hiddenSlots).toEqual(["promo"]);
    expect(
      buildStorefrontScopedContent("layout", layout, page).hiddenSlots,
    ).toEqual(["promo"]);
  });

  it("reads one canonical path key: decoded and encoded spellings name one route (round 2)", async () => {
    const encoded = encodeURI("/關於");
    const route = {
      sections: [{ id: "footer", enabled: false, props: {} }],
    } satisfies PublishedDocument;
    const ports: ContentRuntimePorts = {
      getPublishedDocument: async ({ templateType }) =>
        templateType === "layout"
          ? (PUBLICATIONS.pub_a.layout as PublishedDocument)
          : null,
      // Keyed as the Astro route registry keys it: the URL pathname spelling.
      getPublishedRouteDocument: async ({ routePath }) =>
        routePath === encoded ? route : null,
    };
    const answers = [];
    for (const spelling of ["/關於", encoded, "/關於/", encoded + "/"]) {
      const read = storefrontContentScopedRead(
        new URLSearchParams({
          scope: "layout",
          layout: "default",
          path: spelling,
        }),
      );
      expect(read).toEqual({ scope: "layout", layout: "default", path: encoded });
      answers.push(
        await resolveStorefrontContent({
          publicationId: "p",
          pathname: (read as { path: string }).path,
          ports,
          scope: "layout",
        }),
      );
    }
    for (const answer of answers) {
      // The route's hide holds for every spelling.
      expect(answer.hiddenSlots).toContain("footer");
      expect(answer.slots).not.toHaveProperty("footer");
    }
  });

  it("never emits what the merged read hides, so media authorisation covers it unchanged", () => {
    const asset = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const layout = {
      sections: [{ id: "hero", enabled: false, props: {} }],
    } satisfies PublishedDocument;
    const page = {
      sections: [
        {
          id: "hero",
          enabled: true,
          props: { image: `/_storefront-media/${asset}?version=v1` },
        },
      ],
    } satisfies PublishedDocument;
    for (const scope of ["page", "layout"] as const) {
      expect(buildStorefrontScopedContent(scope, layout, page)).toEqual({
        slots: {},
        hiddenSlots: ["hero"],
      });
    }
    const keys = collectVisitorMediaKeys({
      layoutDocument: layout,
      documents: [page],
      known: new Map([[asset, new Set(["v1"])]]),
    });
    expect(keys.has(asset)).toBe(false);
  });
});

describe("public /_morph/content", () => {
  it("answers the legacy merged read byte for byte as before, with the same tag and cache policy", async () => {
    const site = publicSite();
    const answer = await site.raw("?" + QUERIES.merged);
    expect(answer.status).toBe(200);
    expect(answer.text).toBe(JSON.stringify(expected("pub_a").merged));
    expect(answer.etag).toBe('"rel_pub_a:/"');
    expect(answer.cache).toBe("public, max-age=60, must-revalidate");
    expect(JSON.parse(answer.text)).not.toHaveProperty("scope");
  });

  it("answers each scoped read naming its scope, with its own tag and the legacy cache policy (P2-7)", async () => {
    const site = publicSite();
    const layout = await site.raw("?" + QUERIES.layout);
    expect(JSON.parse(layout.text)).toEqual(expected("pub_a").layout);
    expect(layout.etag).toBe('"rel_pub_a:layout:default:/"');
    const page = await site.raw("?" + QUERIES.page);
    expect(JSON.parse(page.text)).toEqual(expected("pub_a").page);
    expect(page.etag).toBe('"rel_pub_a:page:/"');
    // The same window as the merged read: no new cache policy.
    for (const answer of [layout, page]) {
      expect(answer.cache).toBe("public, max-age=60, must-revalidate");
    }
    expect(JSON.parse((await site.raw("?" + QUERIES.contactLayout)).text)).toEqual(
      expected("pub_a").contactLayout,
    );
  });

  it("keys a scoped read by the normalised path, with an ASCII tag for any path (P2-6)", async () => {
    const site = publicSite();
    const slash = await site.raw("?path=%2F%2F&scope=page");
    expect(JSON.parse(slash.text)).toEqual(expected("pub_a").page);
    const unicode = await site.raw(
      `?path=${encodeURIComponent("/關於/")}&scope=page`,
    );
    expect(unicode.status).toBe(200);
    expect(unicode.etag).toBe(
      `"rel_pub_a:page:${encodeURI("/關於")}"`,
    );
  });

  it.each([
    "?scope=unknown&path=/",
    "?scope=layout&layout=main&path=/",
    "?scope=layout&layout=default",
    "?scope=page",
    `?scope=page&path=${encodeURIComponent("/pages/%ZZ")}`,
  ])("refuses an unusable scoped read with 400, never a throw: %s", async (query) => {
    const answer = await publicSite().raw(query);
    expect(answer.status).toBe(400);
    // As the endpoint's other refusals ("Invalid content path."): plain text.
    expect(answer.text).toContain("Invalid content read.");
  });

  it("serves the SDK the same content across publish and rollback, page and layout from one publication", async () => {
    const site = publicSite();
    const readAll = async () => ({
      merged: wire(await site.morph.pages.get("/")),
      layout: wire(await site.morph.layouts.get("default", { path: "/" })),
      page: wire(await site.morph.pages.get("/", { scope: "page" })),
    });
    const strip = ({ scope: _s, layout: _l, ...rest }: Record<string, unknown>) =>
      rest;
    const forPublication = (id: PublicationId) => ({
      merged: expected(id).merged,
      layout: strip(expected(id).layout),
      page: strip(expected(id).page),
    });

    expect(await readAll()).toEqual(forPublication("pub_a"));
    site.activate("pub_b"); // publish
    expect(await readAll()).toEqual(forPublication("pub_b"));
    site.activate("pub_a"); // rollback
    expect(await readAll()).toEqual(forPublication("pub_a"));

    const layout = await site.morph.layouts.get("default", { path: "/" });
    expect(site.morph.layouts.isHidden(layout, "announcement")).toBe(true);
    expect(site.morph.layouts.isHidden(layout, "footer")).toBe(true);
    const contact = await site.morph.layouts.get("default", {
      path: "/contact",
    });
    expect(site.morph.layouts.isHidden(contact, "footer")).toBe(false);
  });
});

describe("Build Preview /_morph/content", () => {
  const serve = (query: string, method = "GET") =>
    serveBuildPreviewContent({
      request: new Request(`https://preview.invalid/_morph/content${query}`, {
        method,
      }),
      capability: { contentPublicationId: "pub_b" } as never,
      ports: contentPorts,
    });

  it("answers the build's publication with the public endpoint's bodies", async () => {
    const want = expected("pub_b");
    expect(await (await serve("?" + QUERIES.merged)).text()).toBe(
      JSON.stringify(want.merged),
    );
    expect(await (await serve("?" + QUERIES.layout)).json()).toEqual(
      want.layout,
    );
    expect(await (await serve("?" + QUERIES.page)).json()).toEqual(want.page);
    expect(await (await serve("?path=%2F%2F&scope=page")).json()).toEqual(
      want.page,
    );
    expect((await serve("?scope=layout&layout=default")).status).toBe(400);
    expect(
      (await serve(`?scope=page&path=${encodeURIComponent("/pages/%ZZ")}`))
        .status,
    ).toBe(400);
    expect((await serve("?" + QUERIES.layout, "HEAD")).status).toBe(200);
  });
});

/** The resolver the preview embeds, over one snapshot, with its live edits. */
function previewPage(snapshot: unknown) {
  const source = themePreviewContentModuleSource();
  const body = source
    .slice(
      source.indexOf("function templateTypeForPath"),
      source.indexOf("// Below `updatePreviewContent`"),
    )
    .replace(
      "export function previewContentForPath",
      "function previewContentForPath",
    )
    .replace(
      "export function updatePreviewContent",
      "function updatePreviewContent",
    );
  // As the page holds it: edits apply to the current path's content.
  return new Function(
    "snapshot",
    `let current = "/";
    function currentPreviewContent() { return previewContentForPath(current); }
    ${body};
    return {
      read: previewContentForQuery,
      edit: updatePreviewContent,
      at(path) { current = path; },
    };`,
  )(JSON.parse(JSON.stringify(snapshot))) as {
    read(params: URLSearchParams): unknown;
    edit(
      sectionId: string,
      props?: Record<string, unknown>,
      enabled?: boolean,
    ): boolean;
    at(path: string): void;
  };
}

const previewRead = (snapshot: unknown) => {
  const page = previewPage(snapshot);
  return (params: URLSearchParams) => page.read(params);
};

async function previewSnapshot(id: PublicationId) {
  const { layout, index } = PUBLICATIONS[id];
  return createThemePreviewContentSnapshot({
    templates: [
      { type: "layout", document: layout },
      { type: "index", document: index },
    ],
  });
}

describe("Live Preview: the confirmed snapshot", () => {
  it("answers every read with the public endpoint's body for the same Documents", async () => {
    const read = previewRead(await previewSnapshot("pub_a"));
    const want = expected("pub_a");
    for (const key of Object.keys(QUERIES) as (keyof typeof QUERIES)[]) {
      expect(
        JSON.stringify(read(new URLSearchParams(QUERIES[key]))),
        key,
      ).toBe(JSON.stringify(want[key]));
    }
    expect(read(new URLSearchParams("scope=layout&layout=default"))).toBeNull();
  });

  it("refuses a scoped read of a snapshot written before scoped reads, and still answers its merged reads", async () => {
    const { scopedIds: _ids, ...old } = (await previewSnapshot(
      "pub_a",
    )) as ThemePreviewContentSnapshot;
    const read = previewRead(old);
    expect(read(new URLSearchParams(QUERIES.merged))).toEqual(
      expected("pub_a").merged,
    );
    expect(read(new URLSearchParams(QUERIES.layout))).toBeNull();
    expect(read(new URLSearchParams(QUERIES.page))).toBeNull();
  });

  it("reads back a hide and a value edit the page applied, in both scopes (P1-3)", async () => {
    const page = previewPage(await previewSnapshot("pub_a"));
    page.at("/");
    page.edit("hero", undefined, false); // hide a page section
    page.edit("header", undefined, false); // hide a layout section on this page
    page.at("/contact");
    page.edit("footer", { note: "Edited footer" });

    const own = page.read(new URLSearchParams(QUERIES.page)) as {
      slots: Record<string, unknown>;
      hiddenSlots: string[];
    };
    expect(own.slots).not.toHaveProperty("hero");
    expect(own.hiddenSlots).toContain("hero");
    const layout = page.read(new URLSearchParams(QUERIES.layout)) as {
      slots: Record<string, unknown>;
      hiddenSlots: string[];
    };
    expect(layout.slots).not.toHaveProperty("header");
    expect(layout.hiddenSlots).toContain("header");
    const contact = page.read(new URLSearchParams(QUERIES.contactLayout)) as {
      slots: Record<string, unknown>;
    };
    expect(contact.slots.footer).toEqual({ note: "Edited footer" });
  });

  it("keeps an unsaved edit on the path it was made on: no bleed through a shared template (round 2)", async () => {
    const generic = {
      version: 1,
      sections: [section("page-hero", { heading: "Generic" })],
    } as unknown as Doc;
    const snapshot = await createThemePreviewContentSnapshot({
      templates: [
        { type: "layout", document: PUBLICATIONS.pub_a.layout },
        { type: "page", document: generic },
      ],
    });
    const page = previewPage(snapshot);
    page.at("/pages/a");
    page.edit("header", { title: "Unsaved on a" });
    page.edit("page-hero", { heading: "Unsaved on a" });
    const read = (query: string) =>
      page.read(new URLSearchParams(query)) as {
        slots: Record<string, { title?: string; heading?: string }>;
      };
    expect(read("path=/pages/a").slots.header?.title).toBe("Unsaved on a");
    expect(
      read("scope=layout&layout=default&path=/pages/a").slots.header?.title,
    ).toBe("Unsaved on a");
    for (const query of [
      "path=/pages/b",
      "path=/pages/b&scope=page",
      "scope=layout&layout=default&path=/pages/b",
    ]) {
      const slots = read(query).slots;
      expect(slots.header?.title ?? "Shop A", query).toBe("Shop A");
      expect(slots["page-hero"]?.heading ?? "Generic", query).toBe("Generic");
    }
  });

  it("reads back an edit of an id both Documents declare in both scopes, never a stale layout value (round 2)", async () => {
    const index = {
      version: 1,
      sections: [section("header", { title: "Page header" })],
    } as unknown as Doc;
    const page = previewPage(
      await createThemePreviewContentSnapshot({
        templates: [
          { type: "layout", document: PUBLICATIONS.pub_a.layout },
          { type: "index", document: index },
        ],
      }),
    );
    page.at("/");
    page.edit("header", { title: "Edited" });
    for (const query of [QUERIES.merged, QUERIES.page, QUERIES.layout]) {
      expect(
        (page.read(new URLSearchParams(query)) as {
          slots: Record<string, { title: string }>;
        }).slots.header,
        query,
      ).toEqual({ title: "Edited" });
    }
  });

  it("answers decoded and encoded spellings of a route from one entry (round 2)", async () => {
    const encoded = encodeURI("/關於");
    const snapshot = await createThemePreviewContentSnapshot({
      templates: [
        { type: "layout", document: PUBLICATIONS.pub_a.layout },
        {
          type: "page",
          routePath: encoded,
          document: {
            version: 1,
            sections: [section("footer", { note: "x" }, false)],
          } as unknown as Doc,
        },
      ],
    });
    const read = previewRead(snapshot);
    const decodedAnswer = read(
      new URLSearchParams({ scope: "layout", layout: "default", path: "/關於" }),
    );
    const encodedAnswer = read(
      new URLSearchParams({ scope: "layout", layout: "default", path: encoded }),
    );
    expect(decodedAnswer).toEqual(encodedAnswer);
    expect((decodedAnswer as { hiddenSlots: string[] }).hiddenSlots).toContain(
      "footer",
    );
  });

  it("never answers a Page without a Document from the CMS Page `preview` (P1-2)", async () => {
    const generic = {
      version: 1,
      sections: [section("page-hero", { heading: "Generic" })],
    } as unknown as Doc;
    const previewPageDoc = {
      version: 1,
      sections: [
        section("page-hero", { heading: "Draft of /pages/preview" }),
        section("secret", { text: "only on /pages/preview" }),
      ],
    } as unknown as Doc;
    const { layout } = PUBLICATIONS.pub_a;
    const snapshot = await createThemePreviewContentSnapshot({
      templates: [
        { type: "layout", document: layout },
        { type: "page", document: generic },
      ],
      pages: [{ handle: "preview", document: previewPageDoc }],
    });
    const read = previewRead(snapshot);
    const merged = read(new URLSearchParams("path=/pages/other")) as {
      slots: Record<string, unknown>;
    };
    expect(merged.slots["page-hero"]).toEqual({ heading: "Generic" });
    expect(merged.slots).not.toHaveProperty("secret");
    const own = read(new URLSearchParams("path=/pages/other&scope=page")) as {
      slots: Record<string, unknown>;
    };
    expect(own.slots).toEqual({ "page-hero": { heading: "Generic" } });
    // The Page itself still reads its own draft.
    expect(
      (read(new URLSearchParams("path=/pages/preview&scope=page")) as {
        slots: Record<string, unknown>;
      }).slots.secret,
    ).toEqual({ text: "only on /pages/preview" });
    // As public and Build Preview answer a Page without a Document.
    const ports: ContentRuntimePorts = {
      getPublishedDocument: async ({ templateType }) =>
        (templateType === "page"
          ? generic
          : templateType === "layout"
            ? layout
            : null) as PublishedDocument | null,
      getPublishedPageDocument: async ({ handle }) =>
        (handle === "preview" ? previewPageDoc : null) as PublishedDocument | null,
    };
    for (const scope of [undefined, "page", "layout"] as const) {
      const query =
        scope === "layout"
          ? "scope=layout&layout=default&path=/pages/other"
          : scope === "page"
            ? "path=/pages/other&scope=page"
            : "path=/pages/other";
      const runtime = await resolveStorefrontContent({
        publicationId: "p",
        pathname: "/pages/other",
        ports,
        ...(scope ? { scope } : {}),
      });
      const answer = read(new URLSearchParams(query)) as Record<string, unknown>;
      expect({ slots: answer.slots, hiddenSlots: answer.hiddenSlots }).toEqual(
        runtime,
      );
    }
  });

  it("is what the dev server's endpoint answers, refusing an unanswerable read", async () => {
    const snapshot = await previewSnapshot("pub_b");
    const plugin = new Function(
      "fs",
      "path",
      `return (${themePreviewContentPluginSource()});`,
    )(
      { readFileSync: () => JSON.stringify(snapshot) },
      { join: (...parts: string[]) => parts.join("/") },
    ) as { configureServer(server: unknown): void };
    let middleware:
      | ((req: object, res: object, next: () => void) => void)
      | undefined;
    plugin.configureServer({
      config: { root: "/workspace" },
      middlewares: { use: (handler: typeof middleware) => (middleware = handler) },
    });
    const get = (query: string) => {
      const res = {
        statusCode: 0,
        body: "",
        setHeader() {},
        end(body = "") {
          this.body = body;
        },
      };
      middleware!({ url: `/_morph/content?${query}`, method: "GET" }, res, () => {
        throw new Error("next");
      });
      return { status: res.statusCode, body: JSON.parse(res.body) };
    };
    expect(get(QUERIES.layout)).toEqual({
      status: 200,
      body: expected("pub_b").layout,
    });
    expect(get(QUERIES.page).body).toEqual(expected("pub_b").page);
    expect(get(QUERIES.merged).body).toEqual(expected("pub_b").merged);
    expect(get("scope=layout&layout=other&path=%2F").status).toBe(503);
  });
});

function sealedSnapshot(id: PublicationId): ThemeBuildContentSnapshot {
  const { layout, index } = PUBLICATIONS[id];
  return {
    publicationId: id,
    storefrontId: "sf_1",
    themeId: "th_1",
    documents: [
      {
        item: {
          id: "layout",
          publicationId: id,
          itemType: "template",
          contentId: "layout",
          revisionId: "layout-rev",
          metadata: { templateType: "layout" },
        },
        document: layout,
      },
      {
        item: {
          id: "index",
          publicationId: id,
          itemType: "template",
          contentId: "index",
          revisionId: "index-rev",
          metadata: { templateType: "index" },
        },
        document: { ...index, renderPolicy: { mode: "ssg" } },
      },
    ],
  } as unknown as ThemeBuildContentSnapshot;
}

const registry = buildThemeRouteRegistry([
  {
    path: "src/routes/__root.tsx",
    content:
      "import { createRootRoute } from '@tanstack/react-router'; export const Route = createRootRoute({});",
  },
  {
    path: "src/routes/index.tsx",
    content:
      "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: () => <div/> });",
  },
  {
    path: "src/routes/contact.tsx",
    content:
      "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/contact')({ component: () => <div/> });",
  },
]);

/** A build's generated content server over its sealed file. */
function prerenderServer(file: unknown, platform: boolean) {
  const records: string[] = [];
  type Res = {
    statusCode: number;
    body?: string;
    setHeader(): void;
    end(body?: string): void;
  };
  let middleware:
    | ((req: object, res: Res, next: (error?: Error) => void) => void)
    | undefined;
  const plugin = new Function(
    "fs",
    "path",
    "process",
    `return (${themePrerenderContentPluginSource(".", {
      refusedReadsPath: NATIVE_PRERENDER_REFUSED_READS_PATH,
      ...(platform ? { platform: true } : {}),
    })});`,
  )(
    {
      readFileSync: () => JSON.stringify(file),
      rmSync: () => undefined,
      mkdirSync: () => undefined,
      appendFileSync: (_file: string, text: string) => records.push(text),
    },
    {
      join: (...parts: string[]) => parts.join("/"),
      dirname: (file: string) => file.slice(0, file.lastIndexOf("/")),
    },
    { env: { TSS_PRERENDERING: "true" } },
  );
  plugin.configurePreviewServer({
    httpServer: { address: () => ({ address: "127.0.0.1", port: 4321 }) },
    middlewares: {
      use: (handler: typeof middleware) => {
        middleware ??= handler;
      },
    },
  });
  const get = (query: string) => {
    const res: Res = {
      statusCode: 200,
      setHeader() {},
      end(body?: string) {
        this.body = body;
      },
    };
    middleware!(
      {
        url: `/_morph/content?${query}`,
        method: "GET",
        headers: {},
        rawHeaders: [],
      },
      res,
      (error) => {
        throw error ?? new Error("next");
      },
    );
    return {
      status: res.statusCode,
      text: res.body,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };
  return { get, records: () => records.map((line) => JSON.parse(line)) };
}

describe("prerender: the sealed snapshot", () => {
  it("a native build answers every read as the public endpoint does for the same publication", async () => {
    for (const id of ["pub_a", "pub_b", "pub_a"] as const) {
      const sealed = await createNativePrerenderContent(
        sealedSnapshot(id),
        registry,
      );
      const server = prerenderServer(sealed, false);
      const want = expected(id);
      for (const key of Object.keys(QUERIES) as (keyof typeof QUERIES)[]) {
        expect(server.get(QUERIES[key]).text, key).toBe(
          JSON.stringify(want[key]),
        );
      }
      // A trailing slash reads the same sealed path (P2-6).
      expect(server.get("path=%2Fcontact%2F&scope=page").body).toEqual(
        want.contactPage,
      );
      // Not sealed: refused and recorded, never answered.
      expect(server.get("path=%2Fmissing&scope=page").status).toBe(404);
      expect(
        server.get("scope=layout&layout=default&path=%2Fmissing").status,
      ).toBe(404);
      expect(server.records()).toEqual([
        {
          path: "/missing",
          reason:
            "NATIVE_PRERENDER_PATH_NOT_SEALED: no static route of this build has this path",
        },
        {
          path: "/missing",
          reason:
            "NATIVE_PRERENDER_PATH_NOT_SEALED: no static route of this build has this path",
        },
      ]);
    }
  });

  it("a platform build answers its SSG pages' scoped reads from the same file", async () => {
    const sealed = await createThemePrerenderContent(
      sealedSnapshot("pub_b"),
      registry,
    );
    expect(sealed).toBeDefined();
    const server = prerenderServer(sealed, true);
    const want = expected("pub_b");
    expect(server.get(QUERIES.merged).text).toBe(JSON.stringify(want.merged));
    expect(server.get(QUERIES.layout).body).toEqual(want.layout);
    expect(server.get(QUERIES.page).body).toEqual(want.page);
    expect(server.get("path=%2F%2F&scope=page").body).toEqual(want.page);
    expect(server.get("scope=layout&layout=x&path=%2F").status).toBe(404);
    expect(server.records()[0]).toMatchObject({ path: "(invalid read)" });
  });

  it("a platform build still answers the merged reads of a file sealed before scoped reads (P2-5)", async () => {
    const sealed = await createThemePrerenderContent(
      sealedSnapshot("pub_a"),
      registry,
    );
    // The old shape: the bare path map.
    const server = prerenderServer(sealed!.content, true);
    expect(server.get(QUERIES.merged).text).toBe(
      JSON.stringify(expected("pub_a").merged),
    );
    expect(server.get("path=%2Fnot-sealed").status).toBe(404);
    expect(server.get(QUERIES.page).status).toBe(404);
    expect(server.records().map((r) => r.path)).toEqual(["/not-sealed", "/"]);
  });

  it("refuses every scoped read of content sealed before scoped reads, or with none", () => {
    const read = { scope: "layout", layout: "default", path: "/" } as const;
    expect(answerSealedScopedRead({}, read, "NOT_SEALED")).toEqual({
      refused:
        "PRERENDER_SCOPED_CONTENT_NOT_SEALED: this build sealed no layout or page-only content",
    });
    expect(
      answerSealedScopedRead({ refusedAll: "NO_SNAPSHOT" }, read, "NOT_SEALED"),
    ).toEqual({ refused: "NO_SNAPSHOT" });
    expect(
      answerSealedScopedRead(
        { scoped: { page: {}, layout: {} }, unavailable: { "/x": "WHY" } },
        { scope: "page", path: "/x" },
        "NOT_SEALED",
      ),
    ).toEqual({ refused: "WHY" });
  });
});

describe("one body for every resolver", () => {
  it("preview, prerender, Build Preview and public agree on each read, across publish and rollback", async () => {
    const site = publicSite();
    for (const id of ["pub_a", "pub_b", "pub_a"] as const) {
      site.activate(id);
      const preview = previewRead(await previewSnapshot(id));
      const prerender = prerenderServer(
        await createNativePrerenderContent(sealedSnapshot(id), registry),
        false,
      );
      for (const query of Object.values(QUERIES)) {
        const publicText = (await site.raw("?" + query)).text;
        expect(JSON.stringify(preview(new URLSearchParams(query))), query).toBe(
          publicText,
        );
        expect(prerender.get(query).text, query).toBe(publicText);
        const buildPreview = await serveBuildPreviewContent({
          request: new Request(`https://p.invalid/_morph/content?${query}`),
          capability: { contentPublicationId: id } as never,
          ports: contentPorts,
        });
        expect(await buildPreview.text(), query).toBe(publicText);
      }
    }
  });

  it("the SDK refuses an old content source that ignores the scope", async () => {
    const old = createMorph({
      baseUrl: BASE,
      fetch: async () => new Response(JSON.stringify(expected("pub_a").merged)),
    });
    for (const read of [
      old.layouts.get("default", { path: "/" }),
      old.pages.get("/", { scope: "page" }),
    ]) {
      await expect(read).rejects.toBeInstanceOf(MorphError);
      await expect(read).rejects.toMatchObject({ code: "invalid_response" });
    }
    expect(wire(await old.pages.get("/"))).toEqual(expected("pub_a").merged);
  });

  it("scoped bodies and content are the shared functions'", () => {
    const content = { slots: { a: {} }, hiddenSlots: ["b"] };
    expect(
      storefrontContentScopedBody(
        { scope: "layout", layout: "default", path: "/" },
        content,
      ),
    ).toEqual({ scope: "layout", layout: "default", ...content });
    expect(
      storefrontContentScopedBody({ scope: "page", path: "/" }, content),
    ).toEqual({ scope: "page", ...content });
    // Self-contained: the preview and prerender servers carry them as source.
    for (const fn of [
      storefrontContentScopedRead,
      storefrontContentScopedBody,
      storefrontScopedContent,
    ]) {
      const copy = new Function(`return (${fn.toString()});`)();
      expect(typeof copy).toBe("function");
    }
    const copy = new Function(
      `return (${storefrontScopedContent.toString()});`,
    )() as typeof storefrontScopedContent;
    expect(
      copy("layout", { slots: { h: { t: 1 } }, hiddenSlots: ["x"] }, ["h"], ["h"]),
    ).toEqual({ slots: { h: { t: 1 } }, hiddenSlots: ["x"] });
  });
});
