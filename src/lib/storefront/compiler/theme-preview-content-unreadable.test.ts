// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_PATH,
  createThemePreviewContentSnapshot,
  themePreviewContentModuleSource,
  themePreviewContentPluginSource,
} from "./theme-preview-content";
import {
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";

/**
 * Every Live Preview reader of the draft snapshot tells "nothing stored" from
 * "could not read", from the data.
 *
 * A snapshot Core wrote for a route with no Document holds that route's entry,
 * empty: `{ slots: {}, hiddenSlots: [] }`, which is an empty success. A
 * snapshot that is missing, unreadable, not JSON, or not of the shape Core
 * writes (no entry for the path asked about, an entry without its hidden
 * list) says nothing about the page, not even which sections the author hid,
 * so it is answered with a refusal. The Starter 32 reader rejects a refusal
 * and its router shows the error state; an empty success would instead render
 * every hidden section with its component defaults.
 *
 * The three readers are the ones the preview runs: the dev server's content
 * endpoint (client-only and Astro previews, the initial load), the page's own
 * fetch interception (client-only preview, after load), and the full Start
 * preview Worker's content origin (server render).
 */

type Content = { slots: Record<string, unknown>; hiddenSlots: string[] };

const VALID = {
  templates: {
    index: { slots: { hero: { heading: "Draft" } }, hiddenSlots: ["promo"] },
    product: { slots: {}, hiddenSlots: [] },
    collection: { slots: {}, hiddenSlots: [] },
    page: { slots: { body: { text: "Page" } }, hiddenSlots: [] },
    blog: { slots: {}, hiddenSlots: [] },
  },
  pages: {},
  routes: {},
  shell: { slots: { header: { title: "Shell" } }, hiddenSlots: ["footer"] },
};

/** What Core writes for a store with no Document at all. */
const nothingStored = () =>
  createThemePreviewContentSnapshot({ templates: [], pages: [] });

/** Snapshots a reader cannot answer the home page from. */
const UNREADABLE_SHAPES: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["an array", []],
  ["an object with no templates", { pages: {} }],
  ["templates that are not an object", { templates: [], pages: {} }],
  ["no pages map", { templates: VALID.templates }],
  ["the empty default", { templates: {}, pages: {} }],
  [
    "an entry with no hidden list",
    { ...VALID, templates: { ...VALID.templates, index: { slots: {} } } },
  ],
  [
    "an entry whose hidden list is not strings",
    {
      ...VALID,
      templates: { ...VALID.templates, index: { slots: {}, hiddenSlots: [1] } },
    },
  ],
  [
    "an entry whose slots are an array",
    {
      ...VALID,
      templates: { ...VALID.templates, index: { slots: [], hiddenSlots: [] } },
    },
  ],
];

// ---------------------------------------------------------------------------
// The dev server's content endpoint

type Middleware = (
  req: { url: string; method: string },
  res: FakeResponse,
  next: () => void,
) => void;

type FakeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

