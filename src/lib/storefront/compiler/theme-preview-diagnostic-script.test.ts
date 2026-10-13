// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePreviewToEditorMessage } from "@/lib/storefront/editor/preview-protocol";
import {
  previewHttpHmrPluginSource,
  THEME_PREVIEW_HMR_FAILED_EVENT,
} from "./theme-preview-dev-server";
import {
  THEME_PREVIEW_BRIDGE_READY_EVENT,
  THEME_PREVIEW_BRIDGE_STARTED_EVENT,
  themePreviewDiagnosticScriptSource,
} from "./theme-preview-diagnostic-script";

type Listener = (event: { target?: unknown }) => void;

function runInPage(options: {
  search?: string;
  framed?: boolean;
  entries?: Array<{ name: string; responseStatus?: number }>;
  fetch?: (url: string, init?: unknown) => Promise<unknown>;
  document?: unknown;
}) {
  let observed: ((list: { getEntries: () => unknown[] }) => void) | null = null;
  class FakePerformanceObserver {
    constructor(callback: typeof observed) {
      observed = callback;
    }
    observe() {}
  }
  const listeners = new Map<string, Listener>();
  const posted: Array<{ message: any; target: string }> = [];
  const parent = {
    postMessage: (message: unknown, target: string) =>
      posted.push({ message, target }),
  };
  const window: Record<string, unknown> = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
  };
  window.parent = options.framed === false ? window : parent;
  if (options.fetch) window.fetch = options.fetch;
  if (options.document) window.document = options.document;
  const location = {
    reloads: 0,
    reload() {
      location.reloads += 1;
    },
    search:
      options.search ??
      "?editorOrigin=http%3A%2F%2Flocalhost%3A3000&previewSession=session-1",
    href: "https://5173-sbx-secret.preview.example.com/__morph-theme-preview__/",
  };
  const performance = {
    now: () => 1_000,
    getEntriesByType: () => options.entries ?? [],
  };
  new Function(
    "window",
    "location",
    "performance",
    "URLSearchParams",
    "URL",
    "PerformanceObserver",
    themePreviewDiagnosticScriptSource(),
  )(
    window,
    location,
    performance,
    URLSearchParams,
    URL,
    FakePerformanceObserver,
  );
  return {
    listeners,
    posted,
    location,
    /** Resources finishing, as the page's observer would be told. */
    finish: (count: number) =>
      observed?.({ getEntries: () => Array.from({ length: count }) }),
    failuresPosted: () =>
      posted.filter((entry) => entry.message.kind !== "progress"),
    progressPosted: () =>
      posted
        .filter((entry) => entry.message.kind === "progress")
        .map((entry) => entry.message),
  };
}

