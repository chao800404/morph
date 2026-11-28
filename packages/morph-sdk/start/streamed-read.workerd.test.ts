// @vitest-environment node
/**
 * Render-mode evidence (handoff/2026-11-28/start-render-modes-audit.md,
 * "Codex review — adopted", item 3): what the real `@morph/sdk/start` reads
 * when a published Theme's page keeps streaming after its first chunk.
 *
 * The page render runs in workerd itself (the pinned `workerd` binary, from a
 * capnp config), inside TanStack Start's own request scope: the Theme handler
 * is wrapped by `requestHandler` from `@tanstack/react-start/server`, the
 * function `createStartHandler` serves every Start request through, so
 * `getRequest()` in the SDK is Start's real AsyncLocalStorage lookup. The
 * reads are the SDK's own `morph.pages.get`, bundled from
 * `packages/morph-sdk/start/index.ts` unchanged; nothing hands it a Request.
 *
 * Core is a stand-in in the same isolate (it answers `/_morph/content` on the
 * content origin the request names). It keeps only the rule Core's
 * `serveContent` applies (storefront-production.service.ts): a read carrying a
 * render context is answered from the release that context names, a read
 * carrying none from the release active now. The real rule is held by
 * storefront-production.service.test.ts ("a page render during a release
 * change (G3)"); this file asks what the SDK sends it once a body streams.
 *
 * Each page request enters while release A is active. The test reads the
 * first streamed chunk, then makes B active (a publish), and only then lets
 * the rest of the body be produced. Three ways a late read can happen are
 * kept apart, because they can differ:
 *
 * - `/deferred`: a deferred loader value. The promise is created while the
 *   handler runs (as a loader's unawaited promise is) and awaited by the body
 *   later; its continuation is the read.
 * - `/pull`: a read made from inside a backpressured body's `pull()`
 *   (`highWaterMark: 0`), which the runtime calls when the reader asks for
 *   the next chunk.
 * - `?context=none`: the page request reaching the Theme without the
 *   platform's render context header.
 *
 * Every assertion is about what happened; none is a timing threshold.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  serveWorkerd,
  type ServedWorkerd,
} from "../../../src/lib/test-utils/workerd-serve";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const SDK_START = path.join(HERE, "index.ts");

/**
 * The Theme side of one page request, and the Core stand-in. Bundled with
 * the real SDK and Start's real request scope.
 */
const ENTRY = `
import { requestHandler } from "@tanstack/react-start/server";
import { morph } from ${JSON.stringify(SDK_START)};

const CORE = "http://morph-core.invalid";
const CONTEXT = "x-morph-render-context";
const state = { active: "A", switches: 0 };
const encoder = new TextEncoder();

// Core's content rule, and nothing else: see the file comment.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== CORE) return realFetch(input, init);
  const context = request.headers.get(CONTEXT);
  const release = context === null ? state.active : context.replace(/^rc-/, "");
  return Response.json({
    slots: { hero: { title: "release-" + release } },
    hiddenSlots: [],
    _read: { context },
  });
};

/** Waits, on this request's own timers, until the test has switched release. */
async function afterSwitch(seen) {
  for (let i = 0; i < 600 && state.switches === seen; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (state.switches === seen) throw new Error("PROBE_NO_SWITCH");
}

async function read() {
  try {
    const page = await morph.pages.get("/");
    return page.hero.title;
  } catch (error) {
    return "ERROR:" + (error && error.code ? error.code + ":" : "") + String(error && error.message);
  }
}

const theme = requestHandler(async (request) => {
  const url = new URL(request.url);
  const seen = state.switches;
  const first = await read();
  if (url.pathname === "/deferred") {
    // As a loader's deferred value: created now, awaited by the body later.
    const late = afterSwitch(seen).then(read);
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("FIRST:" + first + "\\n"));
        controller.enqueue(encoder.encode("LATE:" + (await late) + "\\n"));
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/plain" } });
  }
  if (url.pathname === "/pull") {
    let step = 0;
    const body = new ReadableStream(
      {
        async pull(controller) {
          step += 1;
          if (step === 1) {
            controller.enqueue(encoder.encode("FIRST:" + first + "\\n"));
          } else if (step === 2) {
            await afterSwitch(seen);
            controller.enqueue(encoder.encode("LATE:" + (await read()) + "\\n"));
          } else {
            controller.close();
          }
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { headers: { "content-type": "text/plain" } });
  }
  return new Response("FIRST:" + first + "\\n", { headers: { "content-type": "text/plain" } });
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__switch") {
      state.active = url.searchParams.get("to") ?? "B";
      state.switches += 1;
      return new Response("switched:" + state.active);
    }
    if (url.pathname === "/__reset") {
      state.active = "A";
      return new Response("reset");
    }
    // Core in front of the Theme: names the content origin, and the render
    // context of the release this page request was resolved to.
    const headers = new Headers(request.headers);
    headers.set("x-morph-content-origin", CORE);
    if (url.searchParams.get("context") !== "none") {
      headers.set(CONTEXT, "rc-" + state.active);
    }
    return theme(new Request(request.url, { method: request.method, headers }));
  },
};
`;