function devServerEndpoint(readFile: () => string) {
  const fs = { readFileSync: vi.fn(readFile) };
  const path = { join: (...parts: string[]) => parts.join("/") };
  const plugin = new Function(
    "fs",
    "path",
    `return (${themePreviewContentPluginSource()});`,
  )(fs, path) as { configureServer: (server: unknown) => void };
  let middleware: Middleware | null = null;
  plugin.configureServer({
    config: { root: "/workspace" },
    middlewares: {
      use: (handler: Middleware) => {
        middleware = handler;
      },
    },
  });
  return {
    fs,
    get(pathname: string) {
      const res: FakeResponse = {
        statusCode: 0,
        headers: {},
        body: "",
        setHeader(name, value) {
          this.headers[name.toLowerCase()] = value;
        },
        end(body = "") {
          this.body = body;
        },
      };
      const next = vi.fn();
      middleware!(
        {
          url: `${THEME_PREVIEW_CONTENT_PATH}?path=${encodeURIComponent(pathname)}`,
          method: "GET",
        },
        res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      return res;
    },
  };
}

function expectRefusal(response: { status: number; body: string }) {
  expect(response.status).toBeGreaterThanOrEqual(400);
  // The existing error shape: a JSON body naming the error, no content.
  const body = JSON.parse(response.body) as Record<string, unknown>;
  expect(typeof body.error).toBe("string");
  expect(body).not.toHaveProperty("slots");
  expect(body).not.toHaveProperty("hiddenSlots");
}

describe("the dev server's content endpoint", () => {
  const status = (res: FakeResponse) => ({ status: res.statusCode, body: res.body });

  it.each([
    [
      "a missing file",
      () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    ],
    [
      "a read error",
      () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
    ],
    ["corrupt data", () => '{"templates": {"index": '],
    ["an empty file", () => ""],
  ])("refuses %s instead of answering empty content", (_label, readFile) => {
    const endpoint = devServerEndpoint(readFile);
    expectRefusal(status(endpoint.get("/")));
    expect(endpoint.fs.readFileSync).toHaveBeenCalled();
  });

  it.each(UNREADABLE_SHAPES)(
    "refuses a snapshot of the wrong shape: %s",
    (_label, snapshot) => {
      const endpoint = devServerEndpoint(() => JSON.stringify(snapshot));
      expectRefusal(status(endpoint.get("/")));
    },
  );

  it("refuses a path whose entry the snapshot does not hold", () => {
    const { shell: _shell, ...withoutShell } = VALID;
    const endpoint = devServerEndpoint(() => JSON.stringify(withoutShell));
    // An unmapped route is answered from the shell; with none, it cannot be.
    expectRefusal(status(endpoint.get("/contact")));
    // A path the snapshot does describe is still answered.
    expect(endpoint.get("/").statusCode).toBe(200);
  });

  it("does not serve an earlier good snapshot once the file cannot be read", () => {
    let text: string | null = JSON.stringify(VALID);
    const endpoint = devServerEndpoint(() => {
      if (text === null) throw new Error("ENOENT");
      return text;
    });
    expect(endpoint.get("/").statusCode).toBe(200);
    text = null;
    expectRefusal(status(endpoint.get("/")));
  });

  it("answers a route with no Document with empty content", async () => {
    const snapshot = await nothingStored();
    const endpoint = devServerEndpoint(() => JSON.stringify(snapshot));
    for (const pathname of ["/", "/contact", "/pages/about", "/products/a"]) {
      const res = endpoint.get(pathname);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ slots: {}, hiddenSlots: [] });
    }
  });

  it("answers a valid snapshot exactly as before", () => {
    const endpoint = devServerEndpoint(() => JSON.stringify(VALID));
    const home = endpoint.get("/");
    expect(home.statusCode).toBe(200);
    expect(home.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(home.body)).toEqual(VALID.templates.index);
    expect(JSON.parse(endpoint.get("/pages/about").body)).toEqual(
      VALID.templates.page,
    );
    expect(JSON.parse(endpoint.get("/contact").body)).toEqual(VALID.shell);
  });
});

// ---------------------------------------------------------------------------
// The page's own fetch interception (client-only Live Preview)

function previewFrame(snapshot: unknown) {
  let source = themePreviewContentModuleSource();
  for (const pattern of [
    /import \{[^}]*\} from "\.\/preview\/preview-protocol";\n/,
    /import initialSnapshot from "\.\/preview-content-snapshot";\n/,
  ]) {
    if (!pattern.test(source)) {
      throw new Error(`the preview content module no longer has ${pattern}`);
    }
    source = source.replace(pattern, "");
  }
  source = source
    .replaceAll("import.meta.hot", "undefined")
    .replace(/^export /gm, "");
  const network = vi.fn(async () => new Response("from the network"));
  const window = {
    location: new URL("http://127.0.0.1:5173/"),
    fetch: network as (input: unknown) => Promise<Response>,
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
  const exports = new Function(
    "window",
    "initialSnapshot",
    "parseEditorToPreviewWindowEvent",
    "postPreviewToEditorMessage",
    "documentPreviewRuntimeChannel",
    `${source}\nreturn { updatePreviewContent, previewSlotContent, previewSlotHidden };`,
  )(
    window,
    JSON.parse(JSON.stringify(snapshot)),
    () => null,
    () => {},
    () => null,
  ) as {
    updatePreviewContent: (
      sectionId: string,
      props?: Record<string, unknown>,
      enabled?: boolean,
    ) => boolean;
    previewSlotContent: (sectionId: string) => unknown;
    previewSlotHidden: (sectionId: string) => boolean;
  };
  return {
    ...exports,
    network,
    read: async (pathname: string) => {
      const response = await window.fetch(
        `${THEME_PREVIEW_CONTENT_PATH}?path=${encodeURIComponent(pathname)}`,
      );
      return { status: response.status, body: await response.text() };
    },
  };
}

