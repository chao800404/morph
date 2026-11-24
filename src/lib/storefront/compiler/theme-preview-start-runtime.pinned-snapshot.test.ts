// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { PREVIEW_SERVED_CONTENT_TIMING } from "@/lib/storefront/editor/preview-protocol";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { ASTRO_PRERENDER_ENTRY } from "../theme-framework/astro-native-prerender";
import { planAstroPreviewWorkspace } from "../theme-framework/astro-preview-workspace";
import { THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH } from "./theme-preview-content";
import {
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  THEME_PREVIEW_START_WORKER_PATH,
  pinnedSnapshotForRead,
  previewServedContentTiming,
  runWithPinnedSnapshot,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";
import { legacyStartWorkerSource } from "./theme-preview-start-worker-legacy.test-support";

/**
 * Option 1 of the Astro basis ack (handoff/2026-11-24/astro-basis-ack-prereq.md):
 * an Astro Live Preview's Worker reads ONE content snapshot per request, at
 * entry, answers every content read of that request from it, and names that
 * snapshot's ticket and instance on the page response. A Start preview's
 * Worker is unchanged, byte for byte.
 */

describe("the Start preview Worker with the option off", () => {
  it("is byte-identical to the Worker before the option existed", () => {
    for (const args of [
      [] as const,
      ["start-preview-test"] as const,
      ["instance-123", "./src/server.ts"] as const,
      ["preview-1", ASTRO_PRERENDER_ENTRY] as const,
    ]) {
      expect(themePreviewStartWorkerSource(...args)).toBe(
        legacyStartWorkerSource(...args),
      );
    }
    expect(
      themePreviewStartWorkerSource("start-preview-test", undefined, {
        pinRequestSnapshot: false,
      }),
    ).toBe(legacyStartWorkerSource("start-preview-test"));
    expect(
      themePreviewStartWorkerSource("start-preview-test", undefined, {}),
    ).toBe(legacyStartWorkerSource("start-preview-test"));
  });

  it("names nothing of the pinned path", () => {
    const source = themePreviewStartWorkerSource("start-preview-test");
    expect(source).not.toContain("node:async_hooks");
    expect(source).not.toContain("requestSnapshots");
    expect(source).not.toContain(PREVIEW_SERVED_CONTENT_TIMING);
  });
});

describe("an Astro Live Preview workspace", () => {
  it("writes the Worker with one pinned snapshot per request", () => {
    const plan = planAstroPreviewWorkspace({
      files: astroThemeFiles(),
      entry: null,
      buildId: "preview-1",
      approvedDependencies: new Set(),
      mode: "preview-server",
    });
    if (!plan.ok) throw new Error(plan.errorMessage);
    const worker = plan.workspaceFiles.find(
      (file) => file.path === `/workspace/${THEME_PREVIEW_START_WORKER_PATH}`,
    ) as { content: string } | undefined;
    expect(worker?.content).toBe(
      themePreviewStartWorkerSource("preview-1", ASTRO_PRERENDER_ENTRY, {
        pinRequestSnapshot: true,
      }),
    );
    expect(worker?.content).not.toBe(
      legacyStartWorkerSource("preview-1", ASTRO_PRERENDER_ENTRY),
    );
  });
});

describe("previewServedContentTiming", () => {
  const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";

  it("names the snapshot's ticket and instance", () => {
    expect(
      previewServedContentTiming({ contentTicket: 7, previewInstance: INSTANCE }),
    ).toBe(`${PREVIEW_SERVED_CONTENT_TIMING};desc="7.${INSTANCE}"`);
  });

  it("names nothing for a snapshot without a usable ticket or instance", () => {
    for (const snapshot of [
      null,
      undefined,
      "7",
      {},
      { contentTicket: 0, previewInstance: INSTANCE },
      { contentTicket: -1, previewInstance: INSTANCE },
      { contentTicket: 1.5, previewInstance: INSTANCE },
      { contentTicket: "7", previewInstance: INSTANCE },
      { contentTicket: 7 },
      { contentTicket: 7, previewInstance: "" },
      { contentTicket: 7, previewInstance: "short" },
      // A quote or a separator would break out of the description.
      { contentTicket: 7, previewInstance: 'abcdefgh"x' },
      { contentTicket: 7, previewInstance: "abcdefgh;dur=1" },
      { contentTicket: 7, previewInstance: "a".repeat(65) },
    ]) {
      expect(previewServedContentTiming(snapshot), JSON.stringify(snapshot)).toBe(
        null,
      );
    }
  });

  it("is self-contained, so the Worker can carry it as source", () => {
    const copy = runInNewContext(`(${previewServedContentTiming.toString()})`);
    expect(copy({ contentTicket: 3, previewInstance: INSTANCE })).toBe(
      previewServedContentTiming({ contentTicket: 3, previewInstance: INSTANCE }),
    );
  });
});

describe("runWithPinnedSnapshot / pinnedSnapshotForRead", () => {
  it("answers every read of one request from the snapshot read at its entry", async () => {
    const storage = new AsyncLocalStorage<unknown>();
    let current = { contentTicket: 1 };
    const load = async () => current;
    const reads = await runWithPinnedSnapshot(storage, load, async () => {
      const first = pinnedSnapshotForRead(storage);
      // A sync lands mid-request: this request keeps what it started with.
      current = { contentTicket: 2 };
      await new Promise((resolve) => setTimeout(resolve, 0));
      const second = pinnedSnapshotForRead(storage);
      return [first, second];
    });
    expect(reads).toEqual([
      { snapshot: { contentTicket: 1 } },
      { snapshot: { contentTicket: 1 } },
    ]);
    // The next request reads the newer one.
    const next = await runWithPinnedSnapshot(storage, load, async () =>
      pinnedSnapshotForRead(storage),
    );
    expect(next).toEqual({ snapshot: { contentTicket: 2 } });
  });

  it("keeps two concurrent requests apart", async () => {
    const storage = new AsyncLocalStorage<unknown>();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const older = runWithPinnedSnapshot(
      storage,
      async () => ({ contentTicket: 1 }),
      async () => {
        await gate;
        return pinnedSnapshotForRead(storage);
      },
    );
    const newer = runWithPinnedSnapshot(
      storage,
      async () => ({ contentTicket: 2 }),
      async () => pinnedSnapshotForRead(storage),
    );
    expect(await newer).toEqual({ snapshot: { contentTicket: 2 } });
    release();
    expect(await older).toEqual({ snapshot: { contentTicket: 1 } });
  });

  it("hands the handler what it pinned, and a failed read as unreadable", async () => {
    const storage = new AsyncLocalStorage<unknown>();
    const pinned = await runWithPinnedSnapshot(
      storage,
      async () => ({ contentTicket: 4 }),
      async (value) => value,
    );
    expect(pinned).toEqual({ ok: true, snapshot: { contentTicket: 4 } });
    const failed = await runWithPinnedSnapshot(
      storage,
      async () => {
        throw new Error("unreadable");
      },
      async (value) => [value, pinnedSnapshotForRead(storage)],
    );
    expect(failed).toEqual([
      { ok: false, snapshot: null },
      { refusal: "snapshot-unreadable" },
    ]);
  });

  it("refuses a read outside any pinned request rather than reading live", () => {
    const storage = new AsyncLocalStorage<unknown>();
    expect(pinnedSnapshotForRead(storage)).toEqual({
      refusal: "no-request-snapshot",
    });
  });
});

/**
 * The generated Worker itself, run in a VM context as the Start probe test
 * runs it: imports replaced by the sandbox's own values, and the data module
 * by a loader the test changes between reads.
 */
describe("the pinned Worker", () => {
  const INSTANCE = "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11";
  const contentUrl = (path: string) =>
    `${THEME_PREVIEW_START_CONTENT_ORIGIN}/_morph/content?path=${encodeURIComponent(path)}`;

  function runWorker(
    startFetch: (sandbox: { fetch: typeof fetch }) => Promise<Response>,
    data: { current: unknown },
  ) {
    const sandbox = {
      AsyncLocalStorage,
      Request,
      Response,
      URL,
      Headers,
      JSON,
      Number,
      console,
      fetch: globalThis.fetch,
      __loadData: async () => ({ default: data.current }),
      // Stands in for workerd's: the test checks headers and reads, not
      // the injected scripts.
      HTMLRewriter: class {
        on() {
          return this;
        }
        onDocument() {
          return this;
        }
        transform(response: Response) {
          return response;
        }
      },
      startEntry: { fetch: (): Promise<Response> => startFetch(sandbox) },
      entry: undefined as unknown as {
        fetch: (request: Request) => Promise<Response>;
      },
    };
    const source = themePreviewStartWorkerSource(
      "preview-1",
      ASTRO_PRERENDER_ENTRY,
      { pinRequestSnapshot: true },
    );
    const importLine = `import startEntry from ${JSON.stringify(ASTRO_PRERENDER_ENTRY)};`;
    const alsLine = 'import { AsyncLocalStorage } from "node:async_hooks";';
    const dataImport = `import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}")`;
    expect(source).toContain(importLine);
    expect(source).toContain(alsLine);
    expect(source).toContain(dataImport);
    runInNewContext(
      source
        .replace(importLine, "")
        .replace(alsLine, "")
        .replaceAll(dataImport, "__loadData()")
        .replace("export default {", "entry = {"),
      sandbox,
    );
    return sandbox;
  }

  it("serves every content read of a page from its entry snapshot and stamps that snapshot", async () => {
    const data = {
      current: {
        templates: { index: { slots: { hero: { title: "one" } }, hiddenSlots: [] } },
        pages: {},
        contentTicket: 5,
        previewInstance: INSTANCE,
      } as unknown,
    };
    const seen: unknown[] = [];
    const sandbox = runWorker(async (box) => {
      seen.push(await (await box.fetch(contentUrl("/"))).json());
      // A sync writes ticket 6 while the page is still rendering.
      data.current = {
        templates: { index: { slots: { hero: { title: "two" } }, hiddenSlots: [] } },
        pages: {},
        contentTicket: 6,
        previewInstance: INSTANCE,
      };
      seen.push(await (await box.fetch(contentUrl("/"))).json());
      return new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }, data);
    const response = await sandbox.entry.fetch(
      new Request("https://preview.example/"),
    );
    expect(seen).toEqual([
      { slots: { hero: { title: "one" } }, hiddenSlots: [] },
      { slots: { hero: { title: "one" } }, hiddenSlots: [] },
    ]);
    expect(response.headers.get("server-timing")).toContain(
      `${PREVIEW_SERVED_CONTENT_TIMING};desc="5.${INSTANCE}"`,
    );
  });

  it("stamps nothing on a response that is not a page, and nothing for an unnamed snapshot", async () => {
    const named = runWorker(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
      { current: { templates: {}, pages: {}, contentTicket: 5, previewInstance: INSTANCE } },
    );
    expect(
      (await named.entry.fetch(new Request("https://preview.example/api")))
        .headers.get("server-timing"),
    ).toBe(null);
    const unnamed = runWorker(
      async () =>
        new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      { current: { templates: {}, pages: {} } },
    );
    expect(
      (await unnamed.entry.fetch(new Request("https://preview.example/")))
        .headers.get("server-timing"),
    ).toBe(null);
  });

  it("refuses a content read that no request pinned, rather than reading live", async () => {
    const sandbox = runWorker(
      async () => new Response("unused"),
      { current: { templates: {}, pages: {}, contentTicket: 5, previewInstance: INSTANCE } },
    );
    const response = await sandbox.fetch(contentUrl("/"));
    expect(response.status).toBe(503);
  });
});
