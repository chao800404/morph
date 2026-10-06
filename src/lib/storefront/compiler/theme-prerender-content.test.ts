import { describe, expect, it } from "vitest";
import { buildThemeRouteRegistry } from "./theme-route-registry";
import {
  createThemePrerenderContent,
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
      "/": {
        slots: { header: { title: "Frozen shell" }, hero: { title: "Frozen" } },
        hiddenSlots: ["hidden"],
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
      "/products/featured": { slots: {}, hiddenSlots: [] },
    });
  });
  it("provides only selected GET content and replaces raw as well as normalized origin headers", () => {
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
      httpServer: { address: () => ({ port: 1234 }) },
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
    expect(req.headers["x-morph-content-origin"]).toBe("http://127.0.0.1:1234");
    expect(req.rawHeaders).toEqual([
      "Accept",
      "text/html",
      "x-morph-content-origin",
      "http://127.0.0.1:1234",
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
  });
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
      "/landing": {
        slots: { header: { title: "Shell" }, hero: { title: "Frozen" } },
        hiddenSlots: ["hidden"],
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
