// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as reactRouter from "@tanstack/react-router";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import {
  createThemeModuleLoader,
  normalizeThemeMarkup as normalize,
} from "@/lib/test-utils/theme-module-loader";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { createDefaultStorefrontHomeDocument } from "@/lib/storefront/default-storefront-document";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  LIVE_PREVIEW_START_PACKAGES,
  withLivePreviewContent,
} from "@/lib/test-utils/live-preview-render";
import {
  STARTER_THEME_V3_NEW_FILES,
  STARTER_THEME_V4_NEW_FILES,
} from "@/lib/storefront/starter-theme-v3-files";

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
    ].map((file) => [file.path, { path: file.path, content: file.content }]),
  ).values(),
);

// Handed the harness's own router rather than letting the loader resolve one:
// `<Link>` reads the router from React context, and a second copy of the
// library would leave that context empty however the provider is set up.
const { loadModule } = createThemeModuleLoader(files, {
  packages: { "@tanstack/react-router": reactRouter },
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

/**
 * Renders a component the way the build does: real TSX, real React.
 *
 * Compiled in process rather than through a temp directory so the comparison
 * has no filesystem or bundler state of its own to go stale.
 */
async function renderWithReact(
  sourcePath: string,
  props: Record<string, unknown>,
): Promise<string> {
  const Component = loadModule(sourcePath).default as React.ComponentType<
    Record<string, unknown>
  >;
  // Rendered inside a router, because a component is free to use one. A theme
  // that sends an in-store destination through `<Link>` is doing the ordinary
  // thing, and a harness that could not render that would simply stop covering
  // the components most worth covering.
  const rootRoute = createRootRoute({
    component: () => createElement(Component, props),
  });
  const router = buildRuntimeRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(
    createElement(RouterProvider as never, { router } as never),
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
    const propsLabel = Object.keys(props).length
      ? " with props"
      : " with defaults";

    it(`${label}${propsLabel}`, async () => {
      const fromReact = normalize(await renderWithReact(sourcePath, props));
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
   *
   * The content module reads through `@morph/sdk/start` and a
   * `createServerFn`. The router side gets the Live Preview harness's
   * stand-ins for those (`LIVE_PREVIEW_START_PACKAGES`), which read `document`
   * as the preview serves `/_morph/content`; the interpreter is handed the same
   * Document. Both sides render the same authored content.
   */
  const routerLoader = createThemeModuleLoader(files, {
    packages: {
      "@tanstack/react-router": reactRouter,
      ...LIVE_PREVIEW_START_PACKAGES,
    },
  });

  async function renderThroughRouter(
    document: StorefrontPageDocument,
  ): Promise<string> {
    const { loadModule } = routerLoader;
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
    return withLivePreviewContent({ index: document }, undefined, async () => {
      const router = buildRuntimeRouter({
        routeTree: rootRoute.addChildren([homeRoute as never]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
      });
      await router.load();

      return renderToStaticMarkup(
        createElement(RouterProvider as never, { router } as never),
      );
    });
  }

  /**
   * The Starter's home Document with one authored heading: stored values on
   * every section, so the comparison covers content reaching the components,
   * not only the components' defaults.
   */
  const AUTHORED_HEADING = "Parity: an authored heading";
  function authoredHomeDocument(): StorefrontPageDocument {
    const document = createDefaultStorefrontHomeDocument();
    return {
      ...document,
      sections: document.sections.map((section) =>
        section.id === "starter-hero"
          ? {
              ...section,
              props: { ...section.props, heading: AUTHORED_HEADING },
            }
          : section,
      ),
    };
  }

  it("renders the home route identically", async () => {
    const document = authoredHomeDocument();
    const fromRouter = normalize(await renderThroughRouter(document));

    const interpreted = renderSafeThemeRoute({
      files,
      pathname: "/",
      document,
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
    // Guards the comparison itself: the router side really read the Document
    // (the authored heading, and the Document's newsletter copy rather than
    // the component's default "Join our newsletter"), so a match is about
    // content, not two sets of defaults.
    expect(fromRouter).toContain(AUTHORED_HEADING);
    expect(fromRouter).toContain("A quieter kind of inbox.");
    expect(fromRouter).not.toContain("Join our newsletter");
    expect(fromInterpreter).toBe(fromRouter);
  });
});