describe("the client-only preview's content reads", () => {
  it.each(UNREADABLE_SHAPES)(
    "refuses a snapshot of the wrong shape: %s",
    async (_label, snapshot) => {
      const frame = previewFrame(snapshot);
      expectRefusal(await frame.read("/"));
      expect(frame.network).not.toHaveBeenCalled();
    },
  );

  it("answers a route with no Document with empty content", async () => {
    const frame = previewFrame(await nothingStored());
    const home = await frame.read("/");
    expect(home.status).toBe(200);
    expect(JSON.parse(home.body)).toEqual({ slots: {}, hiddenSlots: [] });
    const contact = await frame.read("/contact");
    expect(contact.status).toBe(200);
    expect(JSON.parse(contact.body)).toEqual({ slots: {}, hiddenSlots: [] });
  });

  it("answers a valid snapshot exactly as before", async () => {
    const frame = previewFrame(VALID);
    const home = await frame.read("/");
    expect(home.status).toBe(200);
    expect(JSON.parse(home.body)).toEqual(VALID.templates.index);
  });

  it("holds every section hidden, and takes no edit, on a page it cannot read", () => {
    const frame = previewFrame({ templates: {}, pages: {} });
    // Never "not hidden": that is the answer that brings a section back.
    expect(frame.previewSlotHidden("promo")).toBe(true);
    expect(frame.previewSlotContent("hero")).toBeUndefined();
    expect(frame.updatePreviewContent("hero", { heading: "Typed" })).toBe(false);
  });

  it("keeps the hidden list of a page it can read (control)", () => {
    const frame = previewFrame(VALID);
    expect(frame.previewSlotHidden("promo")).toBe(true);
    expect(frame.previewSlotHidden("hero")).toBe(false);
    expect(frame.updatePreviewContent("hero", { heading: "Typed" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The full Start preview Worker's content origin (server render)

describe("the Start preview Worker's content origin", () => {
  const IMPORT_CALL = `import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}")`;

  function startWorker(load: () => Promise<unknown>) {
    const source = themePreviewStartWorkerSource("instance-123");
    expect(source).toContain(IMPORT_CALL);
    const sandbox = {
      Request,
      Response,
      URL,
      Headers,
      fetch: globalThis.fetch as (input: string) => Promise<Response>,
      loadDataModule: load,
      entry: undefined as unknown,
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
    return async (pathname: string) => {
      const response = await sandbox.fetch(
        `${THEME_PREVIEW_START_CONTENT_ORIGIN}${THEME_PREVIEW_CONTENT_PATH}?path=${encodeURIComponent(pathname)}`,
      );
      return { status: response.status, body: await response.text() };
    };
  }

  it.each([
    ["a missing data file", () => Promise.reject(new Error("Cannot find module"))],
    ["corrupt data", () => Promise.reject(new SyntaxError("Unexpected end of JSON"))],
    ["a module with no default", () => Promise.resolve({})],
  ])("refuses %s instead of answering empty content", async (_label, load) => {
    const read = startWorker(load);
    expectRefusal(await read("/"));
  });

  it.each(UNREADABLE_SHAPES)(
    "refuses a snapshot of the wrong shape: %s",
    async (_label, snapshot) => {
      const read = startWorker(() => Promise.resolve({ default: snapshot }));
      expectRefusal(await read("/"));
    },
  );

  it("answers a route with no Document with empty content", async () => {
    const snapshot = await nothingStored();
    const read = startWorker(() => Promise.resolve({ default: snapshot }));
    for (const pathname of ["/", "/contact"]) {
      const answer = await read(pathname);
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body) as Content).toEqual({
        slots: {},
        hiddenSlots: [],
      });
    }
  });

  it("answers a valid snapshot exactly as before", async () => {
    const read = startWorker(() => Promise.resolve({ default: VALID }));
    const home = await read("/");
    expect(home.status).toBe(200);
    expect(JSON.parse(home.body)).toEqual(VALID.templates.index);
  });
});
