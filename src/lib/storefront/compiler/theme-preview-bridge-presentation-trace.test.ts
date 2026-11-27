// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * The frame's half of the presentation trace: what the bridge did with each
 * token, as `[preview-presentation] frame ...` lines carrying the operation
 * id the editor logged when it posted it. The bridge's ack lifecycle is run
 * as written, cut from the generated script.
 */

const BRIDGE = themePreviewBridgeEntrySource();
const DOCUMENT_ID = "fedcba9876543210fedcba9876543210";
const SESSION = "5f0f0f6e-6c2e-4f1c-9a3e-0f9a2b7c1d4e";

function token(operationId: string, routePath = "/") {
  return {
    workspaceKey: "storefront-1:theme-1",
    templateId: "template-1",
    routePath,
    sectionId: "hero",
    documentBasis: { kind: "existing", draftGeneration: 1 },
    overlayRevision: 1,
    presentationRevision: 1,
    operationId,
  };
}

function ackLifecycle(options: { rendered?: boolean; route?: string } = {}) {
  const start = BRIDGE.indexOf("const pendingPresentationTokens = new Map();");
  const end = BRIDGE.indexOf("function flushEarlyPresentationTokens");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const lines: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const section = { hasAttribute: () => false };
  const build = new Function(
    "console",
    "document",
    "location",
    "channel",
    "postPreviewToEditorMessage",
    "previewSectionSelector",
    "documentPreviewIdentity",
    "settleArrivalWithdrawal",
    "currentRoutePattern",
    "pendingArrivalWithdrawal",
    `${BRIDGE.slice(start, end)}
    return { queuePresentationToken, flushPendingPresentationTokens, withdrawAppliedPresentationAcks };`,
  );
  const bridge = build(
    { info: (line: string) => lines.push(line), warn: () => {} },
    {
      querySelectorAll: () => (options.rendered === false ? [] : [section]),
    },
    { pathname: options.route ?? "/" },
    { previewSession: SESSION },
    (message: Record<string, unknown>) => posted.push(message),
    (sectionId: string) => `[data-section-id="${sectionId}"]`,
    () => DOCUMENT_ID,
    () => {},
    () => options.route ?? "/",
    null,
  ) as {
    queuePresentationToken: (
      sectionId: string,
      enabled: boolean,
      token: Record<string, unknown>,
      props?: unknown,
    ) => void;
    flushPendingPresentationTokens: () => void;
    withdrawAppliedPresentationAcks: (route: string | null) => void;
  };
  return { ...bridge, lines, posted };
}

describe("the bridge's [preview-presentation] frame lines", () => {
  it("says a token was queued and answered, by the operation id the editor posted", () => {
    const frame = ackLifecycle();
    frame.queuePresentationToken("hero", true, token("section-presentation-4"));
    frame.flushPendingPresentationTokens();
    expect(frame.lines).toEqual([
      "[preview-presentation] frame queued op=section-presentation-4 section=hero route=/ doc=fedcba98",
      "[preview-presentation] frame answered op=section-presentation-4 section=hero route=/ status=applied doc=fedcba98",
    ]);
    expect(frame.posted).toHaveLength(1);
  });

  it("says why a token was answered not-applied: superseded, another route, not rendered", () => {
    const frame = ackLifecycle({ rendered: false });
    frame.queuePresentationToken("hero", true, token("op-1"));
    frame.queuePresentationToken("hero", true, token("op-2"));
    frame.queuePresentationToken("other", true, {
      ...token("op-3", "/elsewhere"),
      sectionId: "other",
    });
    frame.flushPendingPresentationTokens();
    expect(frame.lines).toContain(
      "[preview-presentation] frame answered op=op-1 section=hero route=/ status=not-applied reason=superseded doc=fedcba98",
    );
    expect(frame.lines).toContain(
      "[preview-presentation] frame answered op=op-2 section=hero route=/ status=not-applied reason=section-missing cause=not-rendered doc=fedcba98",
    );
    expect(frame.lines).toContain(
      "[preview-presentation] frame answered op=op-3 section=other route=/elsewhere status=not-applied reason=section-missing cause=other-route doc=fedcba98",
    );
  });

  it("names neither the session, the full document id nor the workspace", () => {
    const frame = ackLifecycle();
    frame.queuePresentationToken("hero", true, token("op-1"));
    frame.flushPendingPresentationTokens();
    frame.withdrawAppliedPresentationAcks(null);
    expect(frame.lines.length).toBeGreaterThan(2);
    for (const line of frame.lines) {
      expect(line).not.toContain(SESSION);
      expect(line).not.toContain(DOCUMENT_ID);
      expect(line).not.toContain("storefront-1:theme-1");
    }
    expect(frame.lines.at(-1)).toContain("cause=withdrawn");
  });

  it("is bounded: at most 64 lines in a burst, then one line saying the rest are dropped", () => {
    const frame = ackLifecycle();
    for (let index = 0; index < 200; index += 1) {
      frame.queuePresentationToken("hero", true, token(`op-${index}`));
    }
    expect(frame.lines).toHaveLength(65);
    expect(frame.lines.at(-1)).toBe(
      "[preview-presentation] frame lines suppressed after 64 in 10 s doc=fedcba98",
    );
    // The acknowledgements themselves are not bounded.
    expect(frame.posted).toHaveLength(199);
  });
});

