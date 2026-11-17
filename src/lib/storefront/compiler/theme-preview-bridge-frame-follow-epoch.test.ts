// @vitest-environment node
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * The frame-follow guard on a Client-only preview.
 *
 * A Client-only preview runs the Theme's router on memory history: the
 * page's own address never moves, whatever page the router shows. The frame
 * navigation epoch has to count the navigations the router committed, so a
 * frame-follow set-route the editor sent for a page the frame has already
 * left (the frame went on, or back, before it arrived) is refused, as it is
 * under Full Start's browser history.
 *
 * The bridge's routing code is run as written, cut from the generated
 * script, with a real TanStack memory history under a stand-in router.
 */

const BRIDGE = themePreviewBridgeEntrySource();
const ORIGIN = "https://preview.morph.test";
/** The capability-scoped address a Client-only build is served from. */
const SERVED_PATH = "/preview-build/build-1/token-1/";
const QUERY = "?morph-preview-session=s1";

type Posted = Record<string, unknown>;

/**
 * A router on memory history, as the Client-only bootstrap creates one:
 * `navigate` commits to the history, and the state names what it shows.
 */
function memoryRouter(initial = "/") {
  const history = createMemoryHistory({ initialEntries: [initial] });
  const navigate = vi.fn(async ({ to }: { to: string }) => {
    history.push(to);
  });
  return {
    history,
    navigate,
    get state() {
      const pathname = history.location.pathname;
      return { location: { pathname }, matches: [{ fullPath: pathname }] };
    },
  };
}

function clientPreview(router: ReturnType<typeof memoryRouter>) {
  const start = BRIDGE.indexOf("const documentNavigation =");
  const end = BRIDGE.indexOf("function clearSelectionAttributes");
  expect(start, "the bridge's routing code").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = BRIDGE.slice(start, end);

  const posted: Posted[] = [];
  const withdrawn: string[] = [];
  const location = {
    pathname: SERVED_PATH,
    search: QUERY,
    origin: ORIGIN,
    href: `${ORIGIN}${SERVED_PATH}${QUERY}`,
    assign: () => {
      throw new Error("a Client-only preview never loads another document");
    },
  };
  const listen = () => {};
  const window = {
    __morphPreviewNavigation: undefined,
    __morphPreviewRouter: router,
    setTimeout: () => 0,
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
    `let appliedRoutePath = null;
    let selectedItem = null;
    let hoveredItem = null;
    ${source}
    return { applyEditorRoute, reportStructure, syncFrameNavigationEpoch };`,
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
    (route: string) => withdrawn.push(route),
  ) as {
    applyEditorRoute: (message: Posted) => void;
    reportStructure: () => void;
    syncFrameNavigationEpoch: () => number;
  };
  const structures = () =>
    posted.filter(
      (message) => message.type === "morph:storefront-preview-structure",
    );
  const lastEpoch = () => {
    bridge.reportStructure();
    return structures().at(-1)!.frameNavigationEpoch as number;
  };
  const answers = () =>
    posted.filter(
      (message) => message.type === "morph:storefront-preview-route-applied",
    );
  return { ...bridge, posted, withdrawn, structures, lastEpoch, answers };
}

const setRoute = (
  routePath: string,
  routeRequestId: number,
  intent: "author" | "frame-follow",
  followEpoch?: number,
) => ({
  type: "morph:storefront-preview-set-route",
  templateId: "template-1",
  routePath,
  routeRequestId,
  navigationIntent: intent,
  ...(followEpoch === undefined ? {} : { followEpoch }),
});

/** Lets the bridge's navigate-then-report chain run to its answer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The page the editor opened on, sent by the editor as the author's page. */
async function openedOn(routePath: string) {
  const router = memoryRouter("/");
  const page = clientPreview(router);
  page.reportStructure();
  page.applyEditorRoute(setRoute(routePath, 1, "author"));
  await settle();
  expect(router.history.location.pathname).toBe(routePath);
  return { router, page };
}

