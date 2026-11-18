import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
} from "@tanstack/react-router";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * The page the frame arrives at, when the address it committed spells that
 * page differently from the router's own matches.
 *
 * TanStack Router names a match by its route and the path it interpolates
 * from the params it matched. Its route tree trims a trailing slash before
 * matching, so /products/hat/ is matched as /products/hat; and a param is put
 * back with encodeURIComponent, so /products/a@b is matched as
 * /products/a%40b. The location it committed keeps the spelling it was given.
 * The bridge has to tell that the matches have reached that location all the
 * same, or it cannot say which page the frame arrived at, and then it
 * withdraws every acknowledgement it gave, including those of the pages a
 * legal off-page save relies on.
 *
 * Everything here runs the real router, the version this repository
 * installs, mounted with its React provider so its events fire when the real
 * runtime fires them, under the options the previews create it with. The
 * bridge's ack lifecycle and routing code are run as written, cut from the
 * generated script.
 */

const BRIDGE = themePreviewBridgeEntrySource();
const ORIGIN = "https://preview.morph.test";
/** The capability-scoped address a Client-only build is served from. */
const SERVED_PATH = "/preview-build/build-1/token-1/";
const QUERY = "?morph-preview-session=s1";
const PRODUCT = "/products/$slug";

type Posted = Record<string, unknown>;
type Leaf = {
  id: string;
  routeId: string;
  pathname: string;
  status: string;
  globalNotFound?: boolean;
  params: Record<string, string>;
};
type MatchedRoutes = {
  foundRoute?: { id: string; fullPath: string };
  routeParams: Record<string, string>;
};
type RealRouter = {
  state: {
    matches: Leaf[];
    status: string;
    resolvedLocation?: { pathname: string };
  };
  history: {
    location: { pathname: string; search: string };
    push: (path: string) => void;
    back: () => void;
  };
  navigate: (options: { to: string }) => Promise<void>;
  subscribe: (event: string, listener: () => void) => () => void;
  getMatchedRoutes: (pathname: string) => MatchedRoutes;
};

/** Loaders a test holds back until it lets them finish. */
function gates() {
  const held = new Map<string, () => void>();
  const waiting = new Set<string>();
  return {
    hold: (slug: string) => waiting.add(slug),
    release: (slug: string) => {
      waiting.delete(slug);
      held.get(slug)?.();
      held.delete(slug);
    },
    wait: (slug: string) =>
      waiting.has(slug)
        ? new Promise<void>((resolve) => held.set(slug, resolve))
        : undefined,
  };
}

/**
 * The runtimes the bridge runs under, with the options each creates its
 * router with: the Client-only bootstrap passes memory history and nothing
 * else; the Starter's getRouter passes scrollRestoration and leaves history
 * to the browser. Neither sets trailingSlash, so the router's default,
 * "never", applies.
 */
const RUNTIMES = [
  {
    name: "Client-only (memory history)",
    start: false,
    options: () => ({
      history: createMemoryHistory({ initialEntries: ["/"] }),
    }),
    servedLocation: () => ({
      pathname: SERVED_PATH,
      search: QUERY,
      origin: ORIGIN,
      href: `${ORIGIN}${SERVED_PATH}${QUERY}`,
      assign: () => {
        throw new Error("a Client-only preview never loads another document");
      },
    }),
  },
  {
    name: "Full Start (browser history)",
    start: true,
    options: () => ({ scrollRestoration: true }),
    servedLocation: () => window.location,
  },
] as const;

type Runtime = (typeof RUNTIMES)[number];

const mounted: Root[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) root.unmount();
  window.history.replaceState(null, "", "/");
});

function themeRouter(runtime: Runtime, options: Record<string, unknown> = {}) {
  const gate = gates();
  const rootRoute = createRootRoute({});
  const home = createRoute({ getParentRoute: () => rootRoute, path: "/" });
  const about = createRoute({ getParentRoute: () => rootRoute, path: "/about" });
  const product = createRoute({
    getParentRoute: () => rootRoute,
    path: "/products/$slug",
    loader: async ({ params }: { params: { slug: string } }) => {
      await gate.wait(params.slug);
      if (params.slug === "gone") throw notFound();
      if (params.slug === "broken") throw new Error("the loader failed");
    },
  });
  const guarded = createRoute({
    getParentRoute: () => rootRoute,
    path: "/guarded",
    beforeLoad: () => {
      throw new Error("beforeLoad refused");
    },
  });
  const routeTree = rootRoute.addChildren([home, about, product, guarded]);
  const router = createRouter({
    routeTree,
    ...runtime.options(),
    ...options,
  } as never) as unknown as RealRouter;
  return { router, gate };
}

