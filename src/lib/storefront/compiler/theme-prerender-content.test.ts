import { describe, expect, it } from "vitest";
import { buildThemeRouteRegistry } from "./theme-route-registry";
import {
  createThemePrerenderContent,
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  PLATFORM_PRERENDER_CONTENT_UNAVAILABLE,
  PLATFORM_PRERENDER_PATH_NOT_SEALED,
  platformPrerenderFailure,
  THEME_PRERENDER_CONTENT_FILE,
  themePrerenderContentPluginSource,
} from "./theme-prerender-content";
import { refuseThemeWorkspacePath } from "./theme-workspace-path";
import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";

const registry = buildThemeRouteRegistry([
  {
    path: "src/routes/__root.tsx",
    content:
      "import { createRootRoute } from '@tanstack/react-router'; export const Route = createRootRoute({});",
  },
  {
    path: "src/routes/landing.tsx",
    content:
      "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/landing')({ component: () => <div/> });",
  },
]);
function snapshot(): ThemeBuildContentSnapshot {
  return {
    publicationId: "pub",
    storefrontId: "store",
    themeId: "theme",
    documents: [
      {
        item: {
          id: "item",
          publicationId: "pub",
          itemType: "template",
          contentId: "page",
          revisionId: "rev",
          metadata: { routePath: "/landing" },
        },
        document: {
          version: 1,
          renderPolicy: { mode: "ssg" },
          sections: [
            {
              id: "hero",
              type: "hero",
              enabled: true,
              props: { title: "Frozen" },
            },
            {
              id: "hidden",
              type: "hero",
              enabled: false,
              props: { title: "Never rendered" },
            },
          ],
        },
      },
    ],
  };
}
describe("frozen prerender content", () => {
  it.each([
    { address: null, code: "SSG_CONTENT_SERVER_UNAVAILABLE" },
    { address: "/tmp/preview.sock", code: "SSG_CONTENT_SERVER_UNAVAILABLE" },
    {
      address: { address: "192.0.2.5", port: 1234 },
      code: "SSG_CONTENT_LOOPBACK_REQUIRED",
    },
    {
      address: { address: "attacker.example", port: 1234 },
      code: "SSG_CONTENT_LOOPBACK_REQUIRED",
    },
    {
      address: { address: "127.attacker.example", port: 1234 },
      code: "SSG_CONTENT_LOOPBACK_REQUIRED",
    },
    {
      address: { address: "::1", port: 0 },
      code: "SSG_CONTENT_LOOPBACK_REQUIRED",
    },
  ])(
    "refuses an unavailable or non-loopback listener: $address",
    ({ address, code }) => {
      let middleware:
        | ((req: object, res: object, next: (error?: Error) => void) => void)
        | undefined;
      const plugin = new Function(
        "fs",
        "path",
        "process",
        `return (${themePrerenderContentPluginSource("/workspace")});`,
      )(
        { readFileSync: () => "{}" },
        { join: (...parts: string[]) => parts.join("/") },
        { env: { TSS_PRERENDERING: "true" } },
      );
      plugin.configurePreviewServer({
        httpServer: { address: () => address },
        middlewares: {
          use: (handler: typeof middleware) => {
            middleware = handler;
          },
        },
      });
      let failure: Error | undefined;
      middleware!(
        {
          url: "/landing",
          headers: { host: "127.0.0.1:1234" },
          rawHeaders: [],
        },
        {},
        (error) => {
          failure = error;
        },
      );
      expect(failure?.message).toBe(code);
    },
  );

  it.each([
    { address: "127.0.0.1", origin: "http://127.0.0.1:4321" },
    { address: "::1", origin: "http://[::1]:4321" },
  ])(
    "replaces a forged x-morph-content-origin with its own $address listener, in headers and rawHeaders",
    ({ address, origin }) => {
      let middleware:
        | ((req: object, res: object, next: (error?: Error) => void) => void)
        | undefined;
      const plugin = new Function(
        "fs",
        "path",
        "process",
        `return (${themePrerenderContentPluginSource("/workspace")});`,
      )(
        { readFileSync: () => "{}" },
        { join: (...parts: string[]) => parts.join("/") },
        { env: { TSS_PRERENDERING: "true" } },
      );
      plugin.configurePreviewServer({
        httpServer: { address: () => ({ address, port: 4321 }) },
        middlewares: {
          use: (handler: typeof middleware) => {
            middleware = handler;
          },
        },
      });
      const forged = "https://attacker.example";
      const req = {
        url: "/landing",
        method: "GET",
        headers: {
          host: "127.0.0.1:4321",
          "x-morph-content-origin": forged,
        } as Record<string, string>,
        // Cloudflare's Node adapter reads these, so a forged copy here
        // (in any letter case) must not survive either.
        rawHeaders: [
          "Host",
          "127.0.0.1:4321",
          "X-Morph-Content-Origin",
          forged,
          "x-morph-content-origin",
          forged,
          "Accept",
          "text/html",
        ],
      };
      let passed = false;
      middleware!(req, {}, (error) => {
        expect(error).toBeUndefined();
        passed = true;
      });
      expect(passed).toBe(true);
      expect(req.headers["x-morph-content-origin"]).toBe(origin);
      const named: string[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]!.toLowerCase() === "x-morph-content-origin") {
          named.push(req.rawHeaders[i + 1]!);
        }
      }
      expect(named).toEqual([origin]);
      expect(req.rawHeaders.join("\n")).not.toContain(forged);
      // The Theme's other headers pass.
      expect(req.rawHeaders).toEqual(
        expect.arrayContaining(["Accept", "text/html"]),
      );
    },
  );

  it("merges a frozen layout with no explicit website policy and the immutable index template", async () => {
    const data = snapshot();
    data.documents[0]!.item.metadata = { templateType: "index" };
    data.documents.push({
      item: {
        ...data.documents[0]!.item,
        id: "layout",
        contentId: "layout",
        revisionId: "layout-rev",
        metadata: { templateType: "layout" },
      },
      document: {
        version: 1,
        sections: [
          {
            id: "header",
            type: "header",
            enabled: true,
            props: { title: "Frozen shell" },
          },
        ],
      },
    });
    const home = buildThemeRouteRegistry([
      {
        path: "src/routes/index.tsx",
        content:
          "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: () => <div/> });",
      },
    ]);
    expect(await createThemePrerenderContent(data, home)).toEqual({
      content: {
        "/": {
          slots: {
            header: { title: "Frozen shell" },
            hero: { title: "Frozen" },
          },
          hiddenSlots: ["hidden"],
        },
      },
      // The scoped reads' content, from the same documents.
      scoped: {
        page: {
          "/": { slots: { hero: { title: "Frozen" } }, hiddenSlots: ["hidden"] },
        },
        layout: {
          "/": { slots: { header: { title: "Frozen shell" } }, hiddenSlots: [] },
        },
      },
    });
  });
  it("reserves the temporary snapshot against Theme source replacement", () => {
    expect(refuseThemeWorkspacePath(THEME_PRERENDER_CONTENT_FILE)).toContain(
      "RESERVED_THEME_PREVIEW_PATH",
    );
  });
  it("refuses a template role that the sealed route reference cannot prove", async () => {
    const data = snapshot();
    data.documents[0]!.item.metadata = { routePath: "/products/featured" };
    const products = buildThemeRouteRegistry([
      {
        path: "src/routes/products.featured.tsx",
        content:
          "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/products/featured')({ component: () => <div/> });",
      },
    ]);
    await expect(createThemePrerenderContent(data, products)).rejects.toThrow(
      "SSG_CONTENT_TEMPLATE_IDENTITY_REQUIRED",
    );
    data.documents[0]!.document.sections = [];
    expect(await createThemePrerenderContent(data, products)).toEqual({
      content: { "/products/featured": { slots: {}, hiddenSlots: [] } },
      scoped: {
        page: { "/products/featured": { slots: {}, hiddenSlots: [] } },
        layout: { "/products/featured": { slots: {}, hiddenSlots: [] } },
      },
    });
  });
  it.each([
    { address: "127.0.0.1", origin: "http://127.0.0.1:1234" },
    { address: "::1", origin: "http://[::1]:1234" },
    { address: "::", origin: "http://[::1]:1234" },
    { address: "0.0.0.0", origin: "http://127.0.0.1:1234" },
  ])(
    "provides only selected GET content and replaces origin headers for $address",
    ({ address, origin }) => {
      type Request = {
        url: string;
        method: string;
        headers: Record<string, string>;
        rawHeaders: string[];
      };
      type Response = {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body?: string): void;
      };
      type Middleware = (req: Request, res: Response, next: () => void) => void;
      let middleware: Middleware | undefined;
      const plugin = new Function(
        "fs",
        "path",
        "process",
        `return (${themePrerenderContentPluginSource("/workspace")});`,
      )(
        {
          readFileSync: () =>
            JSON.stringify({
              "/landing": {
                slots: { hero: { title: "Frozen" } },
                hiddenSlots: [],
              },
            }),
        },
        { join: (...parts: string[]) => parts.join("/") },
        { env: { TSS_PRERENDERING: "true" } },
      );
      plugin.configurePreviewServer({
        httpServer: { address: () => ({ address, port: 1234 }) },
        middlewares: {
          use: (handler: Middleware) => {
            middleware = handler;
          },
        },
      });
      const req: Request = {
        url: "/landing",
        method: "GET",
        headers: { "x-morph-content-origin": "https://wrong.invalid" },
        rawHeaders: [
          "X-Morph-Content-Origin",
          "https://wrong.invalid",
          "Accept",
          "text/html",
        ],
      };
      let body: string | undefined;
      const res: Response = {
        statusCode: 200,
        setHeader: () => {},
        end: (value) => {
          body = value;
        },
      };
      middleware!(req, res, () => {});
      expect(req.headers["x-morph-content-origin"]).toBe(origin);
      expect(req.rawHeaders).toEqual([
        "Accept",
        "text/html",
        "x-morph-content-origin",
        origin,
      ]);
      req.url = "/_morph/content?path=/landing";
      middleware!(req, res, () => {});
      expect(JSON.parse(body!).slots.hero.title).toBe("Frozen");
      req.url = "/_morph/content?path=/not-selected";
      middleware!(req, res, () => {});
      expect(res.statusCode).toBe(404);
      req.url = "/_morph/content?path=/landing";
      req.method = "POST";
      res.statusCode = 200;
      middleware!(req, res, () => {});
      expect(res.statusCode).toBe(404);
    },
  );
  it("reuses the public resolver for fields, visibility and the layout", async () => {
    const data = snapshot();
    data.documents.push({
      item: {
        id: "shell",
        publicationId: "pub",
        itemType: "template",
        contentId: "layout",
        revisionId: "layout-rev",
      },
      document: {
        version: 1,
        websiteRenderPolicy: { mode: "ssr" },
        sections: [
          {
            id: "header",
            type: "header",
            enabled: true,
            props: { title: "Shell" },
          },
        ],
      },
    });
    const before = JSON.stringify(data);
    expect(await createThemePrerenderContent(data, registry)).toEqual({
      content: {
        "/landing": {
          slots: { header: { title: "Shell" }, hero: { title: "Frozen" } },
          hiddenSlots: ["hidden"],
        },
      },
      scoped: {
        page: {
          "/landing": {
            slots: { hero: { title: "Frozen" } },
            hiddenSlots: ["hidden"],
          },
        },
        layout: {
          "/landing": { slots: { header: { title: "Shell" } }, hiddenSlots: [] },
        },
      },
    });
    expect(JSON.stringify(data)).toBe(before);
  });
  it("never guesses an unmapped legacy content document", async () => {
    const data = snapshot();
    data.documents.push({
      item: {
        ...data.documents[0]!.item,
        id: "legacy",
        contentId: "legacy",
        metadata: undefined,
      },
      document: {
        version: 1,
        sections: [{ id: "unknown", type: "hero", enabled: true, props: {} }],
      },
    });
    await expect(createThemePrerenderContent(data, registry)).rejects.toThrow(
      "SSG_CONTENT_ROUTE_REQUIRED",
    );
  });
  it("does not materialize content for source-only or SSR-only builds", async () => {
    expect(
      await createThemePrerenderContent(undefined, registry),
    ).toBeUndefined();
    const data = snapshot();
    data.documents[0]!.document.renderPolicy = { mode: "ssr" };
    expect(await createThemePrerenderContent(data, registry)).toBeUndefined();
  });
});

