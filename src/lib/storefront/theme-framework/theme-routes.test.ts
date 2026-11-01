import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { astroRouteRegistry } from "../compiler/astro-route-registry";
import { buildThemeRouteRegistry } from "../compiler/theme-route-registry";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { astroFramework } from "./astro.framework";
import { tanstackStartFramework } from "./tanstack-start.framework";
import { THEME_FRAMEWORK_IDS } from "./theme-framework.types";
import { THEME_FRAMEWORK_ROUTES, themeRoutesFor } from "./theme-routes";

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

describe("the route dispatch module", () => {
  const read = (relative: string) =>
    readFileSync(path.join(here, relative), "utf8");
  const importsOf = (source: string) =>
    [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]).sort();

  it("imports only the two route readers and the framework ids", () => {
    // Client-safe: the editor may import it, so it must not pull in either
    // adapter's preview or build planners.
    expect(importsOf(read("theme-routes.ts"))).toEqual([
      "../compiler/astro-route-registry",
      "../compiler/theme-route-registry",
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
