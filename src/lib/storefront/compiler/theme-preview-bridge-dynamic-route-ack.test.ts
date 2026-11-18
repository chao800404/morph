// @vitest-environment node
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * Presentation acknowledgements on a dynamic route.
 *
 * A token names the route pattern its section belongs to, so every page of
 * /products/$slug shares the tokens' route. When the frame arrives on such a
 * page, the acknowledgements the bridge gave for that pattern no longer prove
 * what is on screen: /products/hat is not the /products/shirt the author's
 * acknowledged presentation was shown on. They are withdrawn, and the
 * editor writes nothing for the section until the page it now shows has
 * presented it and acknowledged that again.
 *
 * TanStack Router takes up a committed location before its matches follow;
 * here a stand-in router holds a page's matches back until the test lets
 * them arrive, and then reports the navigation resolved, as the real router
 * does once its matches are in.
 *
 * The bridge's ack lifecycle and routing code are run as written, cut from
 * the generated script.
 */

const BRIDGE = themePreviewBridgeEntrySource();
const ORIGIN = "https://preview.morph.test";
/** The capability-scoped address a Client-only build is served from. */
const SERVED_PATH = "/preview-build/build-1/token-1/";
const QUERY = "?morph-preview-session=s1";
const PRODUCT = "/products/$slug";

type Posted = Record<string, unknown>;
type Match = { fullPath: string; pathname: string };

function matchFor(pathname: string): Match {
  return pathname.startsWith("/products/")
    ? { fullPath: PRODUCT, pathname }
    : { fullPath: pathname, pathname };
}

/**
 * A router on memory history whose matches for a held page arrive only when
 * the test releases them. An unheld page's matches follow at once.
 * `arrive` can also hand the router a page's matches after the frame has
 * moved on, as a late resolution would.
 */
function productRouter(initial = "/", reportsResolution = true) {
  const history = createMemoryHistory({ initialEntries: [initial] });
  let location = { pathname: initial };
  let leaf = matchFor(initial);
  const held = new Set<string>();
  const resolved: Array<() => void> = [];
  const arrive = (pathname: string) => {
    leaf = matchFor(pathname);
    queueMicrotask(() => resolved.forEach((listener) => listener()));
  };
  history.subscribe(() => {
    location = { pathname: history.location.pathname };
    if (!held.has(history.location.pathname)) arrive(history.location.pathname);
  });
  return {
    history,
    navigate: vi.fn(async ({ to }: { to: string }) => {
      history.push(to);
    }),
    subscribe: reportsResolution
      ? (event: string, listener: () => void) => {
          if (event === "onResolved") resolved.push(listener);
          return () => {};
        }
      : undefined,
    hold: (pathname: string) => held.add(pathname),
    arrive: (pathname: string) => {
      held.delete(pathname);
      arrive(pathname);
    },
    /**
     * The router resolves without matches that name the committed location
     * (a page it could not match): the arrival cannot be told.
     */
    resolveUnmatched: () => {
      queueMicrotask(() => resolved.forEach((listener) => listener()));
    },
    get state() {
      return { location, matches: [leaf] };
    },
  };
}

function clientPreview(router: ReturnType<typeof productRouter>) {
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

  const posted: Posted[] = [];
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
  /** Every page here renders the one section, shown. */
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
    `let appliedRoutePath = null;
    let selectedItem = null;
    let hoveredItem = null;
    ${source}
    return {
      applyEditorRoute,
      reportStructure,
      syncFrameNavigationEpoch,
      queuePresentationToken,
      flushPendingPresentationTokens,
    };`,
  );
  const bridge = build(
    window,
    {
      getElementById: () => null,
      addEventListener: listen,
      querySelectorAll: () => [section],
    },
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
    (sectionId: string) => `[data-section-id="${sectionId}"]`,
  ) as {
    applyEditorRoute: (message: Posted) => void;
    reportStructure: () => void;
    syncFrameNavigationEpoch: () => number;
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
    return Array.from(stands);
  };
  const withdrawn = () =>
    acks()
      .filter(
        (ack) => ack.status === "not-applied" && ack.reason === "superseded",
      )
      .map((ack) => ack.operationId);
  /** The editor presents the section on the page the frame shows. */
  const present = (operationId: string) => {
    bridge.queuePresentationToken("hero", true, token(operationId));
    bridge.flushPendingPresentationTokens();
  };
  return { ...bridge, posted, standing, withdrawn, present };
}

function token(operationId: string) {
  return {
    workspaceKey: "storefront-1:theme-1",
    templateId: "template-product",
    routePath: PRODUCT,
    sectionId: "hero",
    documentBasis: { kind: "existing", draftGeneration: 1 },
    overlayRevision: 1,
    presentationRevision: 1,
    operationId,
  };
}