/** A top-level function declaration of the bridge, cut out as written. */
function cutFunction(name: string) {
  const start = BRIDGE.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = BRIDGE.indexOf("\n}\n", start);
  return BRIDGE.slice(start, end + 2);
}

describe("the bridge's [preview-frame] lines", () => {
  function structureReporter() {
    const lines: string[] = [];
    let nodes: Array<Record<string, unknown>> = [];
    let epoch = 0;
    const build = new Function(
      "console",
      "document",
      "channel",
      "postPreviewToEditorMessage",
      "collectPreviewEditableNodes",
      "syncFrameNavigationEpoch",
      "currentRoutePattern",
      "documentPreviewIdentity",
      `${cutFunction("traceFrame")}\n${cutFunction("reportStructure")}\nreturn reportStructure;`,
    );
    const report = build(
      { info: (line: string) => lines.push(line) },
      {},
      { previewSession: SESSION },
      () => {},
      () => nodes,
      () => epoch,
      () => "/",
      () => DOCUMENT_ID,
    ) as () => void;
    return {
      lines,
      report,
      setNodes: (next: Array<Record<string, unknown>>) => {
        nodes = next;
      },
      setEpoch: (next: number) => {
        epoch = next;
      },
    };
  }

  it("says a structure report when what it says changes, with counts, route and epoch, and never node labels", () => {
    const frame = structureReporter();
    frame.report();
    frame.setNodes([
      { sectionId: "hero", label: "Secret heading text" },
      { sectionId: "hero", label: "Another label" },
      { sectionId: "footer", label: "Footer label" },
    ]);
    frame.report();
    frame.report();
    frame.report();
    frame.setEpoch(2);
    frame.report();
    expect(frame.lines).toEqual([
      "[preview-frame] frame structure posted sections=0 nodes=0 route=/ epoch=0 reports=1 doc=fedcba98",
      "[preview-frame] frame structure posted sections=2 nodes=3 route=/ epoch=0 reports=2 doc=fedcba98",
      "[preview-frame] frame structure posted sections=2 nodes=3 route=/ epoch=2 reports=5 doc=fedcba98",
    ]);
    for (const line of frame.lines) {
      expect(line).not.toContain("label");
      expect(line).not.toContain("Secret");
    }
  });

  it("says each ready it posts", () => {
    const lines: string[] = [];
    const posted: unknown[] = [];
    new Function(
      "console",
      "document",
      "channel",
      "servedInstanceReport",
      "postPreviewToEditorMessage",
      "reportStructure",
      "window",
      "BRIDGE_CAPABILITIES",
      "documentPreviewIdentity",
      `let editorSupportsCodeDefault = false; let editorSupportsAstroIdentity = false; let bootstrapNonce = null;
      ${cutFunction("traceFrame")}\n${cutFunction("reportReady")}\nreportReady();`,
    )(
      { info: (line: string) => lines.push(line) },
      { readyState: "complete" },
      { previewSession: SESSION },
      () => null,
      (message: unknown) => posted.push(message),
      () => {},
      { dispatchEvent: () => true },
      ["section-presentation-ack-v1"],
      () => DOCUMENT_ID,
    );
    expect(posted).toHaveLength(1);
    expect(lines).toEqual([
      "[preview-frame] frame ready posted readyState=complete served=unnamed capabilities=section-presentation-ack-v1 doc=fedcba98",
    ]);
  });

  it("says when it asks the router to load a committed location it has not loaded, and only then", () => {
    const lines: string[] = [];
    const load = vi.fn(async () => {});
    const run = new Function(
      "console",
      "committedFrameLocation",
      "matchesReachedPath",
      "documentPreviewIdentity",
      `${cutFunction("traceFrame")}\n${cutFunction("loadUnloadedCommittedLocation")}\n${cutFunction("routerTookUpCommittedLocation")}\nreturn loadUnloadedCommittedLocation;`,
    )(
      { info: (line: string) => lines.push(line) },
      (router: { history: { location: { pathname: string } } }) => ({
        pathname: router.history.location.pathname,
      }),
      () => false,
      () => DOCUMENT_ID,
    ) as (router: unknown) => void;
    const at = (pathname: string, search = "") => ({
      pathname,
      search,
      hash: "",
    });
    const taken = (pathname: string, searchStr = "") => ({
      pathname,
      searchStr,
      hash: "",
    });
    run({
      load,
      history: { location: at("/products/shirt") },
      state: { isLoading: false, location: taken("/") },
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      "[preview-frame] frame router load for committed location committed=/products/shirt routerAt=/ doc=fedcba98",
    ]);
    // Already there: no load, no line.
    run({
      load,
      history: { location: at("/products/shirt") },
      state: { isLoading: false, location: taken("/products/shirt") },
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    // Only the query differs (the frame booted on the editor's query): a
    // load and a line that names paths only, never the query.
    run({
      load,
      history: { location: at("/") },
      state: {
        isLoading: false,
        location: taken("/", "?editorOrigin=x&previewSession=Secret"),
      },
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      "[preview-frame] frame router load for committed location committed=/products/shirt routerAt=/ doc=fedcba98",
      "[preview-frame] frame router load for committed location committed=/ routerAt=/ doc=fedcba98",
    ]);
    for (const line of lines) {
      expect(line).not.toContain("Secret");
      expect(line).not.toContain("editorOrigin");
    }
  });

  it("says when the bridge starts, from the page's own start", () => {
    expect(BRIDGE).toContain('traceFrame(\n    "bridge started readyState="');
  });
});