// The page's heartbeat is an interval; none may outlive its test.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the preview page's first script", () => {
  it("reports a module script whose graph failed, in a message the editor accepts", () => {
    const page = runInPage({
      entries: [
        {
          name: "https://5173-sbx-secret.preview.example.com/__morph-theme-preview__/src/components/Hero.tsx?t=1",
          responseStatus: 410,
        },
        {
          name: "https://5173-sbx-secret.preview.example.com/__morph-theme-preview__/src/routes/index.tsx",
          responseStatus: 200,
        },
      ],
    });
    page.listeners.get("error")!({
      target: {
        tagName: "SCRIPT",
        getAttribute: () => "/__entry.tsx",
      },
    });

    expect(page.failuresPosted()).toHaveLength(1);
    const [{ message, target }] = page.failuresPosted();
    expect(target).toBe("http://localhost:3000");
    expect(message.previewSession).toBe("session-1");
    expect(parsePreviewToEditorMessage(message)).toEqual({
      type: "morph:storefront-preview-diagnostic",
      kind: "script-failed",
      failures: [
        {
          path: "/__morph-theme-preview__/src/components/Hero.tsx",
          status: 410,
        },
      ],
      failedScripts: ["/__entry.tsx"],
      elapsedMs: 0,
    });
    // Neither the host nor the query leaves the page.
    expect(JSON.stringify(message)).not.toContain("secret");
    expect(JSON.stringify(message)).not.toContain("?t=");
  });

  it("sends a summary after load only when something failed", () => {
    vi.useFakeTimers();
    const failing = runInPage({
      entries: [{ name: "https://h.example.com/a.ts", responseStatus: 404 }],
    });
    failing.listeners.get("load")!({});
    vi.advanceTimersByTime(1_000);
    expect(failing.failuresPosted().map((entry) => entry.message.kind)).toEqual([
      "load-summary",
    ]);

    const healthy = runInPage({
      entries: [{ name: "https://h.example.com/a.ts", responseStatus: 200 }],
    });
    healthy.listeners.get("load")!({});
    vi.advanceTimersByTime(1_000);
    expect(healthy.failuresPosted()).toEqual([]);
  });

  it("ignores errors that are not a script failing to load", () => {
    const page = runInPage({});
    page.listeners.get("error")!({ target: { tagName: "IMG" } });
    page.listeners.get("error")!({
      target: { tagName: "SCRIPT", getAttribute: () => null },
    });
    expect(page.failuresPosted()).toEqual([]);
  });

  it("stays silent outside a frame or without the editor's channel", () => {
    expect(runInPage({ framed: false }).listeners.size).toBe(0);
    expect(runInPage({ search: "?previewSession=s" }).listeners.size).toBe(0);
  });

  it("stops sending after a bounded number of messages", () => {
    const page = runInPage({});
    for (let i = 0; i < 25; i += 1) {
      page.listeners.get("error")!({
        target: { tagName: "SCRIPT", getAttribute: () => `/m${i}.ts` },
      });
    }
    expect(page.failuresPosted()).toHaveLength(10);
  });
});

describe("the preview page's load progress", () => {
  it("reports each milestone once, with finished resources, in messages the editor accepts", () => {
    vi.useFakeTimers();
    const page = runInPage({});
    page.finish(3);
    page.listeners.get(THEME_PREVIEW_BRIDGE_STARTED_EVENT)!({});
    page.listeners.get("DOMContentLoaded")!({});
    page.listeners.get("load")!({});

    const reports = page.progressPosted();
    expect(reports.map((report) => report.reached)).toEqual([
      ["script"],
      ["script", "bridge"],
      ["script", "bridge", "dom"],
      ["script", "bridge", "dom", "load"],
    ]);
    expect(reports.at(-1).resources).toBe(3);
    for (const report of reports) {
      expect(report.previewSession).toBe("session-1");
      expect(parsePreviewToEditorMessage(report)).toMatchObject({
        type: "morph:storefront-preview-diagnostic",
        kind: "progress",
      });
    }
  });

  it("keeps reporting past load, and stops once the bridge is ready", () => {
    vi.useFakeTimers();
    const page = runInPage({});
    page.listeners.get("load")!({});
    vi.advanceTimersByTime(10_000);
    // Heartbeats go on after load: the bridge can start later than that, and
    // that is the wait worth protecting.
    expect(page.progressPosted()).toHaveLength(4);

    page.finish(2);
    vi.advanceTimersByTime(5_000);
    expect(page.progressPosted().at(-1).resources).toBe(2);

    page.listeners.get(THEME_PREVIEW_BRIDGE_READY_EVENT)!({});
    const afterReady = page.progressPosted().length;
    expect(page.progressPosted().at(-1).reached).toContain("ready");
    vi.advanceTimersByTime(60_000);
    expect(page.progressPosted()).toHaveLength(afterReady);
  });

  it("stops when the page goes away", () => {
    vi.useFakeTimers();
    const page = runInPage({});
    page.listeners.get("pagehide")!({});
    vi.advanceTimersByTime(60_000);
    expect(page.progressPosted()).toHaveLength(1);
  });

  it("sends a bounded number of reports, apart from the failure budget", () => {
    vi.useFakeTimers();
    const page = runInPage({});
    vi.advanceTimersByTime(60 * 60_000);
    expect(page.progressPosted()).toHaveLength(60);

    page.listeners.get("error")!({
      target: { tagName: "SCRIPT", getAttribute: () => "/late.ts" },
    });
    expect(page.failuresPosted()).toHaveLength(1);
  });

  it("carries milestones and a count, never a path or the host", () => {
    vi.useFakeTimers();
    const page = runInPage({
      entries: [
        { name: "https://5173-sbx-secret.preview.example.com/a.ts?t=1" },
      ],
    });
    page.finish(1);
    vi.advanceTimersByTime(5_000);
    const text = JSON.stringify(page.progressPosted());
    expect(text).not.toContain("secret");
    expect(text).not.toContain("a.ts");
  });
});

