import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { astroRouteRegistry } from "../compiler/astro-route-registry";
import {
  buildThemeRouteRegistry,
  parseThemeRouteSourcePath,
} from "../compiler/theme-route-registry";
import { contentTargetForRoutePath } from "../theme-template-routes";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { astroFramework } from "./astro.framework";
import { tanstackStartFramework } from "./tanstack-start.framework";
import { THEME_FRAMEWORK_IDS } from "./theme-framework.types";
import {
  THEME_FRAMEWORK_ROUTES,
  routeSourceContentTarget,
  routeSourcePathInfo,
  themeRoutePathAfterFileMovesFor,
  themeRoutesFor,
} from "./theme-routes";

const here = path.dirname(new URL(import.meta.url).pathname);

const ASTRO_PAGES = [
  { path: "astro.config.mjs", content: "export default {};" },
  { path: "src/pages/index.astro", content: "<h1>Home</h1>" },
  { path: "src/pages/about.astro", content: "<h1>About</h1>" },
  { path: "src/pages/blog/[slug].astro", content: "<h1>Post</h1>" },
];
// Astro's pages beside the Starter's Start routes, as the Astro E2E
// workspaces are: only the record can say which ones are the Theme's.
const HYBRID = [...STARTER_THEME_FILES, ...ASTRO_PAGES];

const paths = (result: ReturnType<typeof themeRoutesFor>) =>
  result.ok ? result.registry.routes.map((route) => route.path).sort() : null;

describe("themeRoutesFor", () => {
  it("reads an unrecorded Theme's routes as Start's", () => {
    for (const recorded of [null, undefined]) {
      const result = themeRoutesFor(recorded, HYBRID);
      expect(result.ok && result.framework).toBe("tanstack-start");
      expect(result.ok && result.registry).toEqual(
        buildThemeRouteRegistry(HYBRID),
      );
    }
  });

  it("reads a Start Theme's routes from src/routes/ only", () => {
    const result = themeRoutesFor("tanstack-start", HYBRID);
    expect(result.ok && result.framework).toBe("tanstack-start");
    expect(result.ok && result.registry.valid).toBe(true);
    expect(paths(result)).toEqual(
      buildThemeRouteRegistry(STARTER_THEME_FILES)
        .routes.map((route) => route.path)
        .sort(),
    );
    expect(paths(result)).not.toContain("/about");
  });

  it("reads an Astro Theme's routes from src/pages/ only", () => {
    const result = themeRoutesFor("astro", HYBRID);
    expect(result.ok && result.framework).toBe("astro");
    expect(result.ok && result.registry).toEqual(astroRouteRegistry(HYBRID));
    expect(paths(result)).toEqual(["/", "/about", "/blog/[slug]"]);
  });

  it("refuses a framework Morph does not know, never reading it as Start", () => {
    for (const recorded of ["nuxt", "", "Astro", "tanstack-start "]) {
      expect(themeRoutesFor(recorded, HYBRID)).toEqual({
        ok: false,
        code: "THEME_FRAMEWORK_UNKNOWN",
        framework: recorded,
      });
    }
  });

  it("has a route reader for every framework id", () => {
    expect(Object.keys(THEME_FRAMEWORK_ROUTES).sort()).toEqual(
      [...THEME_FRAMEWORK_IDS].sort(),
    );
  });
});

describe("the adapters' route registries", () => {
  it("are the same table's, with Start's null for routes it cannot read", () => {
    expect(astroFramework.build.native.routeRegistry).toBe(
      THEME_FRAMEWORK_ROUTES.astro,
    );
    expect(astroFramework.build.native.routeRegistry(HYBRID)).toEqual(
      astroRouteRegistry(HYBRID),
    );
    expect(tanstackStartFramework.build.native.routeRegistry(HYBRID)).toEqual(
      buildThemeRouteRegistry(HYBRID),
    );
    // A pure Astro workspace has no Start root route: invalid, so null.
    expect(buildThemeRouteRegistry(ASTRO_PAGES).valid).toBe(false);
    expect(tanstackStartFramework.build.native.routeRegistry(ASTRO_PAGES)).toBe(
      null,
    );
  });
});

describe("the editor's page after files are moved in Code", () => {
  const move = (from: string, to: string) => [{ from, to }];

  it("follows an Astro page renamed or moved within src/pages", () => {
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        "/about",
        move("src/pages/about.astro", "src/pages/company.astro"),
      ),
    ).toBe("/company");
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        "/about",
        move("src/pages/about.astro", "src/pages/company/index.astro"),
      ),
    ).toBe("/company");
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        "/",
        move("src/pages/index.astro", "src/pages/home.astro"),
      ),
    ).toBe("/home");
  });

  it("leaves the editor where it is when another file moved, or the page did not change", () => {
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        "/about",
        move("src/pages/contact.astro", "src/pages/reach.astro"),
      ),
    ).toBe(null);
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        "/about",
        move("src/pages/about.astro", "src/pages/about/index.astro"),
      ),
    ).toBe(null);
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        "/about",
        move("src/components/Hero.astro", "src/components/Banner.astro"),
      ),
    ).toBe(null);
    expect(
      themeRoutePathAfterFileMovesFor(
        "astro",
        undefined,
        move("src/pages/about.astro", "src/pages/company.astro"),
      ),
    ).toBe(null);
  });

  it("does not follow an Astro page into something that is no page to stand on", () => {
    for (const to of [
      "src/pages/[slug].astro",
      "src/pages/about.ts",
      "src/pages/_about.astro",
      "src/components/about.astro",
    ]) {
      expect(
        themeRoutePathAfterFileMovesFor(
          "astro",
          "/about",
          move("src/pages/about.astro", to),
        ),
      ).toBe(null);
    }
  });

  it("reads a Start route file only for a Start Theme, and a src/pages file only for Astro", () => {
    const startMove = move("src/routes/product.tsx", "src/routes/catalog.tsx");
    for (const recorded of [null, undefined, "tanstack-start"]) {
      expect(
        themeRoutePathAfterFileMovesFor(recorded, "/product", startMove),
      ).toBe("/catalog");
    }
    expect(themeRoutePathAfterFileMovesFor("astro", "/product", startMove)).toBe(
      null,
    );
    expect(
      themeRoutePathAfterFileMovesFor(
        "tanstack-start",
        "/about",
        move("src/pages/about.astro", "src/pages/company.astro"),
      ),
    ).toBe(null);
  });

  it("never moves the editor for a framework it does not know", () => {
    expect(
      themeRoutePathAfterFileMovesFor(
        "svelte-kit",
        "/product",
        move("src/routes/product.tsx", "src/routes/catalog.tsx"),
      ),
    ).toBe(null);
  });
});

