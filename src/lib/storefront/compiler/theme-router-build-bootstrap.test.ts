import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { createThemeBuildBootstrap } from "./theme-router-build-bootstrap";

describe("Theme router build bootstrap", () => {
  it("generates a temporary route tree for TanStack Start theme sources", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: ["src/styles/global.css"],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({
            entry: "src/routes/index.tsx",
            router: { framework: "tanstack-start" },
          }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    });

    expect(result.routeRegistry?.valid).toBe(true);
    expect(result.content).toContain("createRouter");
    expect(result.content).toContain("rootRouteImport.addChildren([route0])");
    expect(result.content).toContain('import "./src/styles/global.css"');
    expect(result.content).not.toContain(
      'import "./src/morph/preview-content"',
    );
  });

  it("installs the preview request bridge before route loaders run", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      exposeRouterForPreview: true,
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    });

    const setup = result.content.indexOf(
      'import "./src/morph/preview-content"',
    );
    const route = result.content.indexOf('from "./src/routes/index.tsx"');
    expect(setup).toBeGreaterThan(-1);
    expect(setup).toBeLessThan(route);
  });

  it("updates authored route modules through the existing preview router", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      exposeRouterForPreview: true,
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    });

    expect(result.content).toContain("import.meta.hot.accept(");
    expect(result.content).toContain(
      '["./src/routes/__root.tsx","./src/routes/index.tsx"]',
    );
    expect(result.content).toContain(
      'preserve: ["id","path","getParentRoute"]',
    );
    expect(result.content).toContain(
      "current.options = { ...nextRoute.options, ...preserved }",
    );
    expect(result.content).toContain("await router.invalidate({ sync: true })");
    expect(result.content).not.toContain("window.location.reload");
    expect(() =>
      parse(result.content, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
      }),
    ).not.toThrow();
  });

  it("does not ship preview route HMR in an immutable build", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    });

    expect(result.content).not.toContain("__morphPreviewHotRoutes");
    expect(result.content).not.toContain("import.meta.hot.accept");
  });

  it("retains the legacy component bootstrap for themes without router metadata", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/pages/index.tsx",
      cssFiles: [],
      files: [],
    });
    expect(result.routeRegistry).toBeNull();
    expect(result.content).toContain(
      'import EntryComponent from "./src/pages/index.tsx"',
    );
  });

  it("preserves nested route parent layout composition in the generated tree", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/blog.tsx",
          content: 'export const Route = createFileRoute("/blog")({});',
        },
        {
          path: "src/routes/blog/$slug.tsx",
          content: 'export const Route = createFileRoute("/blog/$slug")({});',
        },
      ],
    });

    expect(result.content).toContain("getParentRoute: () => route0");
    expect(result.content).toContain('path: "/$slug"');
    expect(result.content).toContain(
      "rootRouteImport.addChildren([route0.addChildren([route1])])",
    );
  });

  it("supports flat-file index, pathless layout, and splat routes", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/posts.tsx",
          content: 'export const Route = createFileRoute("/posts")({});',
        },
        {
          path: "src/routes/posts.index.tsx",
          content: 'export const Route = createFileRoute("/posts")({});',
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
          path: "src/routes/files/$.tsx",
          content: 'export const Route = createFileRoute("/files/$")({});',
        },
      ],
    });

    expect(result.routeRegistry?.valid).toBe(true);
    expect(result.content).toContain('path: "/files/$"');
    // The pathless layout is a real parent node but contributes no URL path.
    expect(result.content).toMatch(/id: "\/_marketing",\n\s*getParentRoute/);
    expect(result.content).toContain('id: "/",\n  path: "/"');
  });

  it("wires route pieces into the temporary tree like TanStack's generator", () => {
    const result = createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
        {
          path: "src/routes/index.lazy.tsx",
          content: 'export const Route = createLazyFileRoute("/")({});',
        },
        {
          path: "src/routes/index.loader.tsx",
          content: "export const loader = () => ({ title: 'Home' });",
        },
        {
          path: "src/routes/contact.lazy.tsx",
          content: 'export const Route = createLazyFileRoute("/contact")({});',
        },
      ],
    });

    expect(result.content).toContain("lazyFn");
    expect(result.content).toContain('import("./src/routes/index.loader")');
    expect(result.content).toContain(
      '.lazy(() => import("./src/routes/index.lazy")',
    );
    expect(result.content).toContain(
      'createFileRoute("/contact")({}).update({',
    );
    expect(result.content).toContain(
      '.lazy(() => import("./src/routes/contact.lazy").then((module) => module.Route))',
    );
  });
});