describe("a platform build's refused prerender content reads", () => {
  type Middleware = (
    req: object,
    res: { statusCode?: number; end(body?: string): void; setHeader(): void },
    next: (error?: Error) => void,
  ) => void;
  function platformEndpoint(content: Record<string, unknown>) {
    const files = new Map<string, string>([
      // A record left before this prerender started is not this build's.
      ["/workspace/.morph/prerender-refused-reads.ndjson", "stale\n"],
    ]);
    let middleware: Middleware | undefined;
    const plugin = new Function(
      "fs",
      "path",
      "process",
      `return (${themePrerenderContentPluginSource("/workspace", {
        refusedReadsPath: NATIVE_PRERENDER_REFUSED_READS_PATH,
        platform: true,
      })});`,
    )(
      {
        // A platform build's file (`ThemePrerenderContent`).
        readFileSync: () =>
          JSON.stringify({
            content,
            scoped: { page: {}, layout: {} },
          }),
        rmSync: (file: string) => files.delete(file),
        mkdirSync: () => undefined,
        appendFileSync: (file: string, text: string) =>
          files.set(file, (files.get(file) ?? "") + text),
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
        use: (handler: Middleware) => {
          middleware ??= handler;
        },
      },
    });
    const read = (pathParam: string, method = "GET") => {
      const res = {
        statusCode: 200,
        body: undefined as string | undefined,
        end(body?: string) {
          this.body = body;
        },
        setHeader() {},
      };
      middleware!(
        {
          url: `/_morph/content?path=${encodeURIComponent(pathParam)}`,
          method,
          headers: {},
          rawHeaders: [],
        },
        res,
        () => {
          throw new Error("unexpected next()");
        },
      );
      return res;
    };
    return {
      read,
      record: () =>
        files.get("/workspace/.morph/prerender-refused-reads.ndjson"),
    };
  }

  it("answers a sealed path and records nothing", () => {
    const endpoint = platformEndpoint({ "/landing": { slots: {} } });
    const res = endpoint.read("/landing");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ slots: {} });
    expect(endpoint.record()).toBeUndefined();
  });

  it("still refuses an unsealed path with a 404, and records the path and why, never content", () => {
    const endpoint = platformEndpoint({
      "/landing": { slots: { hero: { title: "secret-sealed-value" } } },
    });
    const res = endpoint.read("/elsewhere");
    expect(res.statusCode).toBe(404);
    expect(res.body).toBeUndefined();
    // A non-GET is refused too, but is not a content read.
    expect(endpoint.read("/posted", "POST").statusCode).toBe(404);
    const record = endpoint.record()!;
    expect(
      record
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { path: "/elsewhere", reason: PLATFORM_PRERENDER_PATH_NOT_SEALED },
    ]);
    expect(record).not.toContain("secret-sealed-value");
    expect(PLATFORM_PRERENDER_PATH_NOT_SEALED).toMatch(
      /^PLATFORM_PRERENDER_PATH_NOT_SEALED: /,
    );
  });

  it("is what the generated platform runtime config installs", () => {
    const source = themePrerenderContentPluginSource("/workspace", {
      refusedReadsPath: NATIVE_PRERENDER_REFUSED_READS_PATH,
      platform: true,
    });
    expect(source).toContain(PLATFORM_PRERENDER_PATH_NOT_SEALED);
    // The native path's records keep their own reason.
    expect(
      themePrerenderContentPluginSource(".", {
        refusedReadsPath: NATIVE_PRERENDER_REFUSED_READS_PATH,
      }),
    ).not.toContain("PLATFORM_PRERENDER_PATH_NOT_SEALED");
  });
});