/** Waits for what the real runtime does on its own schedule. */
async function until(condition: () => boolean, what = "the router") {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`${what} never got there`);
}

function leafOf(router: RealRouter) {
  const matches = router.state.matches;
  return matches[matches.length - 1];
}

/** The router has loaded and resolved where its history is. */
const resolved = (router: RealRouter) =>
  router.state.status === "idle" &&
  router.state.matches.length > 0 &&
  router.state.resolvedLocation?.pathname === router.history.location.pathname;

async function mount(router: RealRouter) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(root);
  root.render(createElement(RouterProvider as never, { router } as never));
  await until(() => resolved(router), "the first page");
}

/** A navigation, the way the case's spelling reaches the router. */
type Go = (router: RealRouter, path: string) => void;
/** Set-route and a Theme's Link to a literal path: router.navigate. */
const navigateTo: Go = (router, path) => {
  void router.navigate({ to: path });
};
/** Theme code, or the router's history traversed: the history itself. */
const pushHistory: Go = (router, path) => {
  router.history.push(path);
};

async function arrive(router: RealRouter, path: string, go: Go = navigateTo) {
  go(router, path);
  await until(() => router.history.location.pathname === path, path);
  await until(() => resolved(router));
}

/**
 * The bridge, with the router it is handed. `hideHistory` hands it the same
 * router without its history's subscription, so the bridge first sees a
 * navigation once the router has resolved it: the matches are already there
 * when it notices the commit.
 */
