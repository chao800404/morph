// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  PREVIEW_ADDRESS_PROBE_BODY,
  START_PREVIEW_ADDRESS_PROBE_PATH,
  START_PREVIEW_ID_HEADER,
} from "../service/preview-address-probe";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import {
  isBinaryWorkspaceFile,
  planThemeSandboxWorkspace,
  unplannedWorkspaceFiles,
  type ThemePreviewRuntime,
} from "./theme-sandbox-workspace";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_PATH,
} from "./theme-preview-content";
import {
  PREVIEW_CONTENT_TICKET_HEADER,
  PREVIEW_INSTANCE_HEADER,
  previewOutboundRefusal,
  THEME_PREVIEW_START_CLIENT_PATH,
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  THEME_PREVIEW_START_WORKER_PATH,
  themePreviewStartClientSource,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";
import { refuseThemeWorkspacePath } from "./theme-workspace-path";
import { previewContentAsCoreWrites } from "./theme-preview-content.test-support";
import { normalizeRevisionSnapshot } from "./theme-build-materializer";

const plan = (
  previewRuntime?: ThemePreviewRuntime,
  mode: "build" | "preview-server" = "preview-server",
  extraFiles: readonly { path: string; content: string }[] = [],
) => {
  const result = planThemeSandboxWorkspace({
    files: [...STARTER_THEME_FILES, ...extraFiles] as never,
    entry: "src/routes/index.tsx",
    buildId: "start-preview-test",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode,
    ...(previewRuntime ? { previewRuntime } : {}),
  });
  if (!result.ok) throw new Error(result.errorMessage);
  const files = new Map(
    result.workspaceFiles.flatMap((file) =>
      isBinaryWorkspaceFile(file) ? [] : [[file.path, file.content] as const],
    ),
  );
  return { result, files };
};

describe("a Start Live Preview workspace (prototype)", () => {
  it("wires a Theme server entry in builds but retains the preview wrapper", () => {
    const extra = [
      {
        path: "src/server.ts",
        content: "export default { fetch: () => new Response('custom') };",
      },
    ];
    const build = plan("start", "build", extra).files;
    expect(JSON.parse(build.get("/workspace/wrangler.json")!).main).toBe(
      "./src/server.ts",
    );
    const preview = plan("start", "preview-server", extra).files;
    expect(JSON.parse(preview.get("/workspace/wrangler.json")!).main).toBe(
      `./${THEME_PREVIEW_START_WORKER_PATH}`,
    );
    expect(preview.get(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      // Pinned, one snapshot per request, as every Live Preview Worker.
      themePreviewStartWorkerSource("start-preview-test", "./src/server.ts", {
        pinRequestSnapshot: true,
        stampServedContent: false,
      }),
    );
    expect(preview.has(`/workspace/${THEME_PREVIEW_START_CLIENT_PATH}`)).toBe(
      true,
    );
  });
  it("keeps validated edits arriving before hydration, then refreshes the existing router", async () => {
    const listeners = new Set<(event: unknown) => void>();
    const timers: (() => void)[] = [];
    const snapshot: Record<string, unknown> = {};
    const updatePreviewContent = vi.fn((id: string, props: unknown) => {
      snapshot[id] = props;
    });
    const invalidate = vi.fn(async () => {});
    const browser: Record<string, unknown> = {
      addEventListener: (_type: string, listener: (event: unknown) => void) =>
        listeners.add(listener),
      removeEventListener: (
        _type: string,
        listener: (event: unknown) => void,
      ) => listeners.delete(listener),
    };
    const loadBridge = vi.fn(async () => {});
    const source = themePreviewStartClientSource()
      .replace(/^import .*;\n/, "")
      .replace('import("/src/morph/preview-content.ts")', "contentPromise")
      .replace('import("/src/morph/preview-bridge.ts")', "loadBridge()");
    const execution = runInNewContext(`(async () => { ${source} })()`, {
      window: browser,
      document: { readyState: "complete" },
      performance: { now: () => 0 },
      setTimeout: (callback: () => void) => timers.push(callback),
      requestAnimationFrame: (callback: () => void) => callback(),
      documentPreviewRuntimeChannel: () => ({}),
      parseEditorToPreviewWindowEvent: (event: {
        trusted?: boolean;
        data: unknown;
      }) => (event.trusted ? event.data : null),
      contentPromise: Promise.resolve({ updatePreviewContent }),
      loadBridge,
    }) as Promise<void>;
    const message = {
      type: "morph:storefront-preview-update-section-props",
      sectionId: "hero",
      props: { eyebrow: "latest" },
    };
    for (const listener of listeners) {
      listener({ trusted: false, data: message });
      listener({ trusted: true, data: message });
    }
    await Promise.resolve();
    expect(updatePreviewContent).toHaveBeenCalledTimes(1);
    expect(snapshot.hero).toEqual({ eyebrow: "latest" });
    expect(loadBridge).not.toHaveBeenCalled();
    browser.__TSR_ROUTER__ = { invalidate };
    timers.shift()!();
    await execution;
    expect(loadBridge).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ sync: true });
    expect(listeners.size).toBe(0);
  });
  it.each([
    ["the bridge", "loadBridge", "/src/morph/preview-bridge.ts"],
    ["the content module", "contentPromise", "/src/morph/preview-content.ts"],
  ])(
    "names %s to the page's first script when its import fails, and still fails",
    async (_label, failing, path) => {
      const dispatched: unknown[] = [];
      class FakeCustomEvent {
        constructor(
          readonly type: string,
          readonly init: { detail: unknown },
        ) {}
      }
      const refused = new Error("interrupted");
      const loadBridge = vi.fn(async () => {
        if (failing === "loadBridge") throw refused;
      });
      const contentPromise =
        failing === "contentPromise"
          ? Promise.reject(refused)
          : Promise.resolve({ updatePreviewContent: () => {} });
      contentPromise.catch(() => {});
      const source = themePreviewStartClientSource()
        .replace(/^import .*;\n/, "")
        .replace('import("/src/morph/preview-content.ts")', "contentPromise")
        .replace('import("/src/morph/preview-bridge.ts")', "loadBridge()");
      const execution = runInNewContext(`(async () => { ${source} })()`, {
        window: {
          __TSR_ROUTER__: {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: (event: unknown) => dispatched.push(event),
        },
        CustomEvent: FakeCustomEvent,
        document: { readyState: "complete" },
        performance: { now: () => 0 },
        setTimeout: (callback: () => void) => callback(),
        requestAnimationFrame: (callback: () => void) => callback(),
        documentPreviewRuntimeChannel: () => ({}),
        parseEditorToPreviewWindowEvent: () => null,
        contentPromise,
        loadBridge,
      }) as Promise<void>;

      await expect(execution).rejects.toBe(refused);
      expect(dispatched).toEqual([
        new FakeCustomEvent("morph:storefront-preview-module-failed", {
          detail: { path },
        }),
      ]);
      expect(loadBridge).toHaveBeenCalledTimes(
        failing === "loadBridge" ? 1 : 0,
      );
    },
  );
  it.each(["@tanstack/react-start/server-entry", "./src/server.ts"])(
    "answers health without invoking the %s entry or a Theme loader",
    async (serverEntry) => {
      let calls = 0;
      const sandbox = {
        Request,
        Response,
        URL,
        Headers,
        fetch: globalThis.fetch,
        startEntry: {
          fetch: async () => {
            calls++;
            return new Response("theme");
          },
        },
        entry: undefined as unknown as {
          fetch: (request: Request) => Promise<Response>;
        },
      };
      runInNewContext(
        themePreviewStartWorkerSource("instance-123", serverEntry)
          .replace(`import startEntry from ${JSON.stringify(serverEntry)};`, "")
          .replace("export default {", "entry = {"),
        sandbox,
      );
      for (const method of ["GET", "HEAD"]) {
        const response = await sandbox.entry.fetch(
          new Request(
            `https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`,
            { method },
          ),
        );
        // A body on GET, never an empty 204: a bodiless first response on a
        // fresh container-port tunnel gets the next request closed
        // (cloudflare/workerd#7597).
        expect(response.status).toBe(200);
        expect(response.headers.get(START_PREVIEW_ID_HEADER)).toBe(
          "instance-123",
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).toBe(
          method === "GET" ? PREVIEW_ADDRESS_PROBE_BODY : "",
        );
      }
      expect(
        (
          await sandbox.entry.fetch(
            new Request(
              `https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`,
              { method: "POST" },
            ),
          )
        ).status,
      ).toBe(405);
      expect(calls).toBe(0);
      expect(
        await (
          await sandbox.entry.fetch(
            new Request("https://preview.example/api/theme"),
          )
        ).text(),
      ).toBe("theme");
      expect(calls).toBe(1);
    },
  );
  it("leaves today's client-only preview unchanged by default", () => {
    const { files } = plan();
    expect(files.has("/workspace/index.html")).toBe(true);
    expect(files.has("/workspace/__entry.tsx")).toBe(true);
    expect(files.has(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      false,
    );
    const config = files.get("/workspace/vite.config.ts")!;
    expect(config).toContain("const isStartPreview = false;");
    expect(JSON.parse(files.get("/workspace/wrangler.json")!).main).toBe(
      "@tanstack/react-start/server-entry",
    );
  });

  it("serves Start itself at the root, entering through the platform's Worker", () => {
    const { files } = plan("start");
    // Start renders the document; there is no browser-only entry.
    expect(files.has("/workspace/index.html")).toBe(false);
    expect(files.has("/workspace/__entry.tsx")).toBe(false);
    expect(files.get(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      themePreviewStartWorkerSource("start-preview-test", undefined, {
        pinRequestSnapshot: true,
        stampServedContent: false,
      }),
    );
    expect(files.get(`/workspace/${THEME_PREVIEW_START_CLIENT_PATH}`)).toBe(
      themePreviewStartClientSource(),
    );
    const wrangler = JSON.parse(files.get("/workspace/wrangler.json")!);
    expect(wrangler.main).toBe(`./${THEME_PREVIEW_START_WORKER_PATH}`);
    // No bindings of any kind are declared for Theme server code.
    expect(Object.keys(wrangler).sort()).toEqual(
      ["compatibility_date", "compatibility_flags", "main", "name"].sort(),
    );
    const config = files.get("/workspace/vite.config.ts")!;
    expect(config).toContain("const isStartPreview = true;");
    expect(config).toContain("base: isStartRuntimeBuild || isStartPreview");
    // The browser-only stand-ins are not what answers in this preview.
    expect(config).toContain("const previewRootPublicPlugin = null;");
  });

  it("ignores the option for a build", () => {
    const { files } = plan("start", "build");
    expect(files.get("/workspace/vite.config.ts")).toContain(
      "const isStartPreview = false;",
    );
    expect(files.has(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      false,
    );
  });

  it("keeps both platform files out of an author's reach", () => {
    for (const path of [
      THEME_PREVIEW_START_WORKER_PATH,
      THEME_PREVIEW_START_CLIENT_PATH,
    ]) {
      expect(refuseThemeWorkspacePath(path)).toMatch(
        /^RESERVED_THEME_BUILD_PATH/,
      );
    }
  });

  it("never prunes the Cloudflare plugin's scratch directory", () => {
    const { result } = plan("start");
    expect(
      unplannedWorkspaceFiles(
        [{ absolutePath: "/workspace/.wrangler/tmp/x.js", type: "file" }],
        result.workspaceFiles,
      ),
    ).toEqual([]);
  });

  it("tells Theme server code to read content from an origin only the entry answers", () => {
    const source = themePreviewStartWorkerSource();
    expect(THEME_PREVIEW_START_CONTENT_ORIGIN.endsWith(".invalid")).toBe(true);
    expect(source).toContain(
      'headers.set("x-morph-content-origin", CONTENT_ORIGIN)',
    );
    expect(source).toContain(
      'import startEntry from "@tanstack/react-start/server-entry"',
    );
  });
});

/**
 * The Worker re-imports the data file on every content read and probe, and
 * keeps what it read in one module-global snapshot every request shares.
 * Nothing orders two `import()`s: one started before a sync's rewrite can
 * settle after one started later (handoff 2026-11-24 start-snapshot-race).
 * Each import here is a promise the test settles by hand, in that order.
 */
describe("the Start preview Worker's shared snapshot", () => {
  const CONTENT_URL = `${THEME_PREVIEW_START_CONTENT_ORIGIN}${THEME_PREVIEW_CONTENT_PATH}?path=/`;
  const PROBE_URL = `https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`;
  const IMPORT_CALL = `import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}")`;

  const dataModule = (ticket: number, title: string, instance = "server-a") => ({
    default: {
      ...previewContentAsCoreWrites({
        templates: { index: { slots: { hero: { title } }, hiddenSlots: [] } },
      }),
      contentTicket: ticket,
      previewInstance: instance,
    },
  });
  const indexContent = (title: string) => ({
    slots: { hero: { title } },
    hiddenSlots: [],
  });

  function startWorker() {
    const imports: ((module: unknown) => void)[] = [];
    const source = themePreviewStartWorkerSource("instance-123");
    expect(source).toContain(IMPORT_CALL);
    const sandbox = {
      Request,
      Response,
      URL,
      Headers,
      fetch: globalThis.fetch as (input: string) => Promise<Response>,
      startEntry: { fetch: async () => new Response("theme") },
      loadDataModule: () =>
        new Promise((resolve) => {
          imports.push(resolve);
        }),
      entry: undefined as unknown as {
        fetch: (request: Request) => Promise<Response>;
      },
    };
    runInNewContext(
      source
        .replace(
          'import startEntry from "@tanstack/react-start/server-entry";',
          "",
        )
        .replace("export default {", "entry = {")
        .replace(IMPORT_CALL, "loadDataModule()"),
      sandbox,
    );
    return {
      imports,
      // Theme server code's read, through the fetch the entry installs.
      readContent: () => sandbox.fetch(CONTENT_URL),
      probe: () => sandbox.entry.fetch(new Request(PROBE_URL)),
    };
  }

  it("never serves an older snapshot after a newer one when the imports settle out of order", async () => {
    const worker = startWorker();
    const startedFirst = worker.readContent();
    const startedSecond = worker.readContent();
    expect(worker.imports).toHaveLength(2);

    worker.imports[1]!(dataModule(2, "newer"));
    expect(await (await startedSecond).json()).toEqual(indexContent("newer"));

    worker.imports[0]!(dataModule(1, "older"));
    expect(await (await startedFirst).json()).toEqual(indexContent("newer"));

    // And it stays: a read after both still answers the newer content.
    const after = worker.readContent();
    worker.imports[2]!(dataModule(2, "newer"));
    expect(await (await after).json()).toEqual(indexContent("newer"));
  });

  it("never reports a lower ticket on the probe after a higher one", async () => {
    const worker = startWorker();
    const startedFirst = worker.probe();
    const startedSecond = worker.probe();
    expect(worker.imports).toHaveLength(2);

    worker.imports[1]!(dataModule(2, "newer"));
    expect(
      (await startedSecond).headers.get(PREVIEW_CONTENT_TICKET_HEADER),
    ).toBe("2");

    worker.imports[0]!(dataModule(1, "older"));
    expect((await startedFirst).headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
      "2",
    );
  });

  it("takes an equal ticket (a restamped server) and a newer one", async () => {
    const worker = startWorker();
    const first = worker.probe();
    worker.imports[0]!(dataModule(2, "two", "server-a"));
    expect((await first).headers.get(PREVIEW_INSTANCE_HEADER)).toBe("server-a");

    // The same ticket stamped for the dev server that now runs.
    const restamped = worker.probe();
    worker.imports[1]!(dataModule(2, "two", "server-b"));
    const restampedResponse = await restamped;
    expect(restampedResponse.headers.get(PREVIEW_CONTENT_TICKET_HEADER)).toBe(
      "2",
    );
    expect(restampedResponse.headers.get(PREVIEW_INSTANCE_HEADER)).toBe(
      "server-b",
    );

    const newer = worker.readContent();
    worker.imports[2]!(dataModule(3, "three", "server-b"));
    expect(await (await newer).json()).toEqual(indexContent("three"));
  });

  it("takes the first snapshot it reads, and one from before tickets", async () => {
    const worker = startWorker();
    const first = worker.readContent();
    const legacy = dataModule(0, "legacy");
    delete (legacy.default as { contentTicket?: number }).contentTicket;
    worker.imports[0]!(legacy);
    expect(await (await first).json()).toEqual(indexContent("legacy"));
  });
});

/**
 * A Theme saved before the server refused these paths may still hold one.
 * Its copy must never be what runs: a preview start lays the platform's
 * version over it (or loads nothing from it), and a build or a Live Preview
 * sync refuses the Theme outright until the file is deleted.
 */
describe("a stale platform file in Theme source", () => {
  const STALE = 'throw new Error("STALE_THEME_COPY");';
  const stale = [
    "__entry.tsx",
    THEME_PREVIEW_START_WORKER_PATH,
    THEME_PREVIEW_START_CLIENT_PATH,
  ].map((path) => ({ path, content: STALE }));

  it("is replaced by the platform's files in a Start preview, whose document never loads __entry.tsx", () => {
    const { files } = plan("start", "preview-server", stale);
    expect(files.get(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      themePreviewStartWorkerSource(
        "start-preview-test",
        "@tanstack/react-start/server-entry",
        { pinRequestSnapshot: true, stampServedContent: false },
      ),
    );
    expect(files.get(`/workspace/${THEME_PREVIEW_START_CLIENT_PATH}`)).toBe(
      themePreviewStartClientSource(),
    );
    expect(JSON.parse(files.get("/workspace/wrangler.json")!).main).toBe(
      `./${THEME_PREVIEW_START_WORKER_PATH}`,
    );
    expect(files.has("/workspace/index.html")).toBe(false);
    for (const [path, content] of files) {
      if (path !== "/workspace/__entry.tsx") {
        expect(content).not.toContain("__entry");
      }
    }
  });

  it("is replaced by the platform's bootstrap in a client preview", () => {
    const { files } = plan("client", "preview-server", stale);
    expect(files.get("/workspace/__entry.tsx")).not.toContain(
      "STALE_THEME_COPY",
    );
    expect(files.get("/workspace/index.html")).toContain(
      '<script type="module" src="/__entry.tsx"></script>',
    );
  });

  it("stops a build and a Live Preview sync instead of being used", () => {
    for (const file of stale) {
      expect(() =>
        normalizeRevisionSnapshot(
          [
            { path: "src/index.tsx", content: "export default () => null;" },
            file,
          ],
          "rev-stale-platform-file",
        ),
      ).toThrow(/PLATFORM_OWNED_THEME_BUILD_PATH/);
      expect(refuseThemeWorkspacePath(file.path)).toMatch(
        /^RESERVED_THEME_BUILD_PATH/,
      );
    }
  });
});

describe("previewOutboundRefusal", () => {
  it.each([
    ["http://127.0.0.1:3000/", "private-address"],
    ["http://10.1.2.3/", "private-address"],
    ["http://172.17.0.1:3000/", "private-address"],
    ["http://192.168.1.1/", "private-address"],
    ["http://169.254.169.254/latest/meta-data", "private-address"],
    ["http://100.64.0.1/", "private-address"],
    ["http://0.0.0.0/", "private-address"],
    ["http://[::1]/", "ipv6-literal"],
    ["http://localhost:5173/", "internal-name"],
    ["http://5173-abc.preview.localhost/", "internal-name"],
    ["http://metadata.google.internal/", "internal-name"],
    ["http://host.docker.internal/", "internal-name"],
    ["http://intranet/", "single-label-name"],
    // The URL parser normalises these spellings to 127.0.0.1 first.
    ["http://2130706433/", "private-address"],
    ["http://0x7f.0.0.1/", "private-address"],
    ["http://127.1/", "private-address"],
    ["file:///etc/passwd", "protocol"],
    ["not a url", "invalid-url"],
  ])("refuses %s", (url, reason) => {
    expect(previewOutboundRefusal(url)).toBe(reason);
  });

  it.each([
    "https://example.com/",
    "https://api.stripe.com/v1",
    "http://8.8.8.8/",
  ])("passes the public host %s", (url) => {
    expect(previewOutboundRefusal(url)).toBeNull();
  });
});

describe("themePreviewStartClientSource early presentation tokens", () => {
  it("queues early presentationToken updates before hydration and hands them off to the bridge", () => {
    const source = themePreviewStartClientSource();
    expect(source).toContain("presentationToken");
    expect(source).toContain("__morphEarlyPresentationQueue");
    expect(source).toContain("__morphFlushEarlyPresentation");
    expect(source).toContain("superseded");
  });
});

describe("themePreviewStartClientSource [preview-frame] lines", () => {
  async function runClient(options: { router: boolean; clock: number[] }) {
    const lines: string[] = [];
    const browser: Record<string, unknown> = {
      addEventListener: () => {},
      removeEventListener: () => {},
      ...(options.router ? { __TSR_ROUTER__: { invalidate: async () => {} } } : {}),
    };
    const source = themePreviewStartClientSource()
      .replace(/^import .*;\n/, "")
      .replace('import("/src/morph/preview-content.ts")', "contentPromise")
      .replace('import("/src/morph/preview-bridge.ts")', "loadBridge()");
    const clock = [...options.clock];
    await runInNewContext(`(async () => { ${source} })()`, {
      window: browser,
      document: { readyState: options.router ? "complete" : "interactive" },
      performance: { now: () => (clock.length > 1 ? clock.shift()! : clock[0]!) },
      setTimeout: (callback: () => void) => callback(),
      requestAnimationFrame: (callback: () => void) => callback(),
      console: { info: (line: string) => lines.push(line) },
      documentPreviewIdentity: () => "0123456789abcdef0123456789abcdef",
      documentPreviewRuntimeChannel: () => ({}),
      parseEditorToPreviewWindowEvent: () => null,
      contentPromise: Promise.resolve({ updatePreviewContent: () => {} }),
      loadBridge: async () => {},
    });
    return lines;
  }

  it("says how the hydration wait ended and that the bridge loaded, once each, by document", async () => {
    expect(await runClient({ router: true, clock: [0, 120] })).toEqual([
      "[preview-frame] frame hydration waited router=yes readyState=complete waitedMs=120 earlyTokens=0 doc=01234567",
      "[preview-frame] frame bridge loaded contentBeforeBridge=no doc=01234567",
    ]);
  });

  it("says when the wait gave up without a router", async () => {
    const lines = await runClient({ router: false, clock: [0, 40_000] });
    expect(lines[0]).toBe(
      "[preview-frame] frame hydration timed-out router=no readyState=interactive waitedMs=40000 earlyTokens=0 doc=01234567",
    );
  });
});
