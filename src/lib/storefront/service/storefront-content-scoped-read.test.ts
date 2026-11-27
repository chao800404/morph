// @vitest-environment node
/**
 * The SDK's scoped reads (`layouts.get("default")`,
 * `pages.get(path, { scope: "page" })`) through every content resolver:
 *
 * - public: `StorefrontProductionService` (`/_morph/content` on the merchant
 *   host), read by the real SDK, on the pinned or active publication, across
 *   publish and rollback;
 * - Build Preview: `serveBuildPreviewContent`;
 * - Live Preview: the snapshot Core writes (`createThemePreviewContentSnapshot`)
 *   answered by the resolver the preview Worker and dev server embed;
 * - prerender: the sealed content of a native and a platform build
 *   (`createNativePrerenderContent`, `createThemePrerenderContent`) answered
 *   by the generated content server and `answerSealedScopedRead`.
 *
 * Each answers the same Documents with the same body, and the legacy merged
 * read is byte for byte what it was.
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
  buildStorefrontPageContent,
  resolveStorefrontContent,
  type ContentRuntimePorts,
  type PublishedDocument,
} from "./storefront-content-runtime";
import {
  storefrontContentScopedBody,
  storefrontContentScopedRead,
} from "./storefront-content-read";
import { collectVisitorMediaKeys } from "./published-media-authorization";
import { serveBuildPreviewContent } from "./build-preview/build-preview-content";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";
import { StorefrontProductionService } from "./storefront-production.service";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const HOST = "shop.example.com";
const BASE = `https://${HOST}`;

/** One publication's Documents: the shared layout and the home page. */
function documents(tag: string) {
  const layout = {
    version: 1,
    sections: [
      {
        id: "header",
        type: "header",
        enabled: true,
        props: { title: `Shop ${tag}` },
      },
      // Hidden in the layout: never in any read's output.
      {
        id: "announcement",
        type: "banner",
        enabled: false,
        props: { text: `Hidden sale ${tag}` },
      },
    ],
  } as unknown as StorefrontPageDocument;
  const index = {
    version: 1,
    sections: [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        props: { heading: `Home ${tag}` },
      },
      {
        id: "newsletter",
        type: "newsletter",
        enabled: false,
        props: { title: "x" },
      },
    ],
  } as unknown as StorefrontPageDocument;
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