describe("preview router history", () => {
  const bootstrap = () =>
    createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({
            entry: "src/routes/index.tsx",
            router: { framework: "tanstack-start" },
          }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    });

  it("resolves Theme routes from the site root, not the preview URL", () => {
    // The preview iframe loads /preview-build/<buildId>/<token>/, so browser
    // history would hand that path to the router and every Theme route would
    // miss — the page renders the root layout wrapped around "Not Found".
    const { content } = bootstrap();
    expect(content).toContain("createMemoryHistory");
    expect(content).toContain('initialEntries: ["/"]');
  });

  it("does not fall back to browser history for the preview bundle", () => {
    // A basepath cannot work either: the capability token changes per session
    // while the built bundle is immutable.
    const { content } = bootstrap();
    expect(content).not.toContain("createBrowserHistory");
    expect(content).not.toMatch(/basepath\s*:/);
  });
});

describe("where a Theme is mounted", () => {
  const bootstrapFor = (rootContent: string) =>
    createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({
            entry: "src/routes/index.tsx",
            router: { framework: "tanstack-start" },
          }),
        },
        { path: "src/routes/__root.tsx", content: rootContent },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
      ],
    }).content;

  // A Theme that owns its document shell renders <html>, <head> and <body>.
  // Mounted inside `<div id="root">` that puts <html> in a <div>: React
  // reports the invalid nesting on every load, and the preview stops matching
  // the document the published site serves.
  it("mounts a document shell on the document, not inside a div", () => {
    const content = bootstrapFor(
      "export const Route = createRootRoute({ shellComponent: RootDocument });",
    );
    expect(content).toContain("createRoot(document)");
    // Decided where the answer is actually known. The shell is a runtime
    // option on the root route, not something a parser should guess at.
    expect(content).toContain("options?.shellComponent");
  });

  it("still mounts a Theme without a shell in its container", () => {
    const content = bootstrapFor("export const Route = createRootRoute({});");
    expect(content).toContain('document.getElementById("root")');
  });

  // React owns the head once it renders one, and Vite injected the Theme's
  // styles into the head of the page it served. Losing them would leave an
  // unstyled preview of a styled site.
  it("carries the styles already in the head across the handover", () => {
    const content = bootstrapFor(
      "export const Route = createRootRoute({ shellComponent: RootDocument });",
    );
    expect(content).toContain("style, link[rel='stylesheet']");
    expect(content).toContain("document.head.appendChild(node)");
  });
});

/**
 * The generated accept handler, actually run.
 *
 * The assertions above check that the emitted source contains the right
 * fragments, which is a different claim from the handler behaving correctly:
 * they would pass just as well with the two arrays out of step, or `preserve`
 * applied the wrong way round. Only the module graph proved that, by hand,
 * once. This isolates the handler and runs it against fake routes.
 */
