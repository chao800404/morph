// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { transformSync } from "esbuild";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  STARTER_THEME_V3_NEW_FILES,
  STARTER_THEME_V4_NEW_FILES,
} from "@/lib/storefront/starter-theme-v3-files";
import { DEFAULT_APPROVED_DEPENDENCIES } from "@/lib/storefront/compiler/sandbox-vite-theme-build-runner.types";

/**
 * Does the editor's interpreter render what React renders?
 *
 * Live Preview interprets Theme source; Build Preview compiles and runs it.
 * Both are legitimate — one has to be instant, the other has to be the truth —
 * but the editor is only trustworthy while the two agree about the DOM. Every
 * divergence found by hand so far (an unsupported call, a module the
 * interpreter had to model itself) showed up as a Live Preview that was wrong
 * about a page the build rendered correctly.
 *
 * This compares the two for the starter Theme's own components, so a gap is a
 * failing test rather than something to be discovered in a browser.
 */

// Later definitions win: the versioned sets replace files the base set also
// carries, and two copies of one route would be a duplicate declaration rather
// than an upgrade.
const files = Array.from(
  new Map(
    [
      ...STARTER_THEME_FILES,
      ...STARTER_THEME_V3_NEW_FILES,
      ...STARTER_THEME_V4_NEW_FILES,
    ].map((file) => [
      file.path,
      { path: file.path, content: file.content },
    ]),
  ).values(),
);

/** Attributes the editor injects for its own use; the build never emits them. */
const EDITOR_ATTRIBUTE = /\s(?:data-(?:morph|storefront|tsd)-[a-z-]+)="[^"]*"/g;

