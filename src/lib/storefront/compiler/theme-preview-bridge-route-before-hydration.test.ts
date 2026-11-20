import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * A set-route that reaches the bridge before React has finished hydrating.
 *
 * Full Start hydrates inside startTransition, so the bridge can be up (and
 * the editor can send set-route) before TanStack's <Transitioner> has
 * committed. Transitioner is what subscribes `router.load` to the router's
 * history. Until then the only history subscriber is the bridge's own epoch
 * listener, and TanStack's commitLocation loads by itself only when history
 * has no subscriber at all. So `router.navigate` pushes the new address and
 * nothing ever loads it: the address is the target, the page on screen is
 * the one it booted on, and `navigate`'s promise never settles.
 *
 * Here the bridge's routing code runs as written, cut from the generated
 * script, against a real TanStack router on memory history whose
 * Transitioner has not mounted yet.
 */

const BRIDGE = themePreviewBridgeEntrySource();
const TARGET = "/selection-field-home";

type Posted = Record<string, unknown>;

/** A Theme's router as Start hydrated it: matches on the page it booted on. */
async function hydratedRouter(bootedAt = "/") {
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: TARGET }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [bootedAt] }),
    isServer: false,
  });
  await router.load();
  return router;
}

type Router = Awaited<ReturnType<typeof hydratedRouter>>;

/** What <Transitioner>'s mount effect does once the hydrated tree commits. */
function mountTransitioner(router: Router) {
  return router.history.subscribe(router.load);
}

function startPreview(router: Router, search = "") {
  const start = BRIDGE.indexOf("const documentNavigation =");
  const end = BRIDGE.indexOf("function clearSelectionAttributes");
  expect(start, "the bridge's routing code").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = BRIDGE.slice(start, end);

  const posted: Posted[] = [];
  const location = {
    pathname: "/",
    search,
    origin: "http://127.0.0.1:5178",
    href: "http://127.0.0.1:5178/" + search,
    assign: () => {
      throw new Error("a Start preview navigates with its router");
    },
  };
  const listen = () => {};
  const window = {
    __morphPreviewNavigation: undefined,
    __morphPreviewRouter: router,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    addEventListener: listen,
  };
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
    "withdrawAppliedPresentationAcks",
    "flushArrivedPresentationTokens",
    `let appliedRoutePath = null;
    let selectedItem = null;
    let hoveredItem = null;
    ${source}
    return { applyEditorRoute, reportStructure };`,
  );
  const bridge = build(
    window,
    { getElementById: () => null, addEventListener: listen },
    location,
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
    () => {},
    () => {},
  ) as {
    applyEditorRoute: (message: Posted) => void;
    reportStructure: () => void;
  };
  const answers = () =>
    posted.filter(
      (message) => message.type === "morph:storefront-preview-route-applied",
    );
  return { ...bridge, posted, answers };
}

const setRoute = (routePath: string, routeRequestId: number) => ({
  type: "morph:storefront-preview-set-route",
  templateId: "template-1",
  routePath,
  routeRequestId,
  navigationIntent: "author",
});

const leafPath = (router: Router) => router.state.matches.at(-1)?.fullPath;

