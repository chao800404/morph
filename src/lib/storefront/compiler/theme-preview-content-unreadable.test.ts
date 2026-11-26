// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_PATH,
  THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
  THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
  createThemePreviewContentSnapshot,
  themePreviewContentModuleSource,
  themePreviewContentPluginSource,
} from "./theme-preview-content";
import { previewContentAsCoreWrites } from "./theme-preview-content.test-support";
import {
  PREVIEW_CONTENT_TICKET_HEADER,
  PREVIEW_INSTANCE_HEADER,
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";
import { START_PREVIEW_ADDRESS_PROBE_PATH } from "../service/preview-address-probe";

/**
 * Every Live Preview reader of the draft snapshot tells "nothing stored" from
 * "could not read", from the data.
 *
 * A snapshot Core wrote for a route with no Document holds that route's entry,
 * empty: `{ slots: {}, hiddenSlots: [] }`, which is an empty success. A
 * snapshot that is missing, unreadable, not JSON, or not of the shape Core
 * writes (an entry or map Core always writes is missing, an entry without its
 * hidden list, a slot that is not an object) says nothing about the page, not
 * even which sections the author hid, so it is answered with a refusal. The
 * Starter 32 reader rejects a refusal and its router shows the error state; an
 * empty success would instead render every hidden section with its component
 * defaults.
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

const withIndex = (index: unknown) => ({
  ...VALID,
  templates: { ...VALID.templates, index },
});

/** What Core writes for a store with no Document at all. */
const nothingStored = () =>
  createThemePreviewContentSnapshot({ templates: [], pages: [] });

describe("the fixture helper for Core-shaped snapshots", () => {
  it("gives exactly what Core writes when there is no Document", async () => {
    expect(previewContentAsCoreWrites()).toEqual(await nothingStored());
  });
});

/** Snapshots a reader cannot answer the home page from. */
const UNREADABLE_SHAPES: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["an array", []],
  ["an object with no templates", { pages: {} }],
  ["templates that are not an object", { ...VALID, templates: [] }],
  ["no pages map", { ...VALID, pages: undefined }],
  ["no routes map", { ...VALID, routes: undefined }],
  ["routes that are not an object", { ...VALID, routes: [] }],
  ["no shell", { ...VALID, shell: undefined }],
  ["a shell with no hidden list", { ...VALID, shell: { slots: {} } }],
  ["the empty default", { templates: {}, pages: {} }],
  [
    "a template entry Core always writes is missing",
    { ...VALID, templates: { ...VALID.templates, blog: undefined } },
  ],
  ["an entry with no hidden list", withIndex({ slots: {} })],
  [
    "an entry whose hidden list is not strings",
    withIndex({ slots: {}, hiddenSlots: [1] }),
  ],
  ["an entry whose slots are an array", withIndex({ slots: [], hiddenSlots: [] })],
  ["a slot value that is null", withIndex({ slots: { hero: null }, hiddenSlots: [] })],
  [
    "a slot value that is a string",
    withIndex({ slots: { hero: "Draft" }, hiddenSlots: [] }),
  ],
  [
    "a slot value that is an array",
    withIndex({ slots: { hero: [] }, hiddenSlots: [] }),
  ],
  [
    "a page entry with no hidden list",
    { ...VALID, pages: { about: { slots: {} } } },
  ],
];

const REFUSAL = {
  status: THEME_PREVIEW_CONTENT_UNREADABLE_STATUS,
  body: THEME_PREVIEW_CONTENT_UNREADABLE_BODY,
};

/** Exactly the refusal: 503 and the `{ error }` body, no content. */
function expectRefusal(response: { status: number; body: string }) {
  expect(THEME_PREVIEW_CONTENT_UNREADABLE_STATUS).toBe(503);
  expect({ status: response.status, body: JSON.parse(response.body) }).toEqual(
    REFUSAL,
  );
}

const BAD_ESCAPE_PATHS = ["/pages/%E0%A4%A", "/pages/%", "/pages/100%25off%zz"];

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
    get(pathname: string, rawQuery?: string) {
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
          url: `${THEME_PREVIEW_CONTENT_PATH}?path=${rawQuery ?? encodeURIComponent(pathname)}`,
          method: "GET",
        },
        res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      return { status: res.statusCode, body: res.body, headers: res.headers };
    },
  };
}

