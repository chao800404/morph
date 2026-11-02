// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * D3: on a page that navigates as documents (Astro), set-route loads the
 * other page in the frame, keeping the editor's channel query, and answers
 * only from the page it was sent to. A Start page keeps exactly what it did.
 *
 * The bridge's routing code is run as written, cut from the generated
 * script, with the page around it stood in for.
 */

const BRIDGE = themePreviewBridgeEntrySource();
const ORIGIN = "https://preview.morph.test";
const QUERY = "?morph-preview-session=s1&viewport=mobile";

type Posted = Record<string, unknown>;

function bridgeRouting(page: {
  navigation?: string;
  pathname: string;
  router?: { navigate: (options: unknown) => unknown; state?: unknown };
  /** What the document before this one recorded on its way out. */
  recorded?: string;
  storageThrows?: boolean;
  selectionEnabled?: boolean;
}) {
  const start = BRIDGE.indexOf("const documentNavigation =");
  const end = BRIDGE.indexOf("function clearSelectionAttributes");
  expect(start, "the bridge's document navigation").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = BRIDGE.slice(start, end);

  const posted: Posted[] = [];
  const assigned: string[] = [];
  const warned: string[] = [];
  const stored = new Map<string, string>();
  const channel = { previewSession: "s1" };
  const key = "morph:preview-document-navigation:s1";
  if (page.recorded !== undefined) stored.set(key, page.recorded);
  const sessionStorage = {
    getItem: (name: string) => {
      if (page.storageThrows) throw new Error("denied");
      return stored.get(name) ?? null;
    },
    setItem: (name: string, value: string) => {
      if (page.storageThrows) throw new Error("denied");
      stored.set(name, value);
    },
    removeItem: (name: string) => {
      if (page.storageThrows) throw new Error("denied");
      stored.delete(name);
    },
  };
  const location = {
    pathname: page.pathname,
    search: QUERY,
    origin: ORIGIN,
    href: `${ORIGIN}${page.pathname}${QUERY}#top`,
    assign: (url: string) => assigned.push(url),
  };
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const listen = (type: string, listener: (event: unknown) => void) => {
    (listeners[type] ??= []).push(listener);
  };
  const window = {
    __morphPreviewNavigation: page.navigation,
    __morphPreviewRouter: page.router,
    setTimeout: () => 0,
    addEventListener: listen,
  };
  const fire = (type: string, event: unknown = {}) =>
    (listeners[type] ?? []).forEach((listener) => listener(event));
  const finish = vi.fn();
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
    `let appliedRoutePath = null;
    let selectedItem = { label: "Hero" };
    let hoveredItem = null;
    ${source}
    return {
      applyEditorRoute,
      currentRoutePattern,
      applied: () => appliedRoutePath,
    };`,
  );
  const bridge = build(
    window,
    { getElementById: () => null, addEventListener: listen },
    location,
    sessionStorage,
    { warn: (line: string) => warned.push(line) },
    channel,
    (message: Posted) => posted.push(message),
    () => [],
    { finish },
    () => {},
    () => {},
    () => {},
    page.selectionEnabled ?? false,
  ) as {
    applyEditorRoute: (message: Posted) => void;
    currentRoutePattern: () => string | undefined;
    applied: () => string | null;
  };
  return { ...bridge, posted, assigned, warned, stored, key, finish, fire };
}

const setRoute = (routePath: string | null, routeRequestId = 7) => ({
  type: "morph:storefront-preview-set-route",
  templateId: "template-1",
  routePath,
  routeRequestId,
});