describe("@morph/sdk/start reads while a published page streams (workerd)", () => {
  let served: ServedWorkerd | null = null;
  let dir = "";
  let origin = "";

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "morph-sdk-stream-"));
    await build({
      stdin: {
        contents: ENTRY,
        resolveDir: REPO,
        sourcefile: "probe-entry.mjs",
        loader: "js",
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      conditions: ["workerd", "worker", "import", "module", "default"],
      mainFields: ["module", "main"],
      external: ["node:*", "cloudflare:*"],
      // Start's build-time virtual modules. Only `createStartHandler` and the
      // manifest import them, lazily, and this probe calls neither: a stub
      // that throws if reached keeps that honest.
      plugins: [
        {
          name: "start-virtual-modules",
          setup(builder) {
            builder.onResolve(
              { filter: /^(#tanstack-|tanstack-start-manifest:)/ },
              (args) => ({ path: args.path, namespace: "start-virtual" }),
            );
            builder.onLoad({ filter: /.*/, namespace: "start-virtual" }, (args) => ({
              contents: `throw new Error(${JSON.stringify(`PROBE_UNEXPECTED_VIRTUAL_MODULE ${args.path}`)});`,
              loader: "js",
            }));
          },
        },
      ],
      outfile: path.join(dir, "main.mjs"),
      logLevel: "silent",
    });
    // The socket's address is the OS's choice (serveWorkerd binds
    // 127.0.0.1:0 and reads the port back); the config names none.
    fs.writeFileSync(
      path.join(dir, "config.capnp"),
      [
        'using Workerd = import "/workerd/workerd.capnp";',
        "const config :Workerd.Config = (",
        '  services = [ (name = "main", worker = .probe) ],',
        '  sockets = [ (name = "http", http = (), service = "main") ],',
        ");",
        "const probe :Workerd.Worker = (",
        '  modules = [ (name = "main.mjs", esModule = embed "main.mjs") ],',
        '  compatibilityDate = "2025-09-02",',
        '  compatibilityFlags = ["nodejs_compat"],',
        ");",
      ].join("\n"),
    );
    served = await serveWorkerd(path.join(dir, "config.capnp"), { socket: "http" });
    origin = served.origin;
  }, 120_000);

  afterAll(async () => {
    await served?.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * One page: its first chunk read while A is active, then B made active,
   * then the rest of the body. Returns both lines.
   */
  async function streamAcrossSwitch(pathAndQuery: string) {
    expect(await (await fetch(origin + "/__reset")).text()).toBe("reset");
    const response = await fetch(origin + pathAndQuery);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const first = text.slice(0, text.indexOf("\n"));
    // The publish lands after the first chunk has been flushed.
    expect(await (await fetch(origin + "/__switch?to=B")).text()).toBe(
      "switched:B",
    );
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const late = text.split("\n").find((line) => line.startsWith("LATE:"));
    // A fresh page request after the switch.
    const fresh = await (await fetch(origin + "/plain")).text();
    return { first, late, fresh: fresh.trim() };
  }

  it("a deferred value's late read stays on the release its page was resolved to; a fresh request reads the new one", async () => {
    const seen = await streamAcrossSwitch("/deferred");
    expect(seen.first).toBe("FIRST:release-A");
    expect(seen.late).toBe("LATE:release-A");
    expect(seen.fresh).toBe("FIRST:release-B");
  }, 60_000);

  // Recorded, not a contract: Start's request scope does not reach a body
  // pull() the runtime calls later. The SDK's getRequest() then throws, so
  // the read fails closed (no content, not another release's). The pinned
  // preview Worker found the same in workerd and pipes its body inside the
  // request's scope (theme-preview-start-runtime.workerd.test.ts); nothing
  // does that on the published path.
  it("RECORDED: a read made inside a backpressured body pull() after the first chunk loses Start's request and throws", async () => {
    const seen = await streamAcrossSwitch("/pull");
    expect(seen.first).toBe("FIRST:release-A");
    expect(seen.late).toBe(
      "LATE:ERROR:No StartEvent found in AsyncLocalStorage. Make sure you are using the function within the server runtime.",
    );
    expect(seen.fresh).toBe("FIRST:release-B");
  }, 60_000);

  it("RECORDED: a page request that reaches the Theme without a render context reads the active release, mid-stream too", async () => {
    const seen = await streamAcrossSwitch("/deferred?context=none");
    // With no context the SDK sends none, and Core answers each read from
    // the release active at that moment: one page, two releases.
    expect(seen.first).toBe("FIRST:release-A");
    expect(seen.late).toBe("LATE:release-B");
    expect(seen.fresh).toBe("FIRST:release-B");
  }, 60_000);
});
