import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as reactRouter from "@tanstack/react-router";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import ts from "typescript";

import type {
  StorefrontPageDocument,
  StorefrontTemplateType,
} from "@/db/storefront.schema";
import {
  createThemePreviewContentSnapshot,
  THEME_PREVIEW_CONTENT_PATH,
  themePreviewContentModuleSource,
  type ThemePreviewContentSnapshot,
} from "@/lib/storefront/compiler/theme-preview-content";
import { prepareSourcesForLivePreview } from "@/lib/storefront/source-language/tsx-source-language";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  createThemeModuleLoader,
  type ThemeSourceFile,
} from "./theme-module-loader";

/**
 * Renders a Theme the way Live Preview does, without a container.
 *
 * Every step that decides what the editor can see is the product's own:
 *
 * - the source passes the preview workspace runs
 *   (`prepareSourcesForLivePreview`: identity attributes, then the lift);
 * - real React and a real TanStack router over the Theme's own route modules;
 * - the Theme's own `src/morph/content.ts`, which asks `/_morph/content` for
 *   the page and provides the answer through its own React context;
 * - that answer built by `createThemePreviewContentSnapshot` from the draft
 *   Documents and looked up with the resolver the preview's dev server and its
 *   in-page fetch interceptor both use.
 *
 * What stands in: the transport (no dev server, no Worker) and the choice of
 * the content loader's client branch, which is the branch a canvas page runs
 * after it loads. The SSR branch reads the same endpoint through the Worker's
 * `x-morph-content-origin`, so the answer is the same document either way.
 * Behaviour that depends on a real browser, a real container or the bridge's
 * live edits is not covered here; that belongs to the editor E2E suite.
 */

export type LivePreviewDocuments = Readonly<
  Partial<Record<StorefrontTemplateType, StorefrontPageDocument>>
>;

/** Extracts the path → content resolver the preview runtime itself runs. */
function previewContentResolver(
  snapshot: ThemePreviewContentSnapshot,
): (pathname: string) => unknown {
  const source = themePreviewContentModuleSource();
  const start = source.indexOf("function templateTypeForPath");
  const end = source.indexOf("export function updatePreviewContent");
  if (start < 0 || end < 0 || end <= start) {
    // The same slice `themePreviewContentPluginSource` takes. Failing loudly
    // here keeps the harness from silently serving a resolver of its own.
    throw new Error(
      "live-preview-render: the preview content module no longer has the resolver this harness reads",
    );
  }
  const resolver = source
    .slice(start, end)
    .replace(
      "export function previewContentForPath",
      "function previewContentForPath",
    );
  return new Function("snapshot", `${resolver}\nreturn previewContentForPath;`)(
    snapshot,
  ) as (pathname: string) => unknown;
}

/**
 * `createIsomorphicFn` resolved to its client branch, as on a canvas page.
 *
 * The real one is rewritten per environment by the Start compiler; this
 * harness has no compiler, so it picks the branch itself rather than letting
 * an untransformed builder decide.
 */
function createClientIsomorphicFn() {
  let implementation: ((...args: unknown[]) => unknown) | undefined;
  const fn = ((...args: unknown[]) => {
    if (!implementation) {
      throw new Error(
        "live-preview-render: isomorphic function has no client branch",
      );
    }
    return implementation(...args);
  }) as ((...args: unknown[]) => unknown) & {
    client: (impl: (...args: unknown[]) => unknown) => typeof fn;
    server: (impl: (...args: unknown[]) => unknown) => typeof fn;
  };
  fn.client = (impl) => {
    implementation = impl;
    return fn;
  };
  fn.server = () => fn;
  return fn;
}

const START_PACKAGES = {
  "@tanstack/react-start": { createIsomorphicFn: createClientIsomorphicFn },
  "@tanstack/react-start/server": {
    getRequest: () => {
      throw new Error("live-preview-render: a client render has no request");
    },
  },
};

/**
 * Builds a router from a tree assembled at runtime.
 *
 * The router's generic types describe a tree the build generates. This one is
 * put together from the Theme's exported route options instead, so the
 * constructor is called through an untyped view.
 */
const buildRuntimeRouter = createRouter as unknown as (options: {
  routeTree: unknown;
  history: unknown;
}) => { load: () => Promise<void> };

type RouteModule = { Route: { options: Record<string, unknown> } };

/** Route options a client render uses; the document shell and head are the server's. */
function clientRouteOptions(options: Record<string, unknown>) {
  const { shellComponent: _shell, head: _head, ...rest } = options;
  return rest;
}

export type LivePreviewRender = Readonly<{
  html: string;
  /** What the preview transform reported, so a test can assert it ran. */
  prepared: ReturnType<typeof prepareSourcesForLivePreview>;
}>;

/**
 * TSX → CommonJS with TypeScript rather than esbuild.
 *
 * These renders are read through the editor's DOM resolution, which needs a
 * DOM, and esbuild cannot load under jsdom. Both compilers emit the automatic
 * JSX runtime, so what React receives is the same element tree.
 */
function compileWithTypeScript(source: string, sourcePath: string): string {
  return ts
    .transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    })
    .outputText.replace(
      // CommonJS has no `import.meta`. esbuild's CommonJS output substitutes an
      // empty object, which is what this does too: no `env`, so nothing that
      // is gated on a development flag turns on.
      /\bimport\.meta\b/g,
      "({})",
    );
}

