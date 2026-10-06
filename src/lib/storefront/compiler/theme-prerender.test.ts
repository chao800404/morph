import { describe, expect, it } from "vitest";
import { buildThemeRouteRegistry } from "./theme-route-registry";
import {
  assertThemePrerenderArtifacts,
  themePrerenderOptions,
} from "./theme-prerender";
import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";

const registry = buildThemeRouteRegistry([
  {
    path: "src/routes/__root.tsx",
    content:
      "import { createRootRoute } from '@tanstack/react-router'; export const Route = createRootRoute({ component: () => <div/> });",
  },
  {
    path: "src/routes/landing.tsx",
    content:
      "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/landing')({ component: () => <h1/> });",
  },
  {
    path: "src/routes/api.ts",
    content:
      "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/api')({ server: { handlers: { GET: () => new Response('ok') } } });",
  },
]);
const snapshot = (): ThemeBuildContentSnapshot => ({
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
        revisionId: "revision",
        metadata: { routePath: "/landing" },
      },
      document: { version: 1, sections: [], renderPolicy: { mode: "ssg" } },
    },
  ],
});

describe("platform native prerender options", () => {
  it("requires HTML for every selected route, not just client assets", () => {
    expect(() =>
      assertThemePrerenderArtifacts(
        snapshot(),
        registry,
        new Set(["runtime/client/assets/app.js"]),
      ),
    ).toThrow("INCOMPLETE_SSG_ARTIFACT");
    expect(() =>
      assertThemePrerenderArtifacts(
        snapshot(),
        registry,
        new Set(["runtime/client/landing/index.html"]),
      ),
    ).not.toThrow();
    expect(() =>
      assertThemePrerenderArtifacts(undefined, registry, new Set()),
    ).not.toThrow();
  });
  it("keeps source-only and SSR builds unchanged", () => {
    expect(themePrerenderOptions(undefined, registry)).toBeUndefined();
    const data = snapshot();
    data.documents[0]!.document.renderPolicy = { mode: "ssr" };
    expect(themePrerenderOptions(data, registry)).toBeUndefined();
  });
  it("renders only explicit pages without link crawling or discovery", () => {
    expect(themePrerenderOptions(snapshot(), registry)).toMatchObject({
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        failOnError: true,
        maxRedirects: 0,
      },
      pages: [{ path: "/landing", prerender: { enabled: true } }],
    });
  });
  it("refuses unproven and server-only route references", () => {
    const data = snapshot();
    delete data.documents[0]!.item.metadata;
    expect(() => themePrerenderOptions(data, registry)).toThrow(
      "SSG_DOCUMENT_ROUTE_REQUIRED",
    );
    data.documents[0]!.item.metadata = { routePath: "/api" };
    expect(() => themePrerenderOptions(data, registry)).toThrow(
      "SSG_ROUTE_UNSUPPORTED",
    );
  });
  it("never bakes component defaults instead of stored CMS content", () => {
    const data = snapshot();
    data.documents[0]!.document.sections = [
      {
        id: "hero",
        type: "hero",
        enabled: true,
        props: { title: "Published content" },
      },
    ];
    expect(() => themePrerenderOptions(data, registry)).toThrow(
      "SSG_CONTENT_NOT_CONNECTED",
    );
  });
});