function preview(runtime: Runtime, router: RealRouter, hideHistory = false) {
  const ackStart = BRIDGE.indexOf("const pendingPresentationTokens = new Map();");
  const ackEnd = BRIDGE.indexOf("function flushEarlyPresentationTokens");
  const routingStart = BRIDGE.indexOf("const documentNavigation =");
  const routingEnd = BRIDGE.indexOf("function clearSelectionAttributes");
  expect(ackStart, "the bridge's ack lifecycle").toBeGreaterThan(-1);
  expect(ackEnd).toBeGreaterThan(ackStart);
  expect(routingStart, "the bridge's routing code").toBeGreaterThan(ackEnd);
  expect(routingEnd).toBeGreaterThan(routingStart);
  const source =
    BRIDGE.slice(ackStart, ackEnd) + BRIDGE.slice(routingStart, routingEnd);

  const handed = hideHistory
    ? {
        get state() {
          return router.state;
        },
        history: {
          get location() {
            return router.history.location;
          },
        },
        navigate: (options: { to: string }) => router.navigate(options),
        subscribe: (event: string, listener: () => void) =>
          router.subscribe(event, listener),
        getMatchedRoutes: (pathname: string) =>
          router.getMatchedRoutes(pathname),
      }
    : router;

  const posted: Posted[] = [];
  const listen = () => {};
  const frameWindow = {
    __morphPreviewNavigation: undefined,
    __morphPreviewRouter: handed,
    setTimeout: () => 0,
    addEventListener: listen,
  };
  /** Every page here renders every section, shown. */
  const section = { hasAttribute: () => false };
  const build = new Function(
    "window",
    "document",
    "location",
    "sessionStorage",
    "console",
    "channel",
    "postPreviewToEditorMessage",
    "collectPreviewEditableNodes",
    "inlineEditor",
    "syncDragHandle",
    "drawOverlays",
    "restoreSelectedSection",
    "selectionEnabled",
    "previewSectionSelector",
    "requestAnimationFrame",
    "isContentRefreshPending",
    `let appliedRoutePath = null;
    let selectedItem = null;
    let hoveredItem = null;
    ${source}
    return {
      reportStructure,
      queuePresentationToken,
      flushPendingPresentationTokens,
    };`,
  );
  const bridge = build(
    frameWindow,
    {
      getElementById: () => null,
      addEventListener: listen,
      querySelectorAll: () => [section],
    },
    runtime.servedLocation(),
    { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    { warn: () => {} },
    { previewSession: "s1" },
    (message: Posted) => posted.push(message),
    () => [],
    { finish: () => {} },
    () => {},
    () => {},
    () => {},
    false,
    (sectionId: string) => `[data-section-id="${sectionId}"]`,
    (callback: () => void) => setTimeout(callback, 0),
    () => false,
  ) as {
    reportStructure: () => void;
    queuePresentationToken: (
      sectionId: string,
      enabled: boolean,
      token: Posted,
    ) => void;
    flushPendingPresentationTokens: () => void;
  };
  const acks = () =>
    posted.filter(
      (message) =>
        message.type === "morph:storefront-preview-section-presentation-ack",
    );
  /** The editor's side: an applied ack stands until the frame withdraws it. */
  const standing = () => {
    const stands = new Set<string>();
    for (const ack of acks()) {
      if (ack.status === "applied") stands.add(ack.operationId as string);
      else stands.delete(ack.operationId as string);
    }
    return Array.from(stands).sort();
  };
  const withdrawn = () =>
    acks()
      .filter(
        (ack) => ack.status === "not-applied" && ack.reason === "superseded",
      )
      .map((ack) => ack.operationId as string)
      .sort();
  const applied = (operationId: string) =>
    acks().filter(
      (ack) => ack.operationId === operationId && ack.status === "applied",
    ).length;
  /** The editor presents a section of `routePath` on the page shown. */
  const present = (operationId: string, routePath: string) => {
    bridge.queuePresentationToken(
      `section-${operationId}`,
      true,
      token(operationId, routePath),
    );
    bridge.flushPendingPresentationTokens();
  };
  return { ...bridge, standing, withdrawn, applied, present };
}

function token(operationId: string, routePath: string) {
  return {
    workspaceKey: "storefront-1:theme-1",
    templateId: routePath === PRODUCT ? "template-product" : "template-page",
    routePath,
    sectionId: `section-${operationId}`,
    documentBasis: { kind: "existing", draftGeneration: 1 },
    overlayRevision: 1,
    presentationRevision: 1,
    operationId,
  };
}

/** Lets the bridge's next-frame flushes run. */
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The author's home page acknowledged (the basis of a legal off-page save),
 * then /products/shirt shown and acknowledged.
 */
async function homeThenShirt(
  runtime: Runtime,
  hideHistory = false,
  options: Record<string, unknown> = {},
) {
  const { router, gate } = themeRouter(runtime, options);
  await mount(router);
  const page = preview(runtime, router, hideHistory);
  page.reportStructure();
  page.present("op-home", "/");
  await arrive(router, "/products/shirt");
  await nextFrame();
  page.present("op-shirt", PRODUCT);
  expect(page.standing()).toEqual(["op-home", "op-shirt"]);
  return { router, gate, page };
}

/** Spellings of a product page that differ from the router's own match. */
const SPELLINGS = [
  {
    name: "a trailing slash",
    slug: "hat",
    committed: "/products/hat/",
    matched: "/products/hat",
    go: pushHistory,
  },
  {
    name: "a character a path keeps and a param encodes",
    slug: "a@b",
    committed: "/products/a@b",
    matched: "/products/a%40b",
    go: navigateTo,
  },
] as const;

describe.each(RUNTIMES)("$name", (runtime) => {
  describe("what the router itself says about the spellings", () => {
    it.each(SPELLINGS)(
      "$name: the committed location keeps its spelling, the leaf names the page the router matched, and both spellings are one match",
      async ({ committed, matched, go }) => {
        const { router } = themeRouter(runtime);
        await mount(router);

        await arrive(router, committed, go);
        const leaf = leafOf(router);
        expect(leaf.routeId).toBe(PRODUCT);
        expect(leaf.pathname).toBe(matched);
        expect(router.history.location.pathname).toBe(committed);
        const committedTree = router.getMatchedRoutes(committed);
        expect(committedTree.foundRoute?.fullPath).toBe(PRODUCT);

        await arrive(router, matched, go);
        expect(leafOf(router).id, "one match for both spellings").toBe(leaf.id);
        expect(router.getMatchedRoutes(matched).routeParams).toEqual(
          committedTree.routeParams,
        );
      },
    );

    it("router.navigate drops a trailing slash under the default trailingSlash; only the history keeps one", async () => {
      const { router } = themeRouter(runtime);
      await mount(router);

      await router.navigate({ to: "/products/hat/" });
      await until(() => resolved(router));
      expect(router.history.location.pathname).toBe("/products/hat");
    });

    it('under trailingSlash "always" every navigation commits a trailing slash the leaf does not have', async () => {
      const { router } = themeRouter(runtime, { trailingSlash: "always" });
      await mount(router);

      await router.navigate({ to: "/products/hat" });
      await until(() => resolved(router));
      expect(router.history.location.pathname).toBe("/products/hat/");
      expect(leafOf(router).pathname).toBe("/products/hat");
    });

    it("an encoded slash inside a param is not the path with a real slash", async () => {
      const { router } = themeRouter(runtime);
      await mount(router);

      await arrive(router, "/products/a%2Fb");
      const encoded = leafOf(router);
      expect(encoded.routeId).toBe(PRODUCT);
      expect(encoded.params).toEqual({ slug: "a/b" });
      expect(encoded.pathname).toBe("/products/a%2Fb");

      await arrive(router, "/products/a/b");
      expect(leafOf(router).id).not.toBe(encoded.id);
      expect(router.getMatchedRoutes("/products/a/b").routeParams).toEqual({
        slug: "a",
        "**": "b",
      });
    });
  });

  describe("an arrival spelled differently from the router's match", () => {
    it.each(SPELLINGS)(
      "$name, matches arriving after the commit (onResolved): only the arrival's acks are withdrawn, and what waited for it is acknowledged once",
      async ({ slug, committed, go }) => {
        const { router, gate, page } = await homeThenShirt(runtime);

        gate.hold(slug);
        go(router, committed);
        await until(() => router.history.location.pathname === committed);
        expect(page.withdrawn(), "the committed route's ack, at commit").toEqual([
          "op-shirt",
        ]);
        page.present("op-window", PRODUCT);
        expect(page.applied("op-window"), "not before it is on screen").toBe(0);

        gate.release(slug);
        await until(() => resolved(router));
        await nextFrame();
        await nextFrame();

        expect(
          page.standing(),
          "the home page's ack is still the basis of a legal save",
        ).toEqual(["op-home", "op-window"]);
        expect(page.withdrawn()).toEqual(["op-shirt"]);
        expect(page.applied("op-window")).toBe(1);
      },
    );

    it.each(SPELLINGS)(
      "$name, matches already there when the bridge sees the commit: only the arrival's acks are withdrawn",
      async ({ committed, go }) => {
        const { router, page } = await homeThenShirt(runtime, true);

        await arrive(router, committed, go);
        await nextFrame();

        expect(page.standing()).toEqual(["op-home"]);
        expect(page.withdrawn()).toEqual(["op-shirt"]);
        page.present("op-hat", PRODUCT);
        expect(page.standing()).toEqual(["op-hat", "op-home"]);
      },
    );

    it.each(SPELLINGS)(
      "$name, a section presented once the matches are in and before onResolved: the arrival is settled first, then it is acknowledged",
      async ({ committed, go }) => {
        const { router, page } = await homeThenShirt(runtime);
        let onLoad: { routeId: string; applied: number } | null = null;
        const stop = router.subscribe("onLoad", () => {
          if (onLoad) return;
          page.present("op-loaded", PRODUCT);
          onLoad = {
            routeId: leafOf(router).routeId,
            applied: page.applied("op-loaded"),
          };
        });

        await arrive(router, committed, go);
        stop();
        await nextFrame();

        expect(onLoad, "acknowledged at once: the page is on screen").toEqual({
          routeId: PRODUCT,
          applied: 1,
        });
        expect(page.standing()).toEqual(["op-home", "op-loaded"]);
        expect(page.withdrawn()).toEqual(["op-shirt"]);
      },
    );

    if (runtime.start) {
      it("back to an entry the document was loaded at with a trailing slash: only the arrival's acks are withdrawn", async () => {
        window.history.replaceState(null, "", "/products/hat/");
        const { router } = themeRouter(runtime);
        await mount(router);
        expect(router.history.location.pathname).toBe("/products/hat/");
        const page = preview(runtime, router);
        page.reportStructure();
        page.present("op-hat", PRODUCT);
        await arrive(router, "/");
        await nextFrame();
        page.present("op-home", "/");
        expect(page.standing()).toEqual(["op-hat", "op-home"]);

        router.history.back();
        await until(() => router.history.location.pathname === "/products/hat/");
        await until(() => resolved(router));
        await nextFrame();
        await nextFrame();

        expect(page.standing()).toEqual(["op-home"]);
        expect(page.withdrawn()).toEqual(["op-hat"]);
      });
    }
  });

  describe("controls", () => {
    it("a different slug: shirt's ack is withdrawn once hat's matches arrive; home keeps its ack", async () => {
      const { router, gate, page } = await homeThenShirt(runtime);

      gate.hold("hat");
      void router.navigate({ to: "/products/hat" });
      await until(() => router.history.location.pathname === "/products/hat");
      gate.release("hat");
      await until(() => resolved(router));
      await nextFrame();

      expect(page.standing()).toEqual(["op-home"]);
      expect(page.withdrawn()).toEqual(["op-shirt"]);
    });

    it("a page without params left for another (/about/): the page left is not taken for the arrival; home keeps its ack", async () => {
      const { router } = themeRouter(runtime);
      await mount(router);
      const page = preview(runtime, router);
      page.reportStructure();
      page.present("op-home", "/");

      pushHistory(router, "/about/");
      await until(() => router.history.location.pathname === "/about/");
      expect(page.standing(), "at commit, home's leaf is not /about/").toEqual(
        ["op-home"],
      );
      await until(() => resolved(router));
      await nextFrame();

      expect(leafOf(router).routeId).toBe("/about");
      expect(page.standing()).toEqual(["op-home"]);
      expect(page.withdrawn()).toEqual([]);
    });

    it("an encoded slash: leaving /products/a%2Fb for /products/a/b is no arrival at the page left, and the unmatched page pauses every ack", async () => {
      const { router, page } = await homeThenShirt(runtime);
      await arrive(router, "/products/a%2Fb");
      await nextFrame();
      page.present("op-ab", PRODUCT);
      expect(page.standing()).toEqual(["op-ab", "op-home"]);

      await arrive(router, "/products/a/b");
      await nextFrame();

      expect(page.standing(), "nothing stands on a page not matched").toEqual(
        [],
      );
      expect(page.withdrawn()).toEqual(["op-ab", "op-home", "op-shirt"]);
    });

    it.each([
      ["/missing", navigateTo],
      ["/missing/", pushHistory],
    ] as const)("404 (%s): every ack is paused", async (missing, go) => {
      const { router, page } = await homeThenShirt(runtime);

      await arrive(router, missing, go);
      await nextFrame();
      expect(leafOf(router).globalNotFound).toBe(true);

      expect(page.standing()).toEqual([]);
      expect(page.withdrawn()).toEqual(["op-home", "op-shirt"]);
    });

    it.each([
      ["/products/gone", navigateTo],
      ["/products/gone/", pushHistory],
    ] as const)(
      "a loader's notFound (%s): the leaf is the route that threw it",
      async (gone, go) => {
        const { router, page } = await homeThenShirt(runtime);

        await arrive(router, gone, go);
        await nextFrame();
        const leaf = leafOf(router);

        expect({ routeId: leaf.routeId, status: leaf.status }).toEqual({
          routeId: PRODUCT,
          status: "notFound",
        });
        expect(page.standing()).toEqual(["op-home"]);
        expect(page.withdrawn()).toEqual(["op-shirt"]);
      },
    );

    it.each([
      ["/products/broken", navigateTo],
      ["/products/broken/", pushHistory],
    ] as const)(
      "a loader error (%s): the leaf is the route shown with its error; its acks are withdrawn, home keeps its ack",
      async (broken, go) => {
        const { router, page } = await homeThenShirt(runtime);

        await arrive(router, broken, go);
        await nextFrame();
        const leaf = leafOf(router);

        expect({ routeId: leaf.routeId, status: leaf.status }).toEqual({
          routeId: PRODUCT,
          status: "error",
        });
        expect(page.standing()).toEqual(["op-home"]);
        expect(page.withdrawn()).toEqual(["op-shirt"]);
      },
    );

    it.each([
      ["/guarded", navigateTo],
      ["/guarded/", pushHistory],
    ] as const)(
      "a beforeLoad error (%s): the leaf is the route shown with its error; the other pages keep their acks",
      async (guarded, go) => {
        const { router, page } = await homeThenShirt(runtime);

        await arrive(router, guarded, go);
        await nextFrame();
        const leaf = leafOf(router);

        expect({ routeId: leaf.routeId, status: leaf.status }).toEqual({
          routeId: "/guarded",
          status: "error",
        });
        expect(page.standing()).toEqual(["op-home", "op-shirt"]);
        expect(page.withdrawn()).toEqual([]);
      },
    );

    it("a late match: hat's loader finishing after the frame committed /about/ is not taken for the arrival at /about/", async () => {
      const { router, gate, page } = await homeThenShirt(runtime);

      gate.hold("hat");
      pushHistory(router, "/products/hat/");
      await until(() => router.history.location.pathname === "/products/hat/");
      pushHistory(router, "/about/");
      await until(() => router.history.location.pathname === "/about/");
      page.present("op-about-window", "/about");

      gate.release("hat");
      await until(() => resolved(router));
      await nextFrame();
      await nextFrame();

      expect(leafOf(router).routeId).toBe("/about");
      expect(page.applied("op-about-window")).toBe(1);
      expect(page.standing()).toEqual(["op-about-window", "op-home"]);
      expect(page.withdrawn()).toEqual(["op-shirt"]);
    });
  });
});