describe("a Client-only preview (memory history) counting frame navigations", () => {
  it("refuses a frame-follow set-route for a page the frame went back from before it arrived", async () => {
    const { router, page } = await openedOn("/home");

    // A link inside the frame: the Theme's router commits /detail.
    await router.navigate({ to: "/detail" });
    const followedEpoch = page.lastEpoch();
    // The editor follows; its set-route is on its way when the frame goes
    // back by its own history.
    const follow = setRoute("/detail", 2, "frame-follow", followedEpoch);
    router.history.back();
    expect(router.history.location.pathname).toBe("/home");

    page.applyEditorRoute(follow);
    await settle();

    expect(router.history.location.pathname, "the frame stays where it went").toBe(
      "/home",
    );
    expect(
      router.navigate.mock.calls.filter(([options]) => options.to === "/detail"),
      "only the frame's own link went to /detail",
    ).toHaveLength(1);
    expect(page.answers().at(-1)).toMatchObject({
      routeRequestId: 2,
      routePath: "/home",
      status: "superseded",
    });
  });

  it("applies a frame-follow set-route that names the navigation the frame is still on", async () => {
    const { router, page } = await openedOn("/home");
    await router.navigate({ to: "/detail" });
    const epoch = page.lastEpoch();

    page.applyEditorRoute(setRoute("/detail", 2, "frame-follow", epoch));
    await settle();

    expect(router.history.location.pathname).toBe("/detail");
    expect(page.answers().at(-1)).toMatchObject({
      routeRequestId: 2,
      routePath: "/detail",
      status: "applied",
    });
  });

  it("advances the epoch exactly once for one navigation the router committed", async () => {
    const { router, page } = await openedOn("/home");
    const before = page.lastEpoch();
    const withdrawalsBefore = page.withdrawn.length;

    await router.navigate({ to: "/detail" });

    expect(page.lastEpoch()).toBe(before + 1);
    expect(page.withdrawn.slice(withdrawalsBefore)).toEqual(["/detail"]);

    router.history.back();
    expect(page.lastEpoch()).toBe(before + 2);
    router.history.forward();
    expect(page.lastEpoch()).toBe(before + 3);
    expect(page.withdrawn.slice(withdrawalsBefore)).toEqual([
      "/detail",
      "/home",
      "/detail",
    ]);
  });

  it("does not advance for repeated structure reports, renders or the editor's echo of the page on screen", async () => {
    const { router, page } = await openedOn("/home");
    await router.navigate({ to: "/detail" });
    const epoch = page.lastEpoch();
    const withdrawals = page.withdrawn.length;

    // Repeated structure reports and syncs.
    page.reportStructure();
    page.reportStructure();
    page.syncFrameNavigationEpoch();
    // A render that commits no navigation: the router re-reads the same
    // location (a content refresh), which history subscribers hear as a
    // replace of the entry on screen.
    router.history.replace("/detail");
    // The editor's answer to the frame's move: a set-route for the page the
    // frame is already on.
    page.applyEditorRoute(setRoute("/detail", 2, "frame-follow", epoch));
    await settle();

    expect(page.lastEpoch()).toBe(epoch);
    expect(page.withdrawn).toHaveLength(withdrawals);
    expect(page.answers().at(-1)).toMatchObject({
      routeRequestId: 2,
      status: "applied",
    });
  });

  it("takes up the router without counting a navigation: the served address is not a page", () => {
    const router = memoryRouter("/");
    const page = clientPreview(router);

    expect(page.lastEpoch()).toBe(0);
    expect(page.lastEpoch()).toBe(0);
    expect(page.withdrawn).toEqual([]);
  });

  it("still takes the author's page selection after any number of frame navigations", async () => {
    const { router, page } = await openedOn("/home");
    await router.navigate({ to: "/detail" });
    router.history.back();
    await router.navigate({ to: "/other" });

    page.applyEditorRoute(setRoute("/home", 5, "author"));
    await settle();

    expect(router.history.location.pathname).toBe("/home");
    expect(page.answers().at(-1)).toMatchObject({
      routeRequestId: 5,
      routePath: "/home",
      status: "applied",
    });
  });
});