function prepare(files: readonly ThemeSourceFile[], previewPass = true) {
  const prepared = prepareSourcesForLivePreview(files);
  const loader = createThemeModuleLoader(
    (previewPass ? prepared.files : files).map((file) => ({
      path: file.path,
      content: file.content,
    })),
    {
      packages: { "@tanstack/react-router": reactRouter, ...START_PACKAGES },
      compile: compileWithTypeScript,
    },
  );
  return { prepared, loader };
}

/**
 * Answers a request the page makes other than for its content, the way the
 * editor answers the canvas (the catalog, for one). Returning nothing fails
 * the render: a request no test expected is a finding, not a default.
 */
export type LivePreviewRequestHandler = (
  url: URL,
) => Response | Promise<Response> | undefined;

async function withPreviewContent<T>(
  documents: LivePreviewDocuments,
  respond: LivePreviewRequestHandler | undefined,
  render: () => Promise<T>,
): Promise<T> {
  const snapshot = await createThemePreviewContentSnapshot({
    templates: Object.entries(documents).map(([type, document]) => ({
      type: type as StorefrontTemplateType,
      document: document as StorefrontPageDocument,
    })),
  });
  const resolve = previewContentResolver(snapshot);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      "http://preview.invalid",
    );
    if (url.pathname !== THEME_PREVIEW_CONTENT_PATH) {
      const answer = await respond?.(url);
      if (answer) return answer;
      throw new Error(`live-preview-render: unexpected request to ${url.href}`);
    }
    return new Response(
      JSON.stringify(resolve(url.searchParams.get("path") ?? "/")),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;
  try {
    return await render();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/**
 * Renders one route of a Theme under its root route, as the canvas shows it.
 *
 * `routeFile` is the route module; `path` is where it is mounted. Content for
 * `pathname` comes from `documents` (an `index` Document for `/`, a `layout`
 * Document for the shell every path renders inside).
 */
export async function renderLivePreviewRoute(args: {
  files: readonly ThemeSourceFile[];
  routeFile?: string;
  path?: string;
  pathname?: string;
  documents?: LivePreviewDocuments;
  respond?: LivePreviewRequestHandler;
  /** See `renderLivePreviewComponent`. */
  previewPass?: boolean;
}): Promise<LivePreviewRender> {
  const routeFile = args.routeFile ?? "src/routes/index.tsx";
  const path = args.path ?? "/";
  const pathname = args.pathname ?? path;
  const { prepared, loader } = prepare(args.files, args.previewPass);

  const html = await withPreviewContent(
    args.documents ?? {},
    args.respond,
    async () => {
      const root = loader.loadModule("src/routes/__root.tsx") as RouteModule;
      const child = loader.loadModule(routeFile) as RouteModule;
      const rootRoute = createRootRoute(
        clientRouteOptions(root.Route.options) as never,
      );
      const childRoute = createRoute({
        ...(clientRouteOptions(child.Route.options) as object),
        getParentRoute: () => rootRoute as never,
        path,
      } as never);
      const router = buildRuntimeRouter({
        routeTree: rootRoute.addChildren([childRoute as never]),
        history: createMemoryHistory({ initialEntries: [pathname] }),
      });
      await router.load();
      return renderToStaticMarkup(
        createElement(RouterProvider as never, { router } as never),
      );
    },
  );
  return { html, prepared };
}

/**
 * Renders one component on its own, inside a router because a component is
 * free to use one (`<Link>` reads it from context).
 */
export async function renderLivePreviewComponent(args: {
  files: readonly ThemeSourceFile[];
  sourcePath: string;
  props?: Record<string, unknown>;
  /**
   * `false` renders the author's source as written, without the preview's
   * identity pass: what a test uses to show its check depends on that pass.
   */
  previewPass?: boolean;
}): Promise<LivePreviewRender> {
  const { prepared, loader } = prepare(args.files, args.previewPass);
  const Component = loader.loadModule(args.sourcePath).default as ComponentType<
    Record<string, unknown>
  >;
  const rootRoute = createRootRoute({
    component: () => createElement(Component, args.props ?? {}),
  });
  const router = buildRuntimeRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const html = renderToStaticMarkup(
    createElement(RouterProvider as never, { router } as never),
  );
  return { html, prepared };
}

/** The starter files a route needs around it to render at all. */
const PLATFORM_PATHS = new Set([
  "src/routes/__root.tsx",
  "src/morph/content.ts",
  "src/morph/content-fields.ts",
  "src/morph/link.tsx",
  "src/styles/global.css",
]);

/**
 * The smallest Theme a test route can render inside: the starter's own root
 * route, content module and link component, and a layout that adds nothing.
 * A test supplies its components and `src/routes/index.tsx`.
 */
export function livePreviewPlatformFiles(): ThemeSourceFile[] {
  return [
    ...STARTER_THEME_FILES.filter((file) => PLATFORM_PATHS.has(file.path)).map(
      (file) => ({ path: file.path, content: file.content }),
    ),
    {
      path: "src/layouts/StorefrontLayout.tsx",
      content: `import type { ReactNode } from "react";
export default function StorefrontLayout({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}`,
    },
  ];
}

/** Puts rendered markup into the test document and returns its root. */
export function mountLivePreview(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}