describe("the dev server's content endpoint", () => {
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
    const answer = endpoint.get("/");
    expectRefusal(answer);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(endpoint.fs.readFileSync).toHaveBeenCalled();
  });

  it.each(UNREADABLE_SHAPES)(
    "refuses a snapshot of the wrong shape: %s",
    (_label, snapshot) => {
      const endpoint = devServerEndpoint(() => JSON.stringify(snapshot));
      expectRefusal(endpoint.get("/"));
    },
  );

  it.each(BAD_ESCAPE_PATHS)(
    "refuses a page handle that is not a valid escape (%s), never throwing",
    (pathname) => {
      const endpoint = devServerEndpoint(() => JSON.stringify(VALID));
      expectRefusal(endpoint.get(pathname, encodeURIComponent(pathname)));
    },
  );

  it("answers good, then refuses malformed, then answers the repaired file", () => {
    let text = JSON.stringify(VALID);
    const endpoint = devServerEndpoint(() => text);
    expect(JSON.parse(endpoint.get("/").body)).toEqual(VALID.templates.index);
    text = JSON.stringify(withIndex({ slots: { hero: null }, hiddenSlots: [] }));
    expectRefusal(endpoint.get("/"));
    text = "";
    expectRefusal(endpoint.get("/"));
    const repaired = withIndex({ slots: { hero: { heading: "Fixed" } }, hiddenSlots: [] });
    text = JSON.stringify(repaired);
    const answer = endpoint.get("/");
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual(repaired.templates.index);
  });

  it("answers a route with no Document with empty content", async () => {
    const snapshot = await nothingStored();
    const endpoint = devServerEndpoint(() => JSON.stringify(snapshot));
    for (const pathname of ["/", "/contact", "/pages/about", "/products/a"]) {
      const res = endpoint.get(pathname);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ slots: {}, hiddenSlots: [] });
    }
  });

  it("answers a valid snapshot exactly as before", () => {
    const endpoint = devServerEndpoint(() => JSON.stringify(VALID));
    const home = endpoint.get("/");
    expect(home.status).toBe(200);
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

/**
 * The page, with its snapshot module evaluated as the module is: a JS object
 * literal, where a `"__proto__"` key sets the prototype rather than a field.
 */
function previewFrame(snapshot: unknown, snapshotLiteral?: string) {
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
  const initial = new Function(
    `return (${snapshotLiteral ?? JSON.stringify(snapshot)});`,
  )();
  const exports = new Function(
    "window",
    "initialSnapshot",
    "parseEditorToPreviewWindowEvent",
    "postPreviewToEditorMessage",
    "documentPreviewRuntimeChannel",
    `${source}\nreturn { updatePreviewContent, previewSlotContent, previewSlotHidden, livePreviewContentOverlay };`,
  )(
    window,
    initial,
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
    livePreviewContentOverlay: (pathname: string, base: unknown) => unknown;
  };
  return {
    ...exports,
    network,
    read: async (pathname: string, rawQuery?: string) => {
      const response = await window.fetch(
        `${THEME_PREVIEW_CONTENT_PATH}?path=${rawQuery ?? encodeURIComponent(pathname)}`,
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

  it("refuses an entry whose slots and hidden list are only inherited", async () => {
    const literal = JSON.stringify(VALID).replace(
      JSON.stringify(VALID.templates.index),
      '{"__proto__":{"slots":{},"hiddenSlots":[]}}',
    );
    const frame = previewFrame(null, literal);
    expectRefusal(await frame.read("/"));
  });

  it.each(BAD_ESCAPE_PATHS)(
    "refuses a page handle that is not a valid escape (%s), never throwing",
    async (pathname) => {
      const frame = previewFrame(VALID);
      expectRefusal(await frame.read(pathname, encodeURIComponent(pathname)));
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

  it("records no edit it could not apply, so no later overlay replays it", () => {
    const frame = previewFrame({ templates: {}, pages: {} });
    expect(frame.updatePreviewContent("hero", { heading: "Typed" })).toBe(false);
    expect(frame.updatePreviewContent("promo", undefined, false)).toBe(false);
    // The full Start overlay lays this page's recorded edits over a server
    // read; there must be none.
    expect(
      frame.livePreviewContentOverlay("/", { slots: {}, hiddenSlots: [] }),
    ).toBeNull();
  });

  it("keeps the hidden list of a page it can read (control)", () => {
    const frame = previewFrame(VALID);
    expect(frame.previewSlotHidden("promo")).toBe(true);
    expect(frame.previewSlotHidden("hero")).toBe(false);
    expect(frame.updatePreviewContent("hero", { heading: "Typed" })).toBe(true);
    expect(
      frame.livePreviewContentOverlay("/", { slots: {}, hiddenSlots: [] }),
    ).toEqual({ slots: { hero: { heading: "Typed" } }, hiddenSlots: [] });
  });
});

// ---------------------------------------------------------------------------
// The full Start preview Worker's content origin (server render)

describe("the Start preview Worker's content origin", () => {
  const IMPORT_CALL = `import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}")`;
  const PROBE_URL = `https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`;

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
    const read = async (pathname: string, rawQuery?: string) => {
      const response = await sandbox.fetch(
        `${THEME_PREVIEW_START_CONTENT_ORIGIN}${THEME_PREVIEW_CONTENT_PATH}?path=${rawQuery ?? encodeURIComponent(pathname)}`,
      );
      return { status: response.status, body: await response.text() };
    };
    const probe = async () => {
      const response = await sandbox.entry.fetch(new Request(PROBE_URL));
      return {
        ticket: response.headers.get(PREVIEW_CONTENT_TICKET_HEADER),
        instance: response.headers.get(PREVIEW_INSTANCE_HEADER),
      };
    };
    return Object.assign(read, { probe });
  }

  const ticketed = (snapshot: object, contentTicket: number) => ({
    ...snapshot,
    contentTicket,
    previewInstance: "server-a",
  });

  /** A Worker whose data file the test rewrites between reads. */
  function workerOverFile(initial: unknown) {
    let current: () => Promise<unknown> = () =>
      Promise.resolve({ default: initial });
    const read = startWorker(() => current());
    return {
      read,
      file(next: unknown) {
        current = () => Promise.resolve(next);
      },
      fail(error: Error) {
        current = () => Promise.reject(error);
      },
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

  it.each(BAD_ESCAPE_PATHS)(
    "refuses a page handle that is not a valid escape (%s)",
    async (pathname) => {
      const read = startWorker(() => Promise.resolve({ default: VALID }));
      expectRefusal(await read(pathname, encodeURIComponent(pathname)));
    },
  );

  it.each([
    ["a null default", { default: null }],
    ["no default", {}],
    ["a malformed snapshot with no ticket", { default: { templates: {} } }],
    [
      "a malformed snapshot with a lower ticket",
      { default: ticketed(withIndex({ slots: { hero: null }, hiddenSlots: [] }), 1) },
    ],
  ])(
    "drops a good snapshot it read before when a re-import gives %s",
    async (_label, next) => {
      const worker = workerOverFile(ticketed(VALID, 2));
      expect((await worker.read("/")).status).toBe(200);
      worker.file(next);
      expectRefusal(await worker.read("/"));
    },
  );

  it("drops a good snapshot it read before when the re-import fails", async () => {
    const worker = workerOverFile(ticketed(VALID, 2));
    expect((await worker.read("/")).status).toBe(200);
    worker.fail(new SyntaxError("Unexpected end of JSON"));
    expectRefusal(await worker.read("/"));
  });

  it("answers good, then refuses malformed, then answers the repaired file", async () => {
    const worker = workerOverFile(ticketed(VALID, 2));
    expect(JSON.parse((await worker.read("/")).body)).toEqual(
      VALID.templates.index,
    );
    // Malformed, under a higher ticket than the repair that follows.
    worker.file({
      default: ticketed(withIndex({ slots: { hero: null }, hiddenSlots: [] }), 9),
    });
    expectRefusal(await worker.read("/"));
    const repaired = withIndex({
      slots: { hero: { heading: "Fixed" } },
      hiddenSlots: [],
    });
    worker.file({ default: ticketed(repaired, 3) });
    const answer = await worker.read("/");
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual(repaired.templates.index);
  });

  it("confirms on the probe only a snapshot that passes validation", async () => {
    const worker = workerOverFile(ticketed(VALID, 2));
    expect(await worker.read.probe()).toEqual({ ticket: "2", instance: "server-a" });
    // Corrupt content that still carries a valid ticket and instance.
    worker.file({
      default: ticketed(withIndex({ slots: {}, hiddenSlots: "promo" }), 4),
    });
    expect(await worker.read.probe()).toEqual({ ticket: "0", instance: "" });
    expectRefusal(await worker.read("/"));
    worker.file({ default: ticketed(VALID, 5) });
    expect(await worker.read.probe()).toEqual({ ticket: "5", instance: "server-a" });
  });

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