describe("parsePreviewToEditorMessage for diagnostics", () => {
  const valid = {
    type: "morph:storefront-preview-diagnostic",
    kind: "load-summary",
    failures: [{ path: "/a.ts", status: 410 }],
    failedScripts: [],
    elapsedMs: 12.4,
  };

  it("accepts a bounded report and rounds its time", () => {
    expect(parsePreviewToEditorMessage(valid)).toMatchObject({
      elapsedMs: 12,
    });
  });

  it("accepts a progress report and refuses one outside its bounds", () => {
    const progress = {
      type: "morph:storefront-preview-diagnostic",
      kind: "progress",
      reached: ["script", "bridge"],
      resources: 12,
      elapsedMs: 3_000.4,
    };
    expect(parsePreviewToEditorMessage(progress)).toEqual({
      type: "morph:storefront-preview-diagnostic",
      kind: "progress",
      reached: ["script", "bridge"],
      resources: 12,
      elapsedMs: 3_000,
    });
    for (const bad of [
      { ...progress, reached: ["script", "script"] },
      { ...progress, reached: ["elsewhere"] },
      { ...progress, reached: "script" },
      {
        ...progress,
        reached: ["script", "dom", "bridge", "load", "ready", "script"],
      },
      { ...progress, resources: -1 },
      { ...progress, resources: 1.5 },
      { ...progress, resources: "12" },
      { ...progress, elapsedMs: -1 },
    ]) {
      expect(parsePreviewToEditorMessage(bad)).toBeNull();
    }
  });

  it("refuses anything outside its bounds", () => {
    for (const bad of [
      { ...valid, kind: "other" },
      { ...valid, failures: [{ path: "/a.ts", status: 99 }] },
      { ...valid, failures: [{ path: "", status: 410 }] },
      { ...valid, failures: [{ path: "x".repeat(301), status: 410 }] },
      {
        ...valid,
        failures: Array.from({ length: 21 }, () => ({
          path: "/a",
          status: 410,
        })),
      },
      { ...valid, failedScripts: [42] },
      { ...valid, elapsedMs: -1 },
      { ...valid, elapsedMs: Number.NaN },
    ]) {
      expect(parsePreviewToEditorMessage(bad)).toBeNull();
    }
  });
});

type FakeElement = {
  tag: string;
  attributes: Record<string, string>;
  textContent: string;
  style: { cssText: string };
  children: FakeElement[];
};

/** Just enough of a document to read back what the script put in the page. */
function fakeDocument() {
  const element = (tag: string): FakeElement & {
    setAttribute: (name: string, value: string) => void;
    appendChild: (child: FakeElement) => void;
  } => {
    const created = {
      tag,
      attributes: {} as Record<string, string>,
      textContent: "",
      style: { cssText: "" },
      children: [] as FakeElement[],
      setAttribute: (name: string, value: string) => {
        created.attributes[name] = value;
      },
      appendChild: (child: FakeElement) => {
        created.children.push(child);
      },
    };
    return created;
  };
  const body = element("body");
  return { body, createElement: element };
}

const BROKEN_ROUTE =
  "https://5173-sbx-secret.preview.example.com/__morph-theme-preview__/src/routes/error-recovery.tsx";
const VITE_ERROR = {
  id: "/workspace/src/routes/error-recovery.tsx",
  message:
    'Failed to resolve import "../components/RecoveryCard" from "src/routes/error-recovery.tsx". Does the file exist?',
  frame: '3  |  import RecoveryCard from "../components/RecoveryCard";',
  plugin: "vite:import-analysis",
};

function relay(entries: unknown[]) {
  const requested: string[] = [];
  return {
    requested,
    fetch: async (url: string) => {
      requested.push(url);
      return { ok: true, json: async () => ({ sequence: entries.length, entries }) };
    },
  };
}