/** Lets the router's load and the bridge's navigate-then-report chain run. */
async function settle(rounds = 20) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("a set-route that arrives before the Start router's Transitioner mounts", () => {
  it("loads the route it pushed, reports its structure and answers only for it", async () => {
    const router = await hydratedRouter();
    const page = startPreview(router);
    // The bridge is up and has reported ready: it now listens to history.
    page.reportStructure();
    expect(
      router.history.subscribers.size,
      "only the bridge listens; Transitioner has not mounted",
    ).toBe(1);

    page.applyEditorRoute(setRoute(TARGET, 7));
    await settle();

    expect(router.history.location.pathname).toBe(TARGET);
    expect(leafPath(router), "the page on screen is the one asked for").toBe(
      TARGET,
    );
    // resolvedLocation is Transitioner's to set; the router itself has
    // taken the location up and finished loading it.
    expect(router.state.location.pathname).toBe(TARGET);
    expect(router.state.isLoading).toBe(false);
    expect(page.answers()).toEqual([
      {
        type: "morph:storefront-preview-route-applied",
        routeRequestId: 7,
        routePath: TARGET,
        status: "applied",
      },
    ]);
    const answerAt = page.posted.indexOf(page.answers()[0]!);
    const structureBefore = page.posted
      .slice(0, answerAt)
      .filter(
        (message) => message.type === "morph:storefront-preview-structure",
      )
      .at(-1);
    expect(
      structureBefore?.routePath,
      "the structure reported before the answer is the target's",
    ).toBe(TARGET);

    // Hydration commits afterwards and Transitioner subscribes; nothing is
    // loaded twice into a different page, and nothing more is answered.
    mountTransitioner(router);
    await settle();
    expect(leafPath(router)).toBe(TARGET);
    expect(page.answers()).toHaveLength(1);

    // The next set-route goes through Transitioner's load as usual.
    page.applyEditorRoute(setRoute("/", 8));
    await settle();
    expect(leafPath(router)).toBe("/");
    expect(page.answers().map((answer) => answer.routePath)).toEqual([
      TARGET,
      "/",
    ]);
  });

  it("control: once Transitioner has mounted, the bridge leaves loading to it", async () => {
    const router = await hydratedRouter();
    const load = vi.spyOn(router, "load");
    // Hydration has committed: Transitioner subscribed (the spied) load.
    mountTransitioner(router);
    const page = startPreview(router);
    page.reportStructure();
    expect(router.history.subscribers.size).toBe(2);

    page.applyEditorRoute(setRoute(TARGET, 9));
    await settle();

    expect(leafPath(router)).toBe(TARGET);
    expect(load, "one load, Transitioner's").toHaveBeenCalledTimes(1);
    expect(page.answers().map((answer) => answer.routeRequestId)).toEqual([9]);
  });

  it("loads a set-route to the booted pathname whose location differs only in search", async () => {
    // The frame boots on the editor's channel query; the editor's set-route
    // names "/", and navigate builds "/" without that query. The pathname is
    // the one already shown, but the router pushed a new location.
    const booted = "/?editorOrigin=x&previewSession=y";
    const router = await hydratedRouter(booted);
    const load = vi.spyOn(router, "load");
    const page = startPreview(router, "?editorOrigin=x&previewSession=y");
    page.reportStructure();
    expect(
      router.history.subscribers.size,
      "only the bridge listens; Transitioner has not mounted",
    ).toBe(1);

    page.applyEditorRoute(setRoute("/", 11));
    await settle();

    expect(router.history.location.pathname).toBe("/");
    expect(router.history.location.search).toBe("");
    expect(load, "someone loaded the pushed location").toHaveBeenCalled();
    expect(router.state.location.searchStr).toBe("");
    expect(router.state.isLoading).toBe(false);
    expect(page.answers()).toEqual([
      {
        type: "morph:storefront-preview-route-applied",
        routeRequestId: 11,
        routePath: "/",
        status: "applied",
      },
    ]);
  });

  it("control: a set-route to exactly the current location adds no load of its own", async () => {
    const router = await hydratedRouter("/");
    const load = vi.spyOn(router, "load");
    const page = startPreview(router);
    page.reportStructure();
    expect(router.history.subscribers.size).toBe(1);

    page.applyEditorRoute(setRoute("/", 12));
    await settle();

    expect(router.history.location.pathname).toBe("/");
    expect(router.history.location.search).toBe("");
    // The router reloads a same-URL navigate itself; the bridge adds none.
    expect(load, "only the router's own same-URL load").toHaveBeenCalledTimes(
      1,
    );
    expect(page.answers().map((answer) => answer.routeRequestId)).toEqual([
      12,
    ]);
  });
});
