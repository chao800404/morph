// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePreviewToEditorMessage } from "@/lib/storefront/editor/preview-protocol";
import { themePreviewDiagnosticScriptSource } from "./theme-preview-diagnostic-script";

type Listener = (event: { target?: unknown }) => void;

function runInPage(options: {
  search?: string;
  framed?: boolean;
  entries?: Array<{ name: string; responseStatus?: number }>;
}) {
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
  const location = {
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
    themePreviewDiagnosticScriptSource(),
  )(window, location, performance, URLSearchParams, URL);
  return { listeners, posted };
}

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

    expect(page.posted).toHaveLength(1);
    const [{ message, target }] = page.posted;
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
    expect(failing.posted.map((entry) => entry.message.kind)).toEqual([
      "load-summary",
    ]);

    const healthy = runInPage({
      entries: [{ name: "https://h.example.com/a.ts", responseStatus: 200 }],
    });
    healthy.listeners.get("load")!({});
    vi.advanceTimersByTime(1_000);
    expect(healthy.posted).toEqual([]);
  });

  it("ignores errors that are not a script failing to load", () => {
    const page = runInPage({});
    page.listeners.get("error")!({ target: { tagName: "IMG" } });
    page.listeners.get("error")!({
      target: { tagName: "SCRIPT", getAttribute: () => null },
    });
    expect(page.posted).toEqual([]);
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
    expect(page.posted).toHaveLength(10);
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
