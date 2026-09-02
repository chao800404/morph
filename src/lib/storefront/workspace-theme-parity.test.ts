// @vitest-environment node
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { renderSafeThemeComponent } from "@/components/storefront/safe-theme-component-renderer";
import {
  createThemeModuleLoader,
  normalizeThemeMarkup,
  type ThemeSourceFile,
} from "@/lib/test-utils/theme-module-loader";

/**
 * Compares the Theme currently in the workspace, not the starter one.
 *
 * The other parity tests use fixtures written by whoever also wrote the
 * interpreter, so they can only find gaps someone thought to probe. The Theme
 * being built for a real storefront is written without a thought for what the
 * interpreter supports, which is exactly what makes it worth comparing — every
 * new component is a fixture nobody designed to pass.
 *
 * Off by default: it reads a database that only exists on a machine running
 * this project locally.
 *
 *   MORPH_THEME_PARITY=1 pnpm test workspace-theme-parity
 */
const ENABLED = process.env.MORPH_THEME_PARITY === "1";

const D1_DIRECTORY = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** The local D1 file, or null when this machine has no local workspace. */
function findLocalDatabase(): string | null {
  const explicit = process.env.MORPH_THEME_PARITY_DB;
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  if (!fs.existsSync(D1_DIRECTORY)) return null;
  const candidates = fs
    .readdirSync(D1_DIRECTORY)
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
    .map((name) => path.join(D1_DIRECTORY, name));
  return candidates[0] ?? null;
}

/**
 * Reads the Theme files from a copy of the database.
 *
 * `VACUUM INTO` takes a consistent snapshot without holding the live file open,
 * so a dev server writing to it at the same time is neither blocked nor read
 * halfway through a write.
 */
function readWorkspaceTheme(databasePath: string): ThemeSourceFile[] {
  const copy = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "morph-parity-")),
    "workspace.sqlite",
  );
  const live = new Database(databasePath, { readonly: true });
  try {
    live.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  } finally {
    live.close();
  }

  const snapshot = new Database(copy, { readonly: true });
  try {
    return snapshot
      .prepare(
        "select path, content from storefront_theme_files where deleted_at is null",
      )
      .all() as ThemeSourceFile[];
  } finally {
    snapshot.close();
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  }
}

const databasePath = ENABLED ? findLocalDatabase() : null;
const files = databasePath ? readWorkspaceTheme(databasePath) : [];

/**
 * Drops the anchor attributes a live router derives from the current location.
 *
 * A `<Link>` with no `to` resolves against wherever it is rendered, so the real
 * router marks it active and gives it that location's href. Here that location
 * is this file's synthetic "/" route, not the page the component really sits
 * on, which makes those attributes a property of the harness rather than of the
 * author's markup this test compares. The href a `to` actually produces is
 * asserted directly in safe-theme-route-renderer.test.tsx.
 */
function stripRouterLocationState(html: string): string {
  return html
    .replace(/ href="[^"]*"/g, "")
    .replace(/ data-status="[^"]*"/g, "")
    .replace(/ aria-current="[^"]*"/g, "")
    .replace(/(class="[^"]*?) active"/g, '$1"');
}

/**
 * Renders one element inside a real router.
 *
 * Theme authors reach for `<Link>` freely, and those components throw without
 * router context. Both paths are wrapped in the same router so the surrounding
 * markup is identical on each side and any difference is the component's own.
 */
async function renderInRouter(element: ReactElement): Promise<string> {
  const rootRoute = createRootRoute({
    component: () => createElement(Outlet),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  } as never) as unknown as { load: () => Promise<void> };
  await router.load();
  return renderToStaticMarkup(
    createElement(RouterProvider as never, { router } as never),
  );
}

/**
 * Components that render on their own.
 *
 * A route needs a router and the content module needs a request, so those are
 * covered by the starter-Theme parity test instead; here the point is the
 * author's own markup.
 */
const components = files
  .filter(
    (file) =>
      file.path.startsWith("src/components/") && file.path.endsWith(".tsx"),
  )
  .map((file) => file.path)
  .sort();

describe.skipIf(!ENABLED || components.length === 0)(
  "the workspace Theme renders identically through both paths",
  () => {
    const loader = createThemeModuleLoader(files);

    // Without this the loader would resolve the router through CommonJS while
    // this file imports the ESM build, giving `<Link>` a different React
    // context than the provider around it and no router to read.
    beforeAll(async () => {
      await loader.preloadPackages(["@tanstack/react-router"]);
    });

    it("has components to compare", () => {
      expect(components.length).toBeGreaterThan(0);
    });

    for (const sourcePath of components) {
      it(sourcePath.replace("src/components/", ""), async () => {
        const module = loader.loadModule(sourcePath);
        const Component = module.default as React.ComponentType<
          Record<string, unknown>
        >;
        expect(
          typeof Component,
          `${sourcePath} has no default export to render`,
        ).toBe("function");

        const fromReact = stripRouterLocationState(
          normalizeThemeMarkup(
            await renderInRouter(createElement(Component, {})),
          ),
        );
        const result = renderSafeThemeComponent({
          files,
          sourcePath,
          props: {},
        });
        if (!result.success) {
          throw new Error(
            `the interpreter refused this component: ${result.diagnostics.join("; ")}`,
          );
        }
        const fromInterpreter = stripRouterLocationState(
          normalizeThemeMarkup(
            await renderInRouter(result.node as ReactElement),
          ),
        );

        // Guards the comparison itself: normalisation that stripped everything
        // would make every component "match" and prove nothing.
        expect(fromReact.length).toBeGreaterThan(20);
        expect(fromInterpreter).toBe(fromReact);
      });
    }
  },
);
