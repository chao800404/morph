// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { PREVIEW_SERVED_CONTENT_TIMING } from "@/lib/storefront/editor/preview-protocol";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import { ASTRO_PRERENDER_ENTRY } from "../theme-framework/astro-native-prerender";
import { planAstroPreviewWorkspace } from "../theme-framework/astro-preview-workspace";
import { START_PREVIEW_ADDRESS_PROBE_PATH } from "../service/preview-address-probe";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
  THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
} from "./theme-preview-content";
import { previewContentAsCoreWrites } from "./theme-preview-content.test-support";
import {
  PREVIEW_CONTENT_TICKET_HEADER,
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  THEME_PREVIEW_START_WORKER_PATH,
  holdPinnedRender,
  pinnedRenderForRead,
  pinnedSnapshotForRead,
  previewServedContentTiming,
  releasePinWithBody,
  runWithPinnedSnapshot,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";
import { legacyStartWorkerSource } from "./theme-preview-start-worker-legacy.test-support";

/**
 * Option 1 of the Astro basis ack (handoff/2026-11-24/astro-basis-ack-prereq.md):
 * an Astro Live Preview's Worker reads ONE content snapshot per request, at
 * entry, answers every content read of that request from it, and names that
 * snapshot's ticket and instance on the page response. Since the SDK's
 * scoped reads, a Start Live Preview's Worker pins the same way (a render's
 * merged, page-only and layout reads never mix two snapshots); with the
 * option off, the generator still writes the Worker before it, byte for byte
 * (the Start workspace's Worker: theme-preview-start-runtime.test.ts).
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
    // The probe's own x-morph-content-ticket header shares the prefix; the
    // stamp is the Server-Timing metric.
    expect(source).not.toContain("Server-Timing");
    expect(source).not.toContain(`${PREVIEW_SERVED_CONTENT_TIMING};desc`);
  });
});

describe("the explicit pin (reads outside the request's async context)", () => {
  it("answers a read by the token its request holds, and refuses any other", () => {
    const pins = new Map<string, { pinned: unknown; at: number }>();
    const token = holdPinnedRender(pins, { ok: true, snapshot: "one" }, 0);
    expect(token).toMatch(/^morph-preview-pin./);
    expect(pinnedRenderForRead(pins, token)).toEqual({ snapshot: "one" });
    for (const other of [null, "", "morph-preview-pin.unknown", "v1.release.sig"]) {
      expect(pinnedRenderForRead(pins, other)).toEqual({
        refusal: "no-request-snapshot",
      });
    }
    const failed = holdPinnedRender(pins, { ok: false, snapshot: null }, 0);
    expect(pinnedRenderForRead(pins, failed)).toEqual({
      refusal: "snapshot-unreadable",
    });
  });

  it("holds at most 256, none older than ten minutes", () => {
    const pins = new Map<string, { pinned: unknown; at: number }>();
    const first = holdPinnedRender(pins, { ok: true, snapshot: 1 }, 0);
    for (let i = 0; i < 300; i += 1) holdPinnedRender(pins, { ok: true }, 1);
    expect(pins.size).toBeLessThanOrEqual(256);
    expect(pins.has(first)).toBe(false);
    holdPinnedRender(pins, { ok: true }, 700_000);
    expect(pins.size).toBe(1);
  });

  it("releases the pin once the body is read to its end, or cancelled, and not before", async () => {
    const pins = new Map<string, unknown>();
    pins.set("a", 1);
    const read = releasePinWithBody(pins, "a", new Response("body"));
    expect(pins.has("a")).toBe(true);
    expect(await read.text()).toBe("body");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pins.has("a")).toBe(false);

    pins.set("b", 1);
    const cancelled = releasePinWithBody(
      pins,
      "b",
      new Response(new ReadableStream({ pull() {} })),
    );
    await cancelled.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pins.has("b")).toBe(false);

    pins.set("c", 1);
    releasePinWithBody(pins, "c", new Response(null, { status: 204 }));
    expect(pins.has("c")).toBe(false);
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
      TransformStream,
      crypto: globalThis.crypto,
      Date,
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
    // A block per evaluation, so the module can be evaluated again in the
    // same global, as the dev server's module runner does after a reload.
    const evaluate = () =>
      runInNewContext(
        `{\n${source
          .replace(importLine, "")
          .replace(alsLine, "")
          .replaceAll(dataImport, "__loadData()")
          .replace("export default {", "entry = {")}\n}`,
        sandbox,
      );
    evaluate();
    return Object.assign(sandbox, { evaluate });
  }

  it("serves every content read of a page from its entry snapshot and stamps that snapshot", async () => {
    const data = {
      current: {
        ...previewContentAsCoreWrites({
          templates: { index: { slots: { hero: { title: "one" } }, hiddenSlots: [] } },
        }),
        contentTicket: 5,
        previewInstance: INSTANCE,
      } as unknown,
    };
    const seen: unknown[] = [];
    const sandbox = runWorker(async (box) => {
      seen.push(await (await box.fetch(contentUrl("/"))).json());
      // A sync writes ticket 6 while the page is still rendering.
      data.current = {
        ...previewContentAsCoreWrites({
          templates: { index: { slots: { hero: { title: "two" } }, hiddenSlots: [] } },
        }),
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
      { current: { ...previewContentAsCoreWrites(), contentTicket: 5, previewInstance: INSTANCE } },
    );
    expect(
      (await named.entry.fetch(new Request("https://preview.example/api")))
        .headers.get("server-timing"),
    ).toBe(null);
    const unnamed = runWorker(
      async () =>
        new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      { current: previewContentAsCoreWrites() },
    );
    expect(
      (await unnamed.entry.fetch(new Request("https://preview.example/")))
        .headers.get("server-timing"),
    ).toBe(null);
  });

  const snapshotWith = (title: string, contentTicket: number) => ({
    ...previewContentAsCoreWrites({
      templates: { index: { slots: { hero: { title } }, hiddenSlots: [] } },
    }),
    contentTicket,
    previewInstance: INSTANCE,
  });
  const probe = (sandbox: ReturnType<typeof runWorker>) =>
    sandbox.entry.fetch(
      new Request(`https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`),
    );

  // Nothing orders two imports of the data module: one started before a sync
  // rewrote the file can settle after one started later (readSnapshot). A
  // content sync waits for the probe to name its ticket before the page
  // reloads, so the reload must render at least that ticket.
  it("never pins a snapshot older than one the probe already named", async () => {
    const data = { current: snapshotWith("six", 6) as unknown };
    const seen: unknown[] = [];
    const sandbox = runWorker(async (box) => {
      seen.push(await (await box.fetch(contentUrl("/"))).json());
      return new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }, data);
    expect((await probe(sandbox)).headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
      "6",
    );
    // The page's import settles with the older module.
    data.current = snapshotWith("five", 5);
    const response = await sandbox.entry.fetch(
      new Request("https://preview.example/"),
    );
    expect(seen).toEqual([{ slots: { hero: { title: "six" } }, hiddenSlots: [] }]);
    expect(response.headers.get("server-timing")).toContain(
      `${PREVIEW_SERVED_CONTENT_TIMING};desc="6.${INSTANCE}"`,
    );
  });

  it("does not lower what the probe names when a request pinned to an older snapshot reads", async () => {
    const data = { current: snapshotWith("five", 5) as unknown };
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: unknown[] = [];
    const sandbox = runWorker(async (box) => {
      await gate;
      seen.push(await (await box.fetch(contentUrl("/"))).json());
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    }, data);
    // Pinned to ticket 5 at its entry, then held mid-render.
    const page = sandbox.entry.fetch(new Request("https://preview.example/"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A sync writes ticket 6 and the probe names it.
    data.current = snapshotWith("six", 6);
    expect((await probe(sandbox)).headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
      "6",
    );
    // The held page reads: still its own pinned snapshot.
    release();
    await page;
    expect(seen).toEqual([{ slots: { hero: { title: "five" } }, hiddenSlots: [] }]);
    // An import settling with the older module afterwards: the probe still
    // names 6, as it did before the held page read.
    data.current = snapshotWith("five", 5);
    expect((await probe(sandbox)).headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
      "6",
    );
  });

  // The Astro dev server's module runner evaluates the Worker again after a
  // full reload (the content data file's). The newest evaluation's fetch is
  // the global one, and a request can still be running through an earlier
  // evaluation's entry: its pinned snapshot must reach that fetch.
  it("answers a page served by an earlier evaluation of the Worker from its pinned snapshot", async () => {
    const data = { current: snapshotWith("five", 5) as unknown };
    const seen: unknown[] = [];
    const sandbox = runWorker(async (box) => {
      seen.push(await (await box.fetch(contentUrl("/"))).json());
      return new Response("<html><head></head><body></body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }, data);
    const earlier = sandbox.entry;
    sandbox.evaluate();
    expect(sandbox.entry).not.toBe(earlier);
    const response = await earlier.fetch(new Request("https://preview.example/"));
    expect(seen).toEqual([{ slots: { hero: { title: "five" } }, hiddenSlots: [] }]);
    expect(response.headers.get("server-timing")).toContain(
      `${PREVIEW_SERVED_CONTENT_TIMING};desc="5.${INSTANCE}"`,
    );
  });

  it("refuses a content read that no request pinned, rather than reading live", async () => {
    const sandbox = runWorker(
      async () => new Response("unused"),
      { current: { ...snapshotWith("five", 5) } },
    );
    const response = await sandbox.fetch(contentUrl("/"));
    expect(response.status).toBe(THEME_PREVIEW_CONTENT_UNREADABLE_STATUS);
    expect(await response.json()).toEqual(THEME_PREVIEW_CONTENT_UNREADABLE_BODY);
  });

  // #479: an unreadable data file is refused, never answered empty or from
  // what was read before. A request pinned when the file is unreadable is
  // refused the same way, and its page names no snapshot.
  it("refuses every content read of a request whose entry found nothing readable", async () => {
    for (const unreadable of [
      null,
      { templates: {}, pages: {} },
      { ...snapshotWith("five", 5), templates: "malformed" },
    ]) {
      const data = { current: snapshotWith("five", 5) as unknown };
      const reads: Array<{ status: number; body: unknown }> = [];
      const sandbox = runWorker(async (box) => {
        const response = await box.fetch(contentUrl("/"));
        reads.push({ status: response.status, body: await response.json() });
        return new Response("<html><head></head><body></body></html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }, data);
      // A readable snapshot read first, so an earlier one could be served.
      expect((await probe(sandbox)).headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
        "5",
      );
      data.current = unreadable;
      const page = await sandbox.entry.fetch(new Request("https://preview.example/"));
      expect(reads, JSON.stringify(unreadable)).toEqual([
        {
          status: THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
          body: THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
        },
      ]);
      expect(page.headers.get("server-timing")).toBe(null);
      expect((await probe(sandbox)).headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
        "0",
      );
    }
  });

  it("refuses every content read of a request whose entry import failed", async () => {
    const data = { current: snapshotWith("five", 5) as unknown };
    const reads: Array<{ status: number; body: unknown }> = [];
    const sandbox = runWorker(async (box) => {
      const response = await box.fetch(contentUrl("/"));
      reads.push({ status: response.status, body: await response.json() });
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    }, data);
    (sandbox as { __loadData: () => Promise<unknown> }).__loadData = async () => {
      throw new SyntaxError("not JSON");
    };
    await sandbox.entry.fetch(new Request("https://preview.example/"));
    expect(reads).toEqual([
      {
        status: THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
        body: THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
      },
    ]);
  });
});