function failScript(page: ReturnType<typeof runInPage>) {
  page.listeners.get("error")!({
    target: { tagName: "SCRIPT", getAttribute: () => "/__entry.tsx" },
  });
}

describe("a page whose module Vite would not compile", () => {
  it("shows Vite's message in the page, as text, for the module that failed", async () => {
    const document = fakeDocument();
    const server = relay([
      { sequence: 1, payload: { type: "update", updates: [] } },
      { sequence: 2, payload: { type: "error", err: VITE_ERROR } },
    ]);
    const page = runInPage({
      entries: [{ name: BROKEN_ROUTE, responseStatus: 500 }],
      fetch: server.fetch,
      document,
    });
    failScript(page);
    await vi.waitFor(() => expect(document.body.children).toHaveLength(1));

    expect(server.requested).toEqual([
      "/__morph-theme-preview__/_morph/hmr?after=0&cursor=1",
    ]);
    const [panel] = document.body.children;
    expect(panel!.attributes.role).toBe("alert");
    expect(panel!.children.map((child) => [child.tag, child.textContent])).toEqual([
      ["h1", "The preview server reported an error for src/routes/error-recovery.tsx"],
      ["p", VITE_ERROR.message],
      ["pre", VITE_ERROR.frame],
    ]);
    // Shown in the page only: nothing of it is sent to the editor.
    expect(JSON.stringify(page.posted)).not.toContain("RecoveryCard");
  });

  it("asks once, however often the page reports", async () => {
    const document = fakeDocument();
    const server = relay([{ sequence: 1, payload: { type: "error", err: VITE_ERROR } }]);
    const page = runInPage({
      entries: [{ name: BROKEN_ROUTE, responseStatus: 500 }],
      fetch: server.fetch,
      document,
    });
    failScript(page);
    failScript(page);
    page.listeners.get("load")!({});
    vi.advanceTimersByTime(1_000);
    await vi.waitFor(() => expect(document.body.children).toHaveLength(1));
    expect(server.requested).toHaveLength(1);
  });

  it("shows nothing for an error about some other module", async () => {
    const document = fakeDocument();
    const server = relay([
      {
        sequence: 1,
        payload: {
          type: "error",
          err: { ...VITE_ERROR, id: "/workspace/src/routes/other-error-recovery.tsx" },
        },
      },
    ]);
    const page = runInPage({
      entries: [{ name: BROKEN_ROUTE, responseStatus: 500 }],
      fetch: server.fetch,
      document,
    });
    failScript(page);
    await vi.waitFor(() => expect(server.requested).toHaveLength(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.body.children).toEqual([]);
  });

  it("does not ask for an interruption, a refusal, or a page that came up", async () => {
    for (const responseStatus of [503, 404]) {
      const server = relay([]);
      const page = runInPage({
        entries: [{ name: BROKEN_ROUTE, responseStatus }],
        fetch: server.fetch,
        document: fakeDocument(),
      });
      failScript(page);
      expect(server.requested).toEqual([]);
    }
    const server = relay([]);
    const page = runInPage({
      entries: [{ name: BROKEN_ROUTE, responseStatus: 500 }],
      fetch: server.fetch,
      document: fakeDocument(),
    });
    page.listeners.get("load")!({});
    vi.advanceTimersByTime(1_000);
    expect(server.requested).toEqual([]);
  });
});

describe("a hot update the page could not apply", () => {
  it("reloads the page, once, so the failure is told like a page that cannot load", () => {
    const page = runInPage({});
    const failed = page.listeners.get(THEME_PREVIEW_HMR_FAILED_EVENT)!;
    failed({});
    failed({});
    expect(page.location.reloads).toBe(1);
  });

  it("is the event the preview's Vite client is made to fire", () => {
    // The relay plugin edits Vite's client to fire it; the two ends share one
    // constant so they cannot drift apart.
    expect(previewHttpHmrPluginSource()).toContain(
      `new Event(${JSON.stringify(THEME_PREVIEW_HMR_FAILED_EVENT)})`,
    );
  });
});