/** Lets microtasks and the bridge's navigate-then-report chain run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The author opened /products/shirt and its section's ack is standing. */
async function shirtPresented(reportsResolution = true) {
  const router = productRouter("/", reportsResolution);
  const page = clientPreview(router);
  page.reportStructure();
  page.applyEditorRoute({
    type: "morph:storefront-preview-set-route",
    templateId: "template-product",
    routePath: "/products/shirt",
    routeRequestId: 1,
    navigationIntent: "author",
  });
  await settle();
  expect(router.history.location.pathname).toBe("/products/shirt");
  page.present("op-shirt");
  expect(page.standing()).toEqual(["op-shirt"]);
  return { router, page };
}

describe("a dynamic route's presentation acks when the frame moves between its pages", () => {
  it("withdraws shirt's ack once hat's matches arrive, and only a new ack from hat stands again", async () => {
    const { router, page } = await shirtPresented();

    // A link inside the frame: the router commits /products/hat, and its
    // matches for hat are still on their way.
    router.hold("/products/hat");
    await router.navigate({ to: "/products/hat" });
    await settle();
    expect(router.history.location.pathname).toBe("/products/hat");

    // Hat's matches arrive and the router resolves: hat is on screen.
    router.arrive("/products/hat");
    await settle();

    expect(
      page.standing(),
      "shirt's ack proves nothing about hat; no write may go out on it",
    ).toEqual([]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);

    // The editor presents the section again; hat acknowledges it.
    page.present("op-hat");
    expect(page.standing()).toEqual(["op-hat"]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);
  });
});

describe("rapid navigation between a dynamic route's pages, with matches arriving late", () => {
  it("shirt, hat, sock with every page's matches late: sock's arrival withdraws shirt's ack, and hat's late matches leave sock's ack standing", async () => {
    const { router, page } = await shirtPresented();

    router.hold("/products/hat");
    await router.navigate({ to: "/products/hat" });
    router.hold("/products/sock");
    await router.navigate({ to: "/products/sock" });
    await settle();

    router.arrive("/products/sock");
    await settle();
    expect(page.standing()).toEqual([]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);

    page.present("op-sock");
    expect(page.standing()).toEqual(["op-sock"]);

    // Hat's matches, for a page the frame has already left, come in last.
    router.arrive("/products/hat");
    await settle();

    expect(page.standing(), "sock's ack is sock's").toEqual(["op-sock"]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);
  });

  it("control: shirt, hat (matches late), sock (matches at once): hat's late matches leave sock's ack standing", async () => {
    const { router, page } = await shirtPresented();

    router.hold("/products/hat");
    await router.navigate({ to: "/products/hat" });
    await router.navigate({ to: "/products/sock" });
    await settle();
    expect(page.withdrawn()).toEqual(["op-shirt"]);

    page.present("op-sock");
    router.arrive("/products/hat");
    await settle();

    expect(page.standing(), "sock's ack is sock's").toEqual(["op-sock"]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);
  });

  it("control: shirt, hat (matches late), back to shirt: hat's late matches leave the new shirt ack standing", async () => {
    const { router, page } = await shirtPresented();

    router.hold("/products/hat");
    await router.navigate({ to: "/products/hat" });
    router.history.back();
    await settle();
    expect(router.history.location.pathname).toBe("/products/shirt");
    expect(page.withdrawn()).toEqual(["op-shirt"]);

    page.present("op-shirt-again");
    router.arrive("/products/hat");
    await settle();

    expect(page.standing(), "the shirt shown now acknowledged it").toEqual([
      "op-shirt-again",
    ]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);
  });
});

describe("an arrival the bridge cannot identify", () => {
  it("withdraws the acks it cannot rule out when the router resolves without matching the committed page; a new ack stands again", async () => {
    const { router, page } = await shirtPresented();

    router.hold("/products/hat");
    await router.navigate({ to: "/products/hat" });
    router.resolveUnmatched();
    await settle();

    expect(page.standing(), "writes pause rather than go out on shirt's ack").toEqual(
      [],
    );
    expect(page.withdrawn()).toEqual(["op-shirt"]);

    page.present("op-hat");
    expect(page.standing()).toEqual(["op-hat"]);
  });

  it("withdraws them at once under a router that cannot say when its matches arrive; a new ack stands again", async () => {
    const { router, page } = await shirtPresented(false);

    router.hold("/products/hat");
    await router.navigate({ to: "/products/hat" });
    await settle();

    expect(page.standing()).toEqual([]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);

    router.arrive("/products/hat");
    await settle();
    page.present("op-hat");
    expect(page.standing()).toEqual(["op-hat"]);
    expect(page.withdrawn()).toEqual(["op-shirt"]);
  });
});
