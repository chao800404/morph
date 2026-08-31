import { describe, expect, it } from "vitest";
import {
  buildThemeRouteRegistry,
  isThemeRouteSourcePath,
  parseThemeRouteSourcePath,
  themeRoutePathAfterFileMoves,
  themeRouteIdFromSourcePath,
  themeRoutePathFromSourcePath,
} from "./theme-route-registry";

describe("Theme route registry", () => {
  it("discovers static and dynamic TanStack routes without executing source", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content:
          'import { createRootRoute } from "@tanstack/react-router"; export const Route = createRootRoute({});',
      },
      {
        path: "src/routes/index.tsx",
        content:
          'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/")({ component: Home });',
      },
      {
        path: "src/routes/pages/$handle.tsx",
        content:
          'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/pages/$handle")({ component: Page });',
      },
    ]);

    expect(registry.diagnostics).toEqual([]);
    expect(registry.routes).toEqual([
      expect.objectContaining({
        kind: "root",
        sourcePath: "src/routes/__root.tsx",
      }),
      expect.objectContaining({
        path: "/",
        dynamic: false,
        componentName: "Home",
      }),
      expect.objectContaining({
        path: "/pages/$handle",
        dynamic: true,
        componentName: "Page",
      }),
    ]);
  });

  it("recognizes the generic createRootRouteWithContext factory shape", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: `
          import { createRootRouteWithContext } from "@tanstack/react-router";
          export const Route = createRootRouteWithContext<{ requestId: string }>()({
            component: Root,
          });
          function Root() { return null; }
        `,
      },
      {
        path: "src/routes/index.tsx",
        content: 'export const Route = createFileRoute("/")({});',
      },
    ]);

    expect(registry.valid).toBe(true);
    expect(registry.routes.find((route) => route.kind === "root")).toMatchObject({
      componentName: "Root",
    });
  });

  it("rejects a non-canonical root filename instead of diverging at build time", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/_root.tsx",
        content: "export const Route = createRootRoute({});",
      },
    ]);

    expect(registry.valid).toBe(false);
    expect(registry.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ROUTE_PATH",
          message: expect.stringContaining("__root.tsx"),
        }),
        expect.objectContaining({ code: "MISSING_ROOT_ROUTE" }),
      ]),
    );
  });

  it("fails closed for dynamic expressions, duplicate paths, and missing root", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/about.tsx",
        content: 'export const Route = createFileRoute("/about")({});',
      },
      {
        path: "src/routes/company.tsx",
        content: 'export const Route = createFileRoute("/about")({});',
      },
      {
        path: "src/routes/dynamic.tsx",
        content: "export const Route = createFileRoute(routePath)({});",
      },
    ]);

    expect(registry.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ROUTE_PATH",
        "INVALID_ROUTE_PATH",
        "MISSING_ROOT_ROUTE",
      ]),
    );
  });

  it("fails closed when tsr.config.json changes route discovery semantics", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "tsr.config.json",
        content: JSON.stringify({
          routesDirectory: "src/pages",
          indexToken: "home",
          routeToken: { regex: "layout" },
        }),
      },
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
    ]);

    expect(registry.valid).toBe(false);
    expect(
      registry.diagnostics.filter(
        (diagnostic) => diagnostic.code === "UNSUPPORTED_ROUTE_CONFIG",
      ),
    ).toHaveLength(3);
  });

  it("ignores route-internal and generated companion modules", () => {
    expect(isThemeRouteSourcePath("src/routes/-components/card.tsx")).toBe(
      false,
    );
    expect(isThemeRouteSourcePath("src/routes/.generated.tsx")).toBe(false);
    expect(isThemeRouteSourcePath("src/routes/[.]well-known.tsx")).toBe(true);
    expect(isThemeRouteSourcePath("src/routes/about.lazy.tsx")).toBe(false);
    expect(isThemeRouteSourcePath("src/routes/about.tsx")).toBe(true);
    expect(isThemeRouteSourcePath("src/pages/about.tsx")).toBe(false);
  });

  it("maps file-route names to their TanStack route paths", () => {
    expect(themeRoutePathFromSourcePath("src/routes/__root.tsx")).toBe("/");
    expect(themeRoutePathFromSourcePath("src/routes/index.tsx")).toBe("/");
    expect(themeRoutePathFromSourcePath("src/routes/about.tsx")).toBe("/about");
    expect(themeRoutePathFromSourcePath("src/routes/blog/index.tsx")).toBe(
      "/blog",
    );
    expect(themeRoutePathFromSourcePath("src/routes/blog/$slug.tsx")).toBe(
      "/blog/$slug",
    );
    expect(
      themeRoutePathFromSourcePath("src/routes/-components/card.tsx"),
    ).toBe(null);
  });

  it("maps the active pathname to a moved route after Code Mode renames it", () => {
    expect(
      themeRoutePathAfterFileMoves("/product", [
        {
          from: "src/routes/product.tsx",
          to: "src/routes/catalog.tsx",
        },
      ]),
    ).toBe("/catalog");
    expect(
      themeRoutePathAfterFileMoves("/product", [
        {
          from: "src/components/product.tsx",
          to: "src/components/catalog.tsx",
        },
      ]),
    ).toBe(null);
  });

  it("fails closed when a route-directory source does not declare a route", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/about.tsx",
        content: "export default function About() { return null; }",
      },
    ]);

    expect(registry.valid).toBe(false);
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({ code: "UNDECLARED_ROUTE_MODULE" }),
    ]);
  });

  it("matches TanStack flat-file, pathless, non-nested, splat, and escaped-dot names", () => {
    expect(
      parseThemeRouteSourcePath("src/routes/posts.$postId.tsx"),
    ).toMatchObject({
      path: "/posts/$postId",
      routeId: "/posts/$postId",
      isSplat: false,
    });
    expect(
      parseThemeRouteSourcePath("src/routes/posts.index.tsx"),
    ).toMatchObject({
      path: "/posts",
      fullPath: "/posts/",
      routeId: "/posts/",
      isIndex: true,
    });
    expect(
      parseThemeRouteSourcePath("src/routes/_marketing.about.tsx"),
    ).toMatchObject({
      path: "/about",
      isPathless: false,
    });
    expect(
      parseThemeRouteSourcePath("src/routes/_marketing.tsx"),
    ).toMatchObject({
      path: "/",
      isPathless: true,
      routeType: "pathless_layout",
    });
    expect(
      parseThemeRouteSourcePath("src/routes/posts_.$postId.deep.tsx"),
    ).toMatchObject({
      path: "/posts/$postId/deep",
      isNonNested: true,
    });
    expect(parseThemeRouteSourcePath("src/routes/files/$.tsx")).toMatchObject({
      path: "/files/$",
      isSplat: true,
    });
    expect(
      parseThemeRouteSourcePath("src/routes/docs/{-$section}.tsx"),
    ).toMatchObject({
      path: "/docs/{-$section}",
      routeId: "/docs/{-$section}",
      isSplat: false,
    });
    expect(parseThemeRouteSourcePath("src/routes/files/[$].tsx")).toMatchObject(
      {
        path: "/files/$",
        isSplat: false,
        invalidEscapeCharacter: "$",
      },
    );
    expect(
      parseThemeRouteSourcePath("src/routes/posts/route.tsx"),
    ).toMatchObject({
      path: "/posts",
      routeType: "layout",
    });
    expect(
      parseThemeRouteSourcePath("src/routes/_marketing/route.tsx"),
    ).toMatchObject({
      path: "/",
      routeType: "pathless_layout",
      isPathless: true,
    });
    expect(themeRoutePathFromSourcePath("src/routes/my-script[.]js.tsx")).toBe(
      "/my-script.js",
    );
    expect(themeRouteIdFromSourcePath("src/routes/posts.index.tsx")).toBe(
      "/posts/",
    );
  });

  it("preserves escaped leading and trailing underscores like TanStack's generator", () => {
    expect(parseThemeRouteSourcePath("src/routes/[_marketing].tsx")).toMatchObject({
      path: "/_marketing",
      routeId: "/_marketing",
      isPathless: false,
      isNonNested: false,
    });
    expect(parseThemeRouteSourcePath("src/routes/[_]marketing.tsx")).toMatchObject({
      path: "/_marketing",
      routeId: "/_marketing",
      isPathless: false,
      isNonNested: false,
    });
    expect(parseThemeRouteSourcePath("src/routes/blog[_].tsx")).toMatchObject({
      path: "/blog_",
      routeId: "/blog_",
      isNonNested: false,
    });
    expect(parseThemeRouteSourcePath("src/routes/blog_.tsx")).toMatchObject({
      path: "/blog",
      routeId: "/blog_",
      isNonNested: true,
    });
  });

  it("rejects bracket escapes that TanStack's generator disallows", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/files/[$].tsx",
        content: 'export const Route = createFileRoute("/files/$")({});',
      },
    ]);

    expect(registry.valid).toBe(false);
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({
        code: "INVALID_ROUTE_PATH",
        sourcePath: "src/routes/files/[$].tsx",
        message: expect.stringContaining('disallowed character "$"'),
      }),
    ]);
  });

  it("rejects a route-group file used as a configuration route", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/(marketing).tsx",
        content: 'export const Route = createFileRoute("/(marketing)")({});',
      },
    ]);

    expect(registry.valid).toBe(false);
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({
        code: "INVALID_ROUTE_PATH",
        sourcePath: "src/routes/(marketing).tsx",
        message: expect.stringContaining("cannot be a route configuration"),
      }),
    ]);
  });

  it("resolves parents from file segments instead of URL prefixes", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/posts.tsx",
        content: 'export const Route = createFileRoute("/posts")({});',
      },
      {
        path: "src/routes/posts.$postId.tsx",
        content: 'export const Route = createFileRoute("/posts/$postId")({});',
      },
      {
        path: "src/routes/_marketing.tsx",
        content: 'export const Route = createFileRoute("/_marketing")({});',
      },
      {
        path: "src/routes/_marketing.about.tsx",
        content:
          'export const Route = createFileRoute("/_marketing/about")({});',
      },
      {
        path: "src/routes/posts_.$postId.deep.tsx",
        content:
          'export const Route = createFileRoute("/posts_/$postId/deep")({});',
      },
    ]);

    expect(registry.valid).toBe(true);
    expect(
      registry.routes.find((route) =>
        route.sourcePath.endsWith("posts.$postId.tsx"),
      ),
    ).toMatchObject({
      parentSourcePath: "src/routes/posts.tsx",
    });
    expect(
      registry.routes.find((route) =>
        route.sourcePath.endsWith("_marketing.about.tsx"),
      ),
    ).toMatchObject({
      parentSourcePath: "src/routes/_marketing.tsx",
    });
    expect(
      registry.routes.find((route) =>
        route.sourcePath.endsWith("posts_.$postId.deep.tsx"),
      ),
    ).toMatchObject({
      parentSourcePath: "src/routes/__root.tsx",
    });
  });

  it("associates route pieces and creates an anchor for a lazy-only route", () => {
    const registry = buildThemeRouteRegistry([
      {
        path: "src/routes/__root.tsx",
        content: "export const Route = createRootRoute({});",
      },
      {
        path: "src/routes/about.tsx",
        content: 'export const Route = createFileRoute("/about")({});',
      },
      {
        path: "src/routes/about.lazy.tsx",
        content: 'export const Route = createLazyFileRoute("/about")({});',
      },
      {
        path: "src/routes/about.loader.tsx",
        content: "export const loader = () => ({ title: 'About' });",
      },
      {
        path: "src/routes/contact.lazy.tsx",
        content: 'export const Route = createLazyFileRoute("/contact")({});',
      },
    ]);

    expect(registry.valid).toBe(true);
    expect(
      registry.routes.find((route) => route.path === "/about"),
    ).toMatchObject({
      sourcePath: "src/routes/about.tsx",
      routePieces: {
        lazy: "src/routes/about.lazy.tsx",
        loader: "src/routes/about.loader.tsx",
      },
    });
    expect(
      registry.routes.find((route) => route.path === "/contact"),
    ).toMatchObject({
      sourcePath: "src/routes/contact.lazy.tsx",
      isVirtual: true,
      routePieces: { lazy: "src/routes/contact.lazy.tsx" },
    });
  });
});
