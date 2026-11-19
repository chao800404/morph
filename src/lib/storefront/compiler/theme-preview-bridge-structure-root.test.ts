import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { themePreviewBridgeEntrySource } from "./theme-preview-bridge-entry";

/**
 * Which DOM the bridge watches for structure changes.
 *
 * The page the bridge is served in has a `<div id="root">`. A Theme that owns
 * its document shell is mounted on `document` (theme-router-build-bootstrap),
 * and React keeps `<html>` and `<body>` but replaces what is in the body, so
 * that div leaves the page. Every later route change, by a link, by history
 * or by the editor's set-route, happens inside the body. The bridge has to go
 * on hearing those changes, or the editor never learns the frame came back to
 * the page it is editing.
 *
 * The bridge's own code is run as written, cut from the generated script,
 * against a real DOM.
 */

const BRIDGE = themePreviewBridgeEntrySource();

function structureWatcher() {
  const rootStart = BRIDGE.indexOf("  const ensurePreviewRoot = () => {");
  const rootEnd = BRIDGE.indexOf("  ensurePreviewRoot();", rootStart);
  const watchStart = BRIDGE.indexOf("  const resolveStructureRoot = () => {");
  const watchEndMarker = "  scheduleStructureReport();\n";
  const documentObserverAt = BRIDGE.indexOf(
    "const documentObserver = new MutationObserver(",
    watchStart,
  );
  const watchEnd = BRIDGE.indexOf(watchEndMarker, documentObserverAt);
  expect(rootStart, "the bridge's preview root").toBeGreaterThan(-1);
  expect(rootEnd).toBeGreaterThan(rootStart);
  expect(watchStart, "the bridge's structure observer").toBeGreaterThan(-1);
  expect(documentObserverAt).toBeGreaterThan(watchStart);
  expect(watchEnd).toBeGreaterThan(documentObserverAt);
  const source = ts.transpileModule(
    BRIDGE.slice(rootStart, rootEnd) +
      BRIDGE.slice(watchStart, watchEnd + watchEndMarker.length),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;

  let reports = 0;
  const build = new Function(
    "document",
    "MutationObserver",
    "inlineEditor",
    "overlays",
    "isPreviewEditorUiMutation",
    "scheduleStructureReport",
    "scheduleSelectedTargetReport",
    `${source}
    return () => {
      documentObserver.disconnect();
      structureObserver.disconnect();
    };`,
  );
  const disconnect = build(
    document,
    MutationObserver,
    { editingElement: () => null, finish: () => {} },
    null,
    () => false,
    () => {
      reports += 1;
    },
    () => {},
  ) as () => void;
  return {
    reports: () => reports,
    resetReports: () => {
      reports = 0;
    },
    disconnect,
  };
}

/** MutationObserver callbacks run as microtasks; let every queued one run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(sectionId: string) {
  const main = document.createElement("main");
  const section = document.createElement("section");
  section.setAttribute("data-storefront-section-id", sectionId);
  section.textContent = sectionId;
  main.appendChild(section);
  return main;
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  document.body.replaceChildren();
  document.body.removeAttribute("data-storefront-preview-root");
});

describe("watching the page for structure changes", () => {
  it("keeps hearing route changes after a document-shell Theme replaces the served root", async () => {
    // As served: the bridge starts before React has committed anything.
    const served = document.createElement("div");
    served.id = "root";
    served.setAttribute("data-storefront-preview-root", "true");
    document.body.replaceChildren(served);
    const watcher = structureWatcher();
    stop = watcher.disconnect;
    await settle();

    // React mounts the shell on the document: <body> stays, what is in it
    // is replaced, and the served root is gone.
    document.body.replaceChildren(page("home-card"));
    await settle();
    expect(served.isConnected).toBe(false);

    // The frame leaves the page (a link, history, or set-route)...
    watcher.resetReports();
    document.body.replaceChildren(page("other-card"));
    await settle();
    expect
      .soft(watcher.reports(), "leaving the page is reported")
      .toBeGreaterThan(0);

    // ...and comes back to it.
    watcher.resetReports();
    document.body.replaceChildren(page("home-card"));
    await settle();
    expect
      .soft(watcher.reports(), "returning to the page is reported")
      .toBeGreaterThan(0);
  });

  it("hears route changes inside the served root while it stays", async () => {
    const served = document.createElement("div");
    served.id = "root";
    served.setAttribute("data-storefront-preview-root", "true");
    document.body.replaceChildren(served);
    served.appendChild(page("home-card"));
    const watcher = structureWatcher();
    stop = watcher.disconnect;
    await settle();

    watcher.resetReports();
    served.replaceChildren(page("other-card"));
    await settle();
    expect(watcher.reports()).toBeGreaterThan(0);

    watcher.resetReports();
    served.replaceChildren(page("home-card"));
    await settle();
    expect(watcher.reports()).toBeGreaterThan(0);
  });

  it("reports nothing when nothing on the page changed", async () => {
    const served = document.createElement("div");
    served.id = "root";
    document.body.replaceChildren(served);
    served.appendChild(page("home-card"));
    const watcher = structureWatcher();
    stop = watcher.disconnect;
    await settle();
    watcher.resetReports();
    await settle();
    expect(watcher.reports()).toBe(0);
  });
});