describe("the preview route hot-update handler, executed", () => {
  const bootstrap = () =>
    createThemeBuildBootstrap({
      entry: "src/routes/index.tsx",
      cssFiles: [],
      exposeRouterForPreview: true,
      files: [
        {
          path: "morph.theme.json",
          content: JSON.stringify({ router: { framework: "tanstack-start" } }),
        },
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
        },
        {
          path: "src/routes/index.tsx",
          content: 'export const Route = createFileRoute("/")({});',
        },
        {
          path: "src/routes/lookbook.tsx",
          content: 'export const Route = createFileRoute("/lookbook")({});',
        },
      ],
    });

  /**
   * Cuts the generated block out of the entry and makes it callable.
   *
   * Everything above it imports the Theme, which a unit test has no business
   * loading. The block is self-contained: it closes over the route bindings
   * the entry declared and over `router`, both of which are supplied here.
   */
  const runHandler = async (
    source: string,
    routes: Record<string, { options: Record<string, unknown> }>,
    modules: ReadonlyArray<unknown>,
  ) => {
    const start = source.indexOf("const __morphPreviewHotRoutes");
    const end = source.indexOf("}", source.indexOf("import.meta.hot.accept("));
    expect(start).toBeGreaterThan(-1);
    const js = source.slice(start, source.indexOf("\n}", end) + 2);

    let accepted: ((modules: ReadonlyArray<unknown>) => Promise<void>) | null =
      null;
    let invalidated = 0;
    const warnings: string[] = [];
    const scope = {
      importMeta: {
        hot: {
          accept: (_deps: string[], callback: typeof accepted) => {
            accepted = callback;
          },
        },
      },
      router: {
        invalidate: async () => {
          invalidated += 1;
        },
      },
      console: { warn: (message: string) => warnings.push(message) },
      ...routes,
    };
    const keys = Object.keys(scope);
    new Function(...keys, js.replaceAll("import.meta", "importMeta"))(
      ...keys.map((key) => scope[key as keyof typeof scope]),
    );
    expect(accepted).not.toBeNull();
    await accepted!(modules);
    return { invalidated, warnings };
  };

  it("takes the new options and keeps the ones the tree owns", async () => {
    const { content } = bootstrap();
    const parent = () => "parent";
    const route1 = {
      options: {
        id: "/lookbook",
        path: "/lookbook",
        getParentRoute: parent,
        component: "old component",
      },
    };
    const routes = {
      rootRouteImport: { options: { component: "old root" } },
      route0: { options: { id: "/", path: "/", getParentRoute: parent } },
      route1,
    };

    const result = await runHandler(content, routes, [
      undefined,
      undefined,
      { Route: { options: { component: "new component", path: "/moved" } } },
    ]);

    // The authored edit lands.
    expect(route1.options.component).toBe("new component");
    // Structure the generated tree decided stays, or the route would detach
    // from its parent the first time its module was touched.
    expect(route1.options.id).toBe("/lookbook");
    expect(route1.options.path).toBe("/lookbook");
    expect(route1.options.getParentRoute).toBe(parent);
    expect(result.invalidated).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  // Index alignment between the accepted specifiers and the bindings: the two
  // arrays are built from one list, and nothing else was guarding that.
  it("applies each module to the route it came from", async () => {
    const { content } = bootstrap();
    const routes = {
      rootRouteImport: { options: { marker: "root" } },
      route0: { options: { marker: "index" } },
      route1: { options: { marker: "lookbook" } },
    };

    await runHandler(content, routes, [
      { Route: { options: { marker: "root updated" } } },
      undefined,
      undefined,
    ]);

    expect(routes.rootRouteImport.options.marker).toBe("root updated");
    expect(routes.route0.options.marker).toBe("index");
    expect(routes.route1.options.marker).toBe("lookbook");
  });

  /**
   * An edit that leaves the module valid but no longer exporting `Route`. A
   * syntax error raises Vite's own overlay; this does not, and silence would
   * show the author their previous page as though nothing had happened.
   */
  it("says so when an update carries nothing it can use", async () => {
    const { content } = bootstrap();
    const routes = {
      rootRouteImport: { options: {} },
      route0: { options: {} },
      route1: { options: {} },
    };

    const result = await runHandler(content, routes, [
      { NotTheRoute: {} },
      undefined,
      undefined,
    ]);

    expect(result.invalidated).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("previous version");
  });
});