function normalize(html: string): string {
  return html
    // Head output is the router's job, not the interpreter's: Live Preview
    // renders into an existing document and has no head to write to.
    .replace(/<link[^>]*>|<meta[^>]*>|<title>[\s\S]*?<\/title>/g, "")
    .replace(EDITOR_ATTRIBUTE, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Renders a component the way the build does: real TSX, real React.
 *
 * Compiled in process rather than through a temp directory so the comparison
 * has no filesystem or bundler state of its own to go stale.
 */
const moduleCache = new Map<string, Record<string, unknown>>();
const hostRequire = createRequire(import.meta.url);
const approved = new Set(DEFAULT_APPROVED_DEPENDENCIES);
const preloadedPackages = new Map<string, unknown>();

/** Imports ESM-only approved packages so the module loader can hand them over. */
async function preloadPackages(ids: readonly string[]) {
  for (const id of ids) {
    if (!preloadedPackages.has(id)) {
      preloadedPackages.set(id, await import(/* @vite-ignore */ id));
    }
  }
}

/** Resolves a relative import the way a bundler would, without a bundler. */
function resolveRelative(fromPath: string, specifier: string): string {
  const segments = fromPath.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    else if (part === "..") segments.pop();
    else segments.push(part);
  }
  const base = segments.join("/");
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`]) {
    if (files.some((file) => file.path === candidate)) return candidate;
  }
  return `${base}.tsx`;
}

/**
 * Loads a Theme module and everything it imports, compiled in process.
 *
 * A temp directory and a real bundler would answer the same question, but with
 * filesystem and cache state of their own — and a parity check has to be able
 * to blame the interpreter, not the harness.
 */
function loadModule(sourcePath: string): Record<string, unknown> {
  const cached = moduleCache.get(sourcePath);
  if (cached) return cached;

  const source = files.find((file) => file.path === sourcePath);
  if (!source) throw new Error(`${sourcePath} is not part of the starter Theme`);
  // A stylesheet import contributes nothing to the rendered markup, and the
  // build resolves it through Tailwind rather than through this module graph.
  if (sourcePath.endsWith(".css")) {
    const empty = {};
    moduleCache.set(sourcePath, empty);
    return empty;
  }

  const { code } = transformSync(source.content, {
    loader: sourcePath.endsWith(".ts") ? "ts" : "tsx",
    jsx: "automatic",
    format: "cjs",
    target: "es2022",
  });

  const module = { exports: {} as Record<string, unknown> };
  moduleCache.set(sourcePath, module.exports);
  const require = (id: string) => {
    if (id.endsWith(".css")) return {};
    if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime") {
      return jsxRuntime;
    }
    if (id.startsWith(".")) return loadModule(resolveRelative(sourcePath, id));
    // Some approved packages ship ESM only and cannot be required at all, so
    // they are imported ahead of time and handed over here.
    const preloaded = preloadedPackages.get(id);
    if (preloaded) return preloaded;
    // Approved packages are resolved for real, exactly as the build resolves
    // them: a Theme may only import from that list, so anything else reaching
    // here is a package the build would have rejected too.
    if (approved.has(id)) return hostRequire(id);
    throw new Error(
      `${sourcePath} imports ${id}, which this comparison does not model`,
    );
  };
  new Function("exports", "module", "require", code)(
    module.exports,
    module,
    require,
  );
  moduleCache.set(sourcePath, module.exports);
  return module.exports;
}

function renderWithReact(
  sourcePath: string,
  props: Record<string, unknown>,
): string {
  return renderToStaticMarkup(
    createElement(
      loadModule(sourcePath).default as React.ComponentType<
        Record<string, unknown>
      >,
      props,
    ),
  );
}

/** Renders a component the way Live Preview does: through the interpreter. */
function renderWithInterpreter(
  sourcePath: string,
  props: Record<string, unknown>,
): string {
  const result = renderSafeThemeComponent({ files, sourcePath, props });
  if (!result.success) {
    throw new Error(
      `interpreter refused ${sourcePath}: ${result.diagnostics.join("; ")}`,
    );
  }
  return renderToStaticMarkup(result.node as never);
}

/** Single-file components: everything the starter Theme renders on its own. */
const SELF_CONTAINED_COMPONENTS: ReadonlyArray<
  readonly [string, Record<string, unknown>]
> = [
  ["src/components/Hero.tsx", {}],
  ["src/components/Hero.tsx", { heading: "Authored", eyebrow: "New" }],
  ["src/components/EditorialIntro.tsx", {}],
  ["src/components/CategoryShowcase.tsx", {}],
  ["src/components/ImageWithText.tsx", {}],
  ["src/components/Newsletter.tsx", {}],
  // Renders a child component once per item, which is where the interpreter
  // does its least mechanical work: a component boundary inside a map.
  ["src/components/Principles.tsx", {}],
  ["src/components/Header.tsx", { storeName: "Online Store" }],
  ["src/components/Footer.tsx", { storeName: "Online Store" }],
];

describe("interpreter and React render the same DOM", () => {
  for (const [sourcePath, props] of SELF_CONTAINED_COMPONENTS) {
    const label = sourcePath.split("/").pop();
    const propsLabel = Object.keys(props).length ? " with props" : " with defaults";

    it(`${label}${propsLabel}`, () => {
      const fromReact = normalize(renderWithReact(sourcePath, props));
      const fromInterpreter = normalize(
        renderWithInterpreter(sourcePath, props),
      );

      // Guards the comparison itself: normalisation that stripped everything
      // would make every component "match" and the suite would prove nothing.
      expect(fromReact.length).toBeGreaterThan(120);
      expect(fromReact).toContain("class=");

      expect(fromInterpreter).toBe(fromReact);
    });
  }
});

/**
 * Builds a router from a tree assembled at runtime.
 *
 * The router's generic types are written for a route tree the build generates
 * and register into the library's own module declaration. This tree is put
 * together here from the Theme's exported options instead, so the constructor
 * is called through an untyped view rather than reshaping the test around
 * codegen it does not use.
 */
const buildRuntimeRouter = createRouter as unknown as (options: {
  routeTree: unknown;
  history: unknown;
}) => { load: () => Promise<void> };

describe("interpreter and the real router agree about a whole route", () => {
  /**
   * Renders the starter Theme's home route through a real TanStack Router.
   *
   * The Theme's own router module imports a route tree the build generates, so
   * the tree is rebuilt here from the routes' own exported options. Everything
   * that matters still runs for real: `beforeLoad`, the isomorphic content
   * loader it calls, the React context that carries the result, and `Outlet`.
   * Those are the pieces the interpreter has to model, and the pieces every
   * gap found by hand so far has been in.
   */
  async function renderThroughRouter(): Promise<string> {
    await preloadPackages([
      "@tanstack/react-router",
      "@tanstack/react-start",
      "@tanstack/react-start/server",
    ]);

    const root = loadModule("src/routes/__root.tsx") as {
      Route: { options: Record<string, unknown> };
    };
    const home = loadModule("src/routes/index.tsx") as {
      Route: { options: Record<string, unknown> };
    };

    const rootRoute = createRootRoute({
      component: root.Route.options.component as never,
      beforeLoad: root.Route.options.beforeLoad as never,
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute as never,
      path: "/",
      component: home.Route.options.component as never,
    });
    const router = buildRuntimeRouter({
      routeTree: rootRoute.addChildren([homeRoute as never]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();

    return renderToStaticMarkup(
      createElement(RouterProvider as never, { router } as never),
    );
  }

  it("renders the home route identically", async () => {
    const fromRouter = normalize(await renderThroughRouter());

    // No authored content on either side: the router's loader has no request
    // to fetch content with, so both render the components' own defaults —
    // which is the only comparison where neither side is being simulated.
    const interpreted = renderSafeThemeRoute({
      files,
      pathname: "/",
      document: { version: 1, sections: [] } as never,
    });
    expect(
      interpreted.success,
      interpreted.success ? "" : interpreted.diagnostics.join("; "),
    ).toBe(true);
    if (!interpreted.success) return;

    const fromInterpreter = normalize(
      renderToStaticMarkup(interpreted.node as never),
    );

    expect(fromRouter.length).toBeGreaterThan(1_000);
    expect(fromInterpreter).toBe(fromRouter);
  });
});