describe("the route dispatch module", () => {
  const read = (relative: string) =>
    readFileSync(path.join(here, relative), "utf8");
  const importsOf = (source: string) =>
    [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).sort();

  it("imports only the two route readers, the content-target rule and the framework ids", () => {
    // Client-safe: the editor may import it, so it must not pull in either
    // adapter's preview or build planners. The content-target rule
    // (theme-template-routes, pure) is the one the Astro registry already
    // imports; route Document moves read it through here (D7).
    expect(importsOf(read("theme-routes.ts"))).toEqual([
      "../compiler/astro-route-registry",
      "../compiler/theme-route-registry",
      "../theme-template-routes",
      "./theme-framework.types",
    ]);
    const astro = read("../compiler/astro-route-registry.ts");
    expect(importsOf(astro)).toEqual([
      "../theme-template-routes",
      "./theme-route-registry",
    ]);
    // The registry module only for its types.
    expect(astro).toMatch(
      /import type \{[^}]*\} from "\.\/theme-route-registry"/,
    );
  });
});

describe("a source file as a route of the recorded framework (D7)", () => {
  const START_PATHS = [
    "src/routes/index.tsx",
    "src/routes/about.tsx",
    "src/routes/about.lazy.tsx",
    "src/routes/__root.tsx",
    "src/routes/posts.$postId.tsx",
    "src/routes/company/about.tsx",
    "src/routes/_layout.tsx",
    "src/pages/about.astro",
    "src/components/Hero.tsx",
  ];

  it("reads Start's files exactly as TanStack Router's convention, for Start and a Theme recording none", () => {
    for (const recorded of [null, undefined, "tanstack-start"]) {
      for (const path of START_PATHS) {
        const metadata = parseThemeRouteSourcePath(path);
        expect(
          routeSourcePathInfo(recorded, path),
          `${recorded} ${path}`,
        ).toEqual(
          metadata
            ? {
                routePath: metadata.path,
                standalone: !metadata.isRoutePiece,
                root: metadata.routeType === "root",
                dynamic: false,
              }
            : null,
        );
      }
    }
  });

  it("reads an Astro Theme's pages from src/pages only, as its registry does", () => {
    expect(routeSourcePathInfo("astro", "src/pages/about.astro")).toEqual({
      routePath: "/about",
      standalone: true,
      root: false,
      dynamic: false,
    });
    expect(routeSourcePathInfo("astro", "src/pages/index.astro")).toMatchObject(
      {
        routePath: "/",
      },
    );
    expect(
      routeSourcePathInfo("astro", "src/pages/blog/[slug].astro"),
    ).toMatchObject({
      routePath: "/blog/[slug]",
      dynamic: true,
    });
    expect(routeSourcePathInfo("astro", "src/pages/api.ts")).toMatchObject({
      standalone: false,
    });
    // Start's files are not an Astro Theme's routes, whatever they hold.
    expect(routeSourcePathInfo("astro", "src/routes/about.tsx")).toBeNull();
    expect(routeSourcePathInfo("astro", "src/pages/_draft.astro")).toBeNull();
  });

  it("reads no route for a framework Morph does not know", () => {
    expect(routeSourcePathInfo("next", "src/routes/about.tsx")).toBeNull();
    expect(routeSourcePathInfo("next", "src/pages/about.astro")).toBeNull();
  });

  it("refuses a dynamic Astro page a Document before the static-path rule, which would call it static", () => {
    const info = routeSourcePathInfo("astro", "src/pages/blog/[slug].astro")!;
    expect(contentTargetForRoutePath(info.routePath).kind).toBe("route");
    expect(routeSourceContentTarget(info).kind).toBe("unsupported");
    expect(
      routeSourceContentTarget(
        routeSourcePathInfo("astro", "src/pages/about.astro")!,
      ),
    ).toEqual({ kind: "route", routePath: "/about" });
  });

  it("leaves Start's targets to contentTargetForRoutePath, unchanged", () => {
    for (const path of START_PATHS) {
      const info = routeSourcePathInfo(null, path);
      if (!info) continue;
      expect(routeSourceContentTarget(info)).toEqual(
        contentTargetForRoutePath(info.routePath),
      );
    }
  });
});