/** What each read must answer for one publication, from the runtime itself. */
function expected(id: PublicationId) {
  const { layout, index } = PUBLICATIONS[id];
  const merged = buildStorefrontContent(
    layout as PublishedDocument,
    index as PublishedDocument,
  );
  return {
    merged,
    layout: {
      scope: "layout",
      layout: "default",
      ...buildStorefrontContent(layout as PublishedDocument, null),
    },
    page: {
      scope: "page",
      ...buildStorefrontPageContent(
        layout as PublishedDocument,
        index as PublishedDocument,
      ),
    },
    // A path no Document describes: the shell alone merged, nothing of its own.
    contactMerged: buildStorefrontContent(layout as PublishedDocument, null),
    contactPage: { scope: "page", slots: {}, hiddenSlots: [] },
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

describe("the scoped read query (storefront-content-read.ts)", () => {
  it.each([
    ["?path=/", null],
    ["?path=/about&scope=page", { scope: "page", path: "/about" }],
    ["?scope=layout&layout=default", { scope: "layout", layout: "default" }],
    ["?scope=merged&path=/", "invalid"],
    ["?scope=page", "invalid"],
    ["?scope=page&path=about", "invalid"],
    [`?scope=page&path=/${"a".repeat(500)}`, "invalid"],
    ["?scope=page&path=/&path=/x", "invalid"],
    ["?scope=page&path=/&layout=default", "invalid"],
    ["?scope=page&scope=page&path=/", "invalid"],
    ["?scope=layout", "invalid"],
    ["?scope=layout&layout=main", "invalid"],
    ["?scope=layout&layout=default&path=/", "invalid"],
  ])("%s", (query, read) => {
    expect(storefrontContentScopedRead(new URLSearchParams(query))).toEqual(
      read,
    );
  });
});

describe("the content runtime's scopes", () => {
  it("splits the merged read into the layout's and the page's own, with the same keys", async () => {
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
    expect(layout).toEqual({
      slots: { header: { title: "Shop A" } },
      hiddenSlots: ["announcement"],
    });
    expect(own).toEqual({
      slots: { hero: { heading: "Home A" } },
      hiddenSlots: ["newsletter"],
    });
    expect(merged.slots).toEqual({ ...layout.slots, ...own.slots });
    expect([...merged.hiddenSlots].sort()).toEqual(
      [...layout.hiddenSlots, ...own.hiddenSlots].sort(),
    );
    // The hidden layout section's values reach no read.
    for (const result of [merged, layout, own]) {
      expect(JSON.stringify(result)).not.toContain("Hidden sale");
    }
  });

  it("reads only the layout Document for a layout read", async () => {
    const getPublishedDocument = vi.fn(contentPorts.getPublishedDocument);
    const getPublishedRouteDocument = vi.fn(async () => null);
    await resolveStorefrontContent({
      publicationId: "pub_a",
      pathname: "/aboutus",
      ports: { getPublishedDocument, getPublishedRouteDocument },
      scope: "layout",
    });
    expect(getPublishedDocument.mock.calls).toEqual([
      [{ publicationId: "pub_a", templateType: "layout" }],
    ]);
    expect(getPublishedRouteDocument).not.toHaveBeenCalled();
  });

  it("never emits in the page-only read what the merged read hides: one slot namespace", () => {
    const asset = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const layout = {
      sections: [
        { id: "hero", enabled: false, props: {} },
        { id: "header", enabled: true, props: { title: "Shell" } },
      ],
    } satisfies PublishedDocument;
    const page = {
      sections: [
        {
          id: "hero",
          enabled: true,
          props: { image: `/_storefront-media/${asset}?version=v1` },
        },
        { id: "header", enabled: true, props: { title: "Own" } },
        { id: "story", enabled: true, props: { body: "Text" } },
      ],
    } satisfies PublishedDocument;
    // The layout hides hero: hidden in both reads. The page's header wins
    // over the layout's in both.
    const expectedOwn = {
      slots: { header: { title: "Own" }, story: { body: "Text" } },
      hiddenSlots: ["hero"],
    };
    expect(buildStorefrontContent(layout, page)).toEqual(expectedOwn);
    expect(buildStorefrontPageContent(layout, page)).toEqual(expectedOwn);
    // So media authorisation, derived from the merged read, covers it:
    // the hidden hero's asset stays unpublished.
    const keys = collectVisitorMediaKeys({
      layoutDocument: layout,
      documents: [page],
      known: new Map([[asset, new Set(["v1"])]]),
    });
    expect(keys.has(asset)).toBe(false);
  });
});

describe("public /_morph/content", () => {
  it("answers the legacy merged read byte for byte as before, with the same tag", async () => {
    const site = publicSite();
    const answer = await site.raw("?path=%2F");
    expect(answer.status).toBe(200);
    expect(answer.text).toBe(JSON.stringify(expected("pub_a").merged));
    expect(answer.etag).toBe('"rel_pub_a:/"');
    expect(JSON.parse(answer.text)).not.toHaveProperty("scope");
  });

  it("answers each scoped read naming its scope, with its own tag", async () => {
    const site = publicSite();
    const layout = await site.raw("?scope=layout&layout=default");
    expect(JSON.parse(layout.text)).toEqual(expected("pub_a").layout);
    expect(layout.etag).toBe('"rel_pub_a:layout:default"');
    const page = await site.raw("?path=%2F&scope=page");
    expect(JSON.parse(page.text)).toEqual(expected("pub_a").page);
    expect(page.etag).toBe('"rel_pub_a:page:/"');
    expect(JSON.parse((await site.raw("?path=%2Fcontact&scope=page")).text))
      .toEqual(expected("pub_a").contactPage);
  });

  it.each([
    "?scope=unknown&path=/",
    "?scope=layout&layout=main",
    "?scope=page",
    "?scope=layout&layout=default&path=/",
  ])("refuses an unusable scoped read: %s", async (query) => {
    const answer = await publicSite().raw(query);
    expect(answer.status).toBe(400);
    // As the endpoint's other refusals ("Invalid content path."): plain text.
    expect(answer.text).toContain("Invalid content read.");
  });

  it("serves the SDK the same content across publish and rollback, page and layout from one publication", async () => {
    const site = publicSite();
    const readAll = async () => ({
      merged: wire(await site.morph.pages.get("/")),
      layout: wire(await site.morph.layouts.get("default")),
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

    const layout = await site.morph.layouts.get("default");
    expect(site.morph.layouts.isHidden(layout, "announcement")).toBe(true);
    expect(layout).not.toHaveProperty("announcement");
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
    expect(await (await serve("?path=%2F")).text()).toBe(
      JSON.stringify(expected("pub_b").merged),
    );
    expect(await (await serve("?scope=layout&layout=default")).json()).toEqual(
      expected("pub_b").layout,
    );
    expect(await (await serve("?path=%2F&scope=page")).json()).toEqual(
      expected("pub_b").page,
    );
    const refused = await serve("?scope=layout");
    expect(refused.status).toBe(400);
    expect((await serve("?scope=layout&layout=default", "HEAD")).status).toBe(
      200,
    );
  });
});

/** The resolver a preview Worker and dev server embed, over one snapshot. */
function previewResolver(snapshot: unknown) {
  const source = themePreviewContentModuleSource();
  const body = source
    .slice(
      source.indexOf("function templateTypeForPath"),
      source.indexOf("export function updatePreviewContent"),
    )
    .replace(
      "export function previewContentForPath",
      "function previewContentForPath",
    );
  return new Function("snapshot", `${body}; return previewContentForQuery;`)(
    JSON.parse(JSON.stringify(snapshot)),
  ) as (params: URLSearchParams) => unknown;
}

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
    const read = previewResolver(await previewSnapshot("pub_a"));
    const want = expected("pub_a");
    expect(read(new URLSearchParams("path=/"))).toEqual(want.merged);
    expect(
      JSON.stringify(read(new URLSearchParams("path=/"))),
    ).toBe(JSON.stringify(want.merged));
    expect(read(new URLSearchParams("scope=layout&layout=default"))).toEqual(
      want.layout,
    );
    expect(read(new URLSearchParams("path=/&scope=page"))).toEqual(want.page);
    expect(read(new URLSearchParams("path=/contact"))).toEqual(
      want.contactMerged,
    );
    expect(read(new URLSearchParams("path=/contact&scope=page"))).toEqual(
      want.contactPage,
    );
    expect(read(new URLSearchParams("scope=layout"))).toBeNull();
  });

  it("refuses a scoped read of a snapshot written before scoped reads, and still answers its merged reads", async () => {
    const { scoped: _scoped, ...old } = (await previewSnapshot(
      "pub_a",
    )) as ThemePreviewContentSnapshot;
    const read = previewResolver(old);
    expect(read(new URLSearchParams("path=/"))).toEqual(
      expected("pub_a").merged,
    );
    expect(read(new URLSearchParams("scope=layout&layout=default"))).toBeNull();
    expect(read(new URLSearchParams("path=/&scope=page"))).toBeNull();
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
    expect(get("scope=layout&layout=default")).toEqual({
      status: 200,
      body: expected("pub_b").layout,
    });
    expect(get("path=%2F&scope=page").body).toEqual(expected("pub_b").page);
    expect(get("path=%2F").body).toEqual(expected("pub_b").merged);
    expect(get("scope=layout&layout=other").status).toBe(503);
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
      expect(server.get("path=%2F").text).toBe(JSON.stringify(want.merged));
      expect(server.get("scope=layout&layout=default").body).toEqual(
        want.layout,
      );
      expect(server.get("path=%2F&scope=page").body).toEqual(want.page);
      expect(server.get("path=%2Fcontact&scope=page").body).toEqual(
        want.contactPage,
      );
      expect(server.get("path=%2Fcontact").body).toEqual(want.contactMerged);
      // Not sealed: refused and recorded, never answered.
      expect(server.get("path=%2Fmissing&scope=page").status).toBe(404);
      expect(server.records()).toEqual([
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
    expect(server.get("path=%2F").text).toBe(JSON.stringify(want.merged));
    expect(server.get("scope=layout&layout=default").body).toEqual(
      want.layout,
    );
    expect(server.get("path=%2F&scope=page").body).toEqual(want.page);
    expect(server.get("scope=layout&layout=x").status).toBe(404);
    expect(server.records()[0]).toMatchObject({ path: "(invalid read)" });
  });

  it("refuses every scoped read of content sealed before scoped reads, or with none", () => {
    const read = { scope: "layout", layout: "default" } as const;
    expect(
      answerSealedScopedRead({}, read, "NOT_SEALED"),
    ).toEqual({
      refused:
        "PRERENDER_SCOPED_CONTENT_NOT_SEALED: this build sealed no layout or page-only content",
    });
    expect(
      answerSealedScopedRead({ refusedAll: "NO_SNAPSHOT" }, read, "NOT_SEALED"),
    ).toEqual({ refused: "NO_SNAPSHOT" });
    expect(
      answerSealedScopedRead(
        {
          scoped: { layout: { slots: {}, hiddenSlots: [] }, pages: {} },
          unavailable: { "/x": "WHY" },
        },
        { scope: "page", path: "/x" },
        "NOT_SEALED",
      ),
    ).toEqual({ refused: "WHY" });
  });
});

describe("one body for every resolver", () => {
  it("preview, prerender and public agree on each read, across publish and rollback", async () => {
    const site = publicSite();
    for (const id of ["pub_a", "pub_b", "pub_a"] as const) {
      site.activate(id);
      const preview = previewResolver(await previewSnapshot(id));
      const prerender = prerenderServer(
        await createNativePrerenderContent(sealedSnapshot(id), registry),
        false,
      );
      for (const query of [
        "path=%2F",
        "path=%2F&scope=page",
        "scope=layout&layout=default",
        "path=%2Fcontact&scope=page",
      ]) {
        const publicText = (await site.raw("?" + query)).text;
        expect(JSON.stringify(preview(new URLSearchParams(query))), query).toBe(
          publicText,
        );
        expect(prerender.get(query).text, query).toBe(publicText);
      }
    }
  });

  it("the SDK refuses an old content source that ignores the scope", async () => {
    // A source from before scoped reads answers every read merged.
    const old = createMorph({
      baseUrl: BASE,
      fetch: async () =>
        new Response(JSON.stringify(expected("pub_a").merged)),
    });
    for (const read of [
      old.layouts.get("default"),
      old.pages.get("/", { scope: "page" }),
    ]) {
      await expect(read).rejects.toBeInstanceOf(MorphError);
      await expect(read).rejects.toMatchObject({ code: "invalid_response" });
    }
    expect(wire(await old.pages.get("/"))).toEqual(expected("pub_a").merged);
  });

  it("scoped bodies are the shared function's", () => {
    const content = { slots: { a: {} }, hiddenSlots: ["b"] };
    expect(
      storefrontContentScopedBody({ scope: "layout", layout: "default" }, content),
    ).toEqual({ scope: "layout", layout: "default", ...content });
    expect(
      storefrontContentScopedBody({ scope: "page", path: "/" }, content),
    ).toEqual({ scope: "page", ...content });
  });
});
