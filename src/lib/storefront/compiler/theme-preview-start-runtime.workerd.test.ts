// @vitest-environment node
/**
 * The pinned Live Preview Worker in workerd itself (the pinned `workerd`
 * binary, run from a capnp config), where a
 * response stream's `pull()` runs outside the request's AsyncLocalStorage
 * context (Codex review round 2, P1). Every content read a response makes,
 * from its handler or from its streamed body, HTML or plain text, Start's
 * Worker or Astro's, is answered from the snapshot its request entered
 * with — never refused, never another request's.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
} from "./theme-preview-content";
import { previewContentAsCoreWrites } from "./theme-preview-content.test-support";
import {
  PREVIEW_PIN_HEADER,
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";

const ENTRY = "./theme-entry.mjs";

/**
 * Stands in for Start's (or Astro's) server entry: reads content in its
 * handler, then again from a backpressured stream's `pull()`, forwarding
 * the request's pin as the SDK's hosted entries forward the render context.
 */
const THEME_ENTRY = `
const ORIGIN = ${JSON.stringify(THEME_PREVIEW_START_CONTENT_ORIGIN)};
const PIN = ${JSON.stringify(PREVIEW_PIN_HEADER)};
async function read(request, query) {
  const headers = {};
  const pin = request.headers.get(PIN);
  // ?nopin: a reader that does not send the pin back (an old content.ts).
  if (pin !== null && !new URL(request.url).searchParams.has("nopin")) headers[PIN] = pin;
  const response = await fetch(ORIGIN + "/_morph/content?" + query, { headers });
  return response.status + ":" + (await response.text());
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const type = url.pathname === "/text" ? "text/plain" : "text/html; charset=utf-8";
    const first = await read(request, "path=%2F");
    let step = 0;
    const body = new ReadableStream({
      async pull(controller) {
        step += 1;
        if (step === 1) {
          controller.enqueue(new TextEncoder().encode("<html><head></head><body>" + "A:" + first + "\\n"));
        } else if (step === 2) {
          // After a sync wrote a newer snapshot: still this request's.
          globalThis.__morphAdvance();
          controller.enqueue(new TextEncoder().encode("B:" + (await read(request, "path=%2F&scope=page")) + "\\n"));
        } else if (step === 3) {
          controller.enqueue(new TextEncoder().encode("C:" + (await read(request, "scope=layout&layout=default&path=%2F")) + "\\n</body></html>"));
        } else {
          controller.close();
        }
      },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: { "content-type": type } });
  },
};
`;

function snapshot(title: string, ticket: number) {
  return {
    ...previewContentAsCoreWrites({
      templates: {
        index: {
          slots: { hero: { title }, header: { title: "Shop " + title } },
          hiddenSlots: [],
        },
      },
      scopedIds: {
        layout: ["header"],
        templates: {
          index: ["hero"],
          product: [],
          collection: [],
          page: [],
          blog: [],
        },
        pages: {},
        routes: {},
      },
    }),
    contentTicket: ticket,
    previewInstance: "0b1f5a52-3c1e-4f43-9d0e-6c0f2f1f9a11",
  };
}

describe.each([
  ["Start", { pinRequestSnapshot: true, stampServedContent: false }],
  ["Astro", { pinRequestSnapshot: true }],
] as const)("the pinned %s Worker in workerd", (_name, options) => {
  let child: ChildProcess | null = null;
  let dir = "";
  let origin = "";
  beforeAll(async () => {
    // The data module is re-imported per read; a sync is a new module body,
    // which a running workerd cannot swap in place, so the data the Worker imports
    // comes from a global the test advances mid-stream, as a sync would.
    const worker = themePreviewStartWorkerSource("preview-1", ENTRY, options)
      .replace(
        `import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}")`,
        "Promise.resolve({ default: globalThis.__morphTestSnapshot() })",
      );
    const wrapper = `
import worker from "./worker.mjs";
let current = ${JSON.stringify(snapshot("one", 1))};
const next = ${JSON.stringify(snapshot("two", 2))};
globalThis.__morphTestSnapshot = () => current;
const first = current;
globalThis.__morphAdvance = () => { current = next; };
export default {
  async fetch(request, env, ctx) {
    // Each request enters while ticket 1 is current.
    current = first;
    return worker.fetch(request, env, ctx);
  },
};
`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "morph-workerd-pin-"));
    fs.writeFileSync(path.join(dir, "main.mjs"), wrapper);
    fs.writeFileSync(path.join(dir, "worker.mjs"), worker);
    fs.writeFileSync(path.join(dir, "theme-entry.mjs"), THEME_ENTRY);
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    origin = `http://127.0.0.1:${port}`;
    fs.writeFileSync(
      path.join(dir, "config.capnp"),
      [
        'using Workerd = import "/workerd/workerd.capnp";',
        "const config :Workerd.Config = (",
        '  services = [ (name = "main", worker = .preview) ],',
        `  sockets = [ (name = "http", address = "127.0.0.1:${port}", http = (), service = "main") ],`,
        ");",
        "const preview :Workerd.Worker = (",
        "  modules = [",
        '    (name = "main.mjs", esModule = embed "main.mjs"),',
        '    (name = "worker.mjs", esModule = embed "worker.mjs"),',
        '    (name = "theme-entry.mjs", esModule = embed "theme-entry.mjs"),',
        "  ],",
        '  compatibilityDate = "2025-09-02",',
        '  compatibilityFlags = ["nodejs_compat"],',
        ");",
      ].join("\n"),
    );
    const binary = createRequire(import.meta.url).resolve("workerd/bin/workerd");
    const output: string[] = [];
    child = spawn(binary, ["serve", path.join(dir, "config.capnp")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await fetch(origin + "/__morph_ready_probe");
        break;
      } catch {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error("workerd did not start: " + output.join(""));
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }, 60_000);
  afterAll(() => {
    child?.kill("SIGKILL");
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(["/", "/text"])(
    "answers handler and streamed reads of %s from the request's own snapshot",
    async (path) => {
      const response = await fetch(origin + path);
      const text = await response.text();
      expect(text).toContain('A:200:{"slots":{"hero":{"title":"one"}');
      expect(text).toContain('B:200:{"scope":"page","slots":{"hero":{"title":"one"}}');
      expect(text).toContain(
        'C:200:{"scope":"layout","layout":"default","slots":{"header":{"title":"Shop one"}}',
      );
      expect(text).not.toContain(":503:");
      expect(text).not.toContain('"title":"two"');
    },
    60_000,
  );

  it("answers a streamed read that does not carry the pin from the same snapshot too", async () => {
    // The Worker pulls the body through a pipe it starts inside the request's
    // async context (releasePinWithBody), so even a reader that does not
    // send the pin back (an old content.ts) stays on its request's snapshot;
    // the token covers any read that escapes that context regardless.
    const text = await (await fetch(origin + "/text?nopin")).text();
    expect(text).toContain('A:200:{"slots":{"hero":{"title":"one"}');
    expect(text).toContain('B:200:{"scope":"page","slots":{"hero":{"title":"one"}}');
    expect(text).not.toContain('"title":"two"');
  }, 60_000);

  it("does not honour a pin the browser forged", async () => {
    const text = await (
      await fetch(origin + "/text", {
        headers: { [PREVIEW_PIN_HEADER]: "morph-preview-pin.forged" },
      })
    ).text();
    // Replaced by the Worker's own: every read is answered from this request's.
    expect(text).not.toContain(":503:");
  }, 60_000);
});