describe("a failed platform build's message", () => {
  const output = "Error: Failed to fetch /landing: Internal Server Error";

  it("is the build's own output when no content read was refused", () => {
    expect(platformPrerenderFailure(output, undefined)).toBeUndefined();
    // An empty record holds no refused read.
    expect(platformPrerenderFailure(output, "")).toBeUndefined();
    expect(platformPrerenderFailure(output, new Uint8Array())).toBeUndefined();
  });

  it("fails a build that exited 0 but recorded a refused read, with no output appended", () => {
    const failure = platformPrerenderFailure(
      "",
      JSON.stringify({
        path: "/elsewhere",
        reason: PLATFORM_PRERENDER_PATH_NOT_SEALED,
      }) + "\n",
    )!;
    expect(failure.code).toBe(PLATFORM_PRERENDER_CONTENT_UNAVAILABLE);
    expect(failure.refusedReads).toEqual([
      { path: "/elsewhere", reason: PLATFORM_PRERENDER_PATH_NOT_SEALED },
    ]);
    expect(failure.message).toMatch(/while prerendering\.$/);
  });

  it("names each refused path and its reason first, then keeps the build's output", () => {
    const record =
      JSON.stringify({
        path: "/elsewhere",
        reason: PLATFORM_PRERENDER_PATH_NOT_SEALED,
      }) +
      "\n" +
      JSON.stringify({
        path: "/elsewhere",
        reason: PLATFORM_PRERENDER_PATH_NOT_SEALED,
      }) +
      "\n{torn" +
      "\n" +
      JSON.stringify({
        path: "/other",
        reason: PLATFORM_PRERENDER_PATH_NOT_SEALED,
      }) +
      "\n";
    const failure = platformPrerenderFailure(
      output,
      new TextEncoder().encode(record),
    )!;
    expect(failure.code).toBe(PLATFORM_PRERENDER_CONTENT_UNAVAILABLE);
    expect(failure.refusedReads).toEqual([
      { path: "/elsewhere", reason: PLATFORM_PRERENDER_PATH_NOT_SEALED },
      { path: "/other", reason: PLATFORM_PRERENDER_PATH_NOT_SEALED },
    ]);
    expect(failure.message).toMatch(
      /^PLATFORM_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed: \/elsewhere \(PLATFORM_PRERENDER_PATH_NOT_SEALED: [^)]+\), \/other \(PLATFORM_PRERENDER_PATH_NOT_SEALED: [^)]+\)\./,
    );
    expect(failure.message).toContain(output);
  });

  it("still says a read was refused when no line of the record can be read", () => {
    const failure = platformPrerenderFailure(output, "{torn")!;
    expect(failure.refusedReads).toEqual([]);
    expect(failure.message).toMatch(
      /^PLATFORM_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed\./,
    );
  });
});