describe("a Start page (no document navigation declared)", () => {
  it("without a router stays where it is, answers with no route, and names none", () => {
    const page = bridgeRouting({ pathname: "/" });

    page.applyEditorRoute(setRoute("/about"));

    expect(page.assigned).toEqual([]);
    expect(page.posted).toEqual([
      {
        type: "morph:storefront-preview-route-applied",
        routeRequestId: 7,
        routePath: null,
      },
    ]);
    expect(page.currentRoutePattern()).toBeUndefined();
  });

  it("with a router navigates the router, never the document", () => {
    const navigate = vi.fn(() => Promise.resolve());
    const page = bridgeRouting({ pathname: "/", router: { navigate } });

    page.applyEditorRoute(setRoute("/about"));

    expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/about" });
    expect(page.assigned).toEqual([]);
  });

  it("is not switched to document navigation by any other value", () => {
    const page = bridgeRouting({ pathname: "/", navigation: "router" });

    page.applyEditorRoute(setRoute("/about"));

    expect(page.assigned).toEqual([]);
    expect(page.posted.at(-1)).toMatchObject({ routePath: null });
  });
});

describe("a page that navigates as documents (Astro)", () => {
  it("loads the other page in the frame, keeping the channel query, and answers nothing yet", () => {
    const page = bridgeRouting({ pathname: "/", navigation: "document" });

    page.applyEditorRoute(setRoute("/about"));

    expect(page.assigned).toEqual([`${ORIGIN}/about${QUERY}`]);
    expect(page.posted).toEqual([]);
    expect(page.applied()).toBeNull();
    expect(page.stored.get(page.key)).toBe("editor:/about");
    // An open text edit is finished before the document goes.
    expect(page.finish).toHaveBeenCalledWith(true);
  });

  it("answers from the page it was sent to, naming where it is", () => {
    const page = bridgeRouting({
      pathname: "/about/",
      navigation: "document",
      recorded: "editor:/about",
    });

    page.applyEditorRoute(setRoute("/about", 9));

    expect(page.assigned).toEqual([]);
    expect(page.posted).toEqual([
      {
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/about/",
      },
      {
        type: "morph:storefront-preview-route-applied",
        routeRequestId: 9,
        routePath: "/about/",
      },
    ]);
    expect(page.applied()).toBe("/about");
    expect(page.currentRoutePattern()).toBe("/about/");
    // Read and forgotten as the document loaded.
    expect(page.stored.has(page.key)).toBe(false);
  });

  it("matches a percent-encoded path to the same page", () => {
    const encoded = `/${encodeURIComponent("關於")}`;
    const page = bridgeRouting({ pathname: encoded, navigation: "document" });

    page.applyEditorRoute(setRoute(encoded));

    expect(page.assigned).toEqual([]);
    expect(page.posted.at(-1)).toMatchObject({ routePath: encoded });
  });

  it("never loads a dynamic route pattern as an address", () => {
    const page = bridgeRouting({ pathname: "/", navigation: "document" });

    page.applyEditorRoute(setRoute("/blog/[slug]"));
    page.applyEditorRoute(setRoute("/docs/[...rest]"));

    expect(page.assigned).toEqual([]);
    expect(page.posted).toEqual([]);
    expect(page.warned).toHaveLength(2);
  });

  it("never loads another origin", () => {
    const page = bridgeRouting({ pathname: "/", navigation: "document" });

    page.applyEditorRoute(setRoute("//elsewhere.test/x"));
    page.applyEditorRoute(setRoute("/\\elsewhere.test/x"));

    expect(page.assigned).toEqual([]);
    expect(page.posted).toEqual([]);
  });

  it("answers where a redirect landed instead of loading it again", () => {
    // Sent to /about, redirected to /login: sending it again would loop.
    const page = bridgeRouting({
      pathname: "/login",
      navigation: "document",
      recorded: "editor:/about",
    });

    page.applyEditorRoute(setRoute("/about", 8));

    expect(page.assigned).toEqual([]);
    // Answered, then reported: the editor follows the frame from that report.
    expect(page.posted).toEqual([
      {
        type: "morph:storefront-preview-route-applied",
        routeRequestId: 8,
        routePath: "/login",
      },
      {
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/login",
      },
    ]);
    expect(page.applied()).toBeNull();

    // The author asking again tries again, once.
    page.applyEditorRoute(setRoute("/about", 10));
    expect(page.assigned).toEqual([`${ORIGIN}/about${QUERY}`]);
  });

  it("loads a page the editor asks for that is not the one it sent the last load to", () => {
    const page = bridgeRouting({
      pathname: "/about",
      navigation: "document",
      recorded: "editor:/about",
    });

    page.applyEditorRoute(setRoute("/contact"));

    expect(page.assigned).toEqual([`${ORIGIN}/contact${QUERY}`]);
  });

  it("stays on a page the author opened by a link in the frame, and says where it is", () => {
    const page = bridgeRouting({
      pathname: "/about",
      navigation: "document",
      recorded: "frame",
    });

    // The editor still names the page it had.
    page.applyEditorRoute(setRoute("/", 11));

    expect(page.assigned).toEqual([]);
    expect(page.posted).toEqual([
      {
        type: "morph:storefront-preview-route-applied",
        routeRequestId: 11,
        routePath: "/about",
      },
      {
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: "/about",
      },
    ]);
    // Only that first request: one the editor sends after it is followed.
    page.applyEditorRoute(setRoute("/contact", 12));
    expect(page.assigned).toEqual([`${ORIGIN}/contact${QUERY}`]);
  });

  it("the frame the editor loaded, or a reload of it, is sent to the editor's page", () => {
    const page = bridgeRouting({ pathname: "/", navigation: "document" });

    page.applyEditorRoute(setRoute("/about"));

    expect(page.assigned).toEqual([`${ORIGIN}/about${QUERY}`]);
  });

  describe("telling the next document the author left by a link", () => {
    const link = (attributes: Record<string, string> = {}) => ({
      button: 0,
      target: {
        closest: () => ({
          target: attributes.target ?? "",
          hasAttribute: (name: string) => name in attributes,
        }),
      },
    });

    it("records it on the way out after a link click", () => {
      const page = bridgeRouting({ pathname: "/", navigation: "document" });
      page.fire("click", link());
      page.fire("pagehide");
      expect(page.stored.get(page.key)).toBe("frame");
    });

    it("records it after a form is sent", () => {
      const page = bridgeRouting({ pathname: "/", navigation: "document" });
      page.fire("submit");
      page.fire("pagehide");
      expect(page.stored.get(page.key)).toBe("frame");
    });

    it("records nothing when the frame is replaced without a click, or opens a link elsewhere", () => {
      const page = bridgeRouting({ pathname: "/", navigation: "document" });
      page.fire("pagehide");
      expect(page.stored.has(page.key)).toBe(false);
      page.fire("click", link({ target: "_blank" }));
      page.fire("click", link({ download: "" }));
      page.fire("click", { ...link(), metaKey: true });
      page.fire("pagehide");
      expect(page.stored.has(page.key)).toBe(false);
    });

    it("records nothing in select mode, where the click is the editor's", () => {
      const page = bridgeRouting({
        pathname: "/",
        navigation: "document",
        selectionEnabled: true,
      });
      page.fire("click", link());
      page.fire("pagehide");
      expect(page.stored.has(page.key)).toBe(false);
    });

    it("leaves the editor's own record when it is the editor that sends the frame", () => {
      const page = bridgeRouting({ pathname: "/", navigation: "document" });
      page.fire("click", link());
      page.applyEditorRoute(setRoute("/about"));
      page.fire("pagehide");
      expect(page.stored.get(page.key)).toBe("editor:/about");
    });
  });

  it("does not navigate when it cannot record the load", () => {
    const page = bridgeRouting({
      pathname: "/",
      navigation: "document",
      storageThrows: true,
    });

    page.applyEditorRoute(setRoute("/about"));

    expect(page.assigned).toEqual([]);
    expect(page.posted).toEqual([]);
  });
});
