// @vitest-environment node
/**
 * The parser Worker through a real service binding in local workerd: the
 * contract on real `.astro` files, the limits, and every refusal as a code in
 * the payload. The shapes that exceed a limit or trap are M1c's (M1c report
 * 2.1). Local only: workerd enforces no memory limit, so nothing here says
 * anything about the 128 MB isolate on Cloudflare.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

import {
  ASTRO_PARSER_ERROR_STATUS,
  ASTRO_PARSER_LIMITS,
  checkAstroParseResponse,
  type AstroParseAt,
  type AstroParseFailure,
  type AstroParseOutline,
  type AstroParseRequest,
  type AstroParserErrorCode,
} from "./contract";
import {
  PACKAGE_DIR,
  startLocalAstroParser,
  type LocalAstroParser,
} from "./testing/local-binding";

const FIXTURES = join(PACKAGE_DIR, "..", "..", "fixtures", "astro");

function astroFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(path).isDirectory()) return astroFiles(path);
    return name.endsWith(".astro") ? [path] : [];
  });
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const query = (request: AstroParseRequest) =>
  request.mode === "at" ? `mode=at&offset=${request.offset}` : "mode=outline";

async function call(
  parser: LocalAstroParser,
  body: string | Uint8Array<ArrayBuffer>,
  request: AstroParseRequest = { mode: "outline" },
  init: RequestInit = {},
) {
  const response = await parser.binding.fetch(
    `https://astro-parser/parse/v1?${query(request)}`,
    { method: "POST", body, ...init },
  );
  return { status: response.status, payload: await response.json() };
}

/** A parse that must succeed and pass the contract check against `source`. */
async function parseOk<M extends AstroParseRequest>(
  parser: LocalAstroParser,
  source: string,
  request: M,
): Promise<M extends { mode: "at" } ? AstroParseAt : AstroParseOutline> {
  const bytes = new TextEncoder().encode(source);
  const { status, payload } = await call(parser, bytes, request);
  expect(status, JSON.stringify(payload)).toBe(200);
  const check = checkAstroParseResponse(payload, {
    request,
    sourceSha256: await sha256Hex(bytes),
    sourceBytes: bytes.byteLength,
    sourceLength: source.length,
  });
  expect(check).toMatchObject({ ok: true });
  return payload as M extends { mode: "at" } ? AstroParseAt : AstroParseOutline;
}

function expectRefusal(
  result: { status: number; payload: unknown },
  code: AstroParserErrorCode,
) {
  const failure = result.payload as AstroParseFailure;
  expect(failure).toMatchObject({ v: 1, ok: false, error: { code } });
  expect(typeof failure.error.detail).toBe("string");
  expect(result.status).toBe(ASTRO_PARSER_ERROR_STATUS[code]);
}

/** M1c's `n-tiny-elements`: just under the size limit, an outline over the cap. */
const TINY_ELEMENTS = "<i/>".repeat(25_250);
/** M1c's `t-fm-array-1600`: 3.2 KB that overflows the compiler's stack. */
const TRAP = `---\nconst a = ${"[".repeat(1600)}${"]".repeat(1600)};\n---\n<p/>`;

describe("the parser Worker through Core's service binding", () => {
  let parser: LocalAstroParser;
  beforeAll(async () => {
    parser = await startLocalAstroParser();
  }, 60_000);
  afterAll(() => parser?.dispose());

  const fixtures = astroFiles(FIXTURES);

  it("finds the repository's real .astro fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it.each(fixtures.map((path) => [relative(FIXTURES, path), path]))(
    "outlines %s with every element where its tag is",
    async (_, path) => {
      const source = readFileSync(path, "utf8");
      const outline = await parseOk(parser, source, { mode: "outline" });
      expect(outline.elementCount).toBeGreaterThan(0);
      for (let i = 0; i < outline.nodes.length; i += 5) {
        const [start, , tag] = outline.nodes.slice(i, i + 5);
        const name = outline.tags[tag];
        if (name === "#fragment") continue;
        expect(source.slice(start, start + 1 + name.length)).toBe(`<${name}`);
      }
      if (source.startsWith("---")) {
        expect(outline.frontmatter?.[0]).toBe(0);
        expect(source.slice(0, outline.frontmatter![1])).toMatch(/---\s*$/);
      }
    },
  );

  it("answers a position with the element path and its attributes", async () => {
    const path = join(
      FIXTURES,
      "cloudflare-astro-blog-starter/src/layouts/BlogPost.astro",
    );
    const source = readFileSync(path, "utf8");
    const start = source.indexOf("<FormattedDate");
    expect(start).toBeGreaterThan(0);
    const at = await parseOk(parser, source, { mode: "at", offset: start + 1 });
    const [tag, elementStart] = at.path.at(-1)!;
    expect(tag).toBe("FormattedDate");
    expect(elementStart).toBe(start);
    expect(at.fields.length).toBeGreaterThan(0);
    for (const field of at.fields) {
      expect(source.slice(field.start, field.end).startsWith(field.name)).toBe(
        true,
      );
      expect(field.kind).toBe("expression");
      expect(source[field.valueStart!]).toBe("{");
    }
  });

  it("gives UTF-16 positions past CJK and emoji, and diagnostics in bytes", async () => {
    const source = `---\nconst a = 1;\n---\n<div class="x">中文 😀 <Hero title={a} /></div>`;
    const hero = source.indexOf("<Hero");
    const outline = await parseOk(parser, source, { mode: "outline" });
    expect(outline.tags).toEqual(["div", "Hero"]);
    expect(outline.nodes.slice(5, 7)).toEqual([hero, hero + 18]);

    const broken = "中文中文<p>{a + }</p>\n";
    const result = await parseOk(parser, broken, { mode: "outline" });
    expect(result.diagnostics.total).toBe(1);
    // The `}` is UTF-16 offset 12 and UTF-8 byte 20 (four 3-byte characters).
    expect(broken.indexOf("}")).toBe(12);
    expect(result.diagnostics.first[0]).toMatchObject({
      severity: "error",
      byteStart: 20,
    });
  });

  it("ties the answer to the bytes it received", async () => {
    const source = "<p>a</p>";
    const outline = await parseOk(parser, source, { mode: "outline" });
    expect(outline.source).toEqual({
      sha256: await sha256Hex(new TextEncoder().encode(source)),
      bytes: 8,
      length: 8,
    });
    const other = checkAstroParseResponse(outline, {
      request: { mode: "outline" },
      sourceSha256: await sha256Hex(new TextEncoder().encode("<p>b</p>")),
      sourceBytes: 8,
      sourceLength: 8,
    });
    expect(other).toEqual({ ok: false, reason: "source" });
  });

  it("logs each request once with its request id, for per-request reconciliation", async () => {
    const id = crypto.randomUUID();
    const tagged = await call(
      parser,
      "<p/>",
      { mode: "outline" },
      {
        headers: { "x-morph-request-id": id },
      },
    );
    expect(tagged.status).toBe(200);
    const refused = crypto.randomUUID();
    await call(
      parser,
      new Uint8Array([0xff]),
      { mode: "outline" },
      {
        headers: { "x-morph-request-id": refused },
      },
    );
    const ignored = await call(
      parser,
      "<p/>",
      { mode: "outline" },
      {
        headers: { "x-morph-request-id": "not-a-uuid" },
      },
    );
    expect(ignored.status).toBe(200);
    await expect
      .poll(() => parser.logs().filter((line) => line.requestId === refused))
      .toHaveLength(1);
    const lines = parser.logs();
    expect(lines.filter((line) => line.requestId === id)).toEqual([
      expect.objectContaining({ astroParser: "parse", status: 200 }),
    ]);
    expect(lines.find((line) => line.requestId === refused)).toMatchObject({
      status: 400,
      error: "source-not-utf8",
    });
    expect(lines.some((line) => line.requestId === "not-a-uuid")).toBe(false);
  });

  it("refuses bad requests as codes", async () => {
    expectRefusal(
      await call(parser, "<p/>", { mode: "at", offset: -1 }),
      "invalid-request",
    );
    const badMode = await parser.binding.fetch(
      "https://astro-parser/parse/v1?mode=ast",
      { method: "POST", body: "<p/>" },
    );
    expectRefusal(
      { status: badMode.status, payload: await badMode.json() },
      "invalid-request",
    );
    for (const [method, path] of [
      ["GET", "/parse/v1?mode=outline"],
      ["POST", "/parse?mode=outline"],
      ["POST", "/"],
    ]) {
      const response = await parser.binding.fetch(
        `https://astro-parser${path}`,
        method === "GET" ? { method } : { method, body: "<p/>" },
      );
      expectRefusal(
        { status: response.status, payload: await response.json() },
        "not-found",
      );
    }
  });

  it("enforces the source byte limit on what arrives, at exactly the limit", async () => {
    const limit = ASTRO_PARSER_LIMITS.maxSourceBytes;
    const fill = (bytes: number) => `<p>${"a".repeat(bytes - 7)}</p>`;
    await parseOk(parser, fill(limit), { mode: "outline" });
    expectRefusal(await call(parser, fill(limit + 1)), "source-too-large");
    // Multi-byte text counts in bytes, not characters.
    const cjk = "中".repeat(Math.floor(limit / 3) + 1);
    expect(cjk.length).toBeLessThan(limit);
    expectRefusal(await call(parser, cjk), "source-too-large");
  });

  it("refuses a body that is not UTF-8", async () => {
    expectRefusal(
      await call(parser, new Uint8Array([0x3c, 0x70, 0x3e, 0xff, 0xfe])),
      "source-not-utf8",
    );
  });

  it("caps the answer while building it", async () => {
    expect(new TextEncoder().encode(TINY_ELEMENTS).byteLength).toBeLessThan(
      ASTRO_PARSER_LIMITS.maxSourceBytes,
    );
    expectRefusal(await call(parser, TINY_ELEMENTS), "result-too-large");
    // The same file asked about one position is small.
    await parseOk(parser, TINY_ELEMENTS, { mode: "at", offset: 4 });
  });

  it("takes one parse at a time with a bounded line, refusing the rest at once", async () => {
    // Takes the slot and keeps its body open for HOLD_MS. The clock is read
    // before the hold is sent, so the stream cannot close before
    // `heldAt + HOLD_MS`: that is a bound a slow machine cannot break.
    //
    // Margins, both measured from the arrival of the queued calls (SETTLE_MS
    // after the hold): they wait HOLD_MS - SETTLE_MS = 1000 ms against the
    // 2000 ms wait limit, and the refusal has the same 1000 ms to come before
    // the hold ends. A stall of a second in either direction is needed to
    // break this, not the 300 ms the earlier numbers allowed.
    const HOLD_MS = 1_500;
    const SETTLE_MS = 500;
    const heldAt = Date.now();
    const held = parser.core(`/hold?ms=${HOLD_MS}`, { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const queued = await Promise.all(
      Array.from({ length: ASTRO_PARSER_LIMITS.maxWaiters + 1 }, () =>
        call(parser, "<p>queued</p>").then((result) => ({
          ...result,
          endedAt: Date.now(),
        })),
      ),
    );
    const busy = queued.filter((result) => result.status === 503);
    expect(busy).toHaveLength(1);
    expectRefusal(busy[0], "parser-busy");
    // Refused at once: it was answered while the hold was still open. Had it
    // been queued it could not have been answered before the hold ended.
    expect(busy[0].endedAt).toBeLessThan(heldAt + HOLD_MS);
    const served = queued.filter((result) => result.status === 200);
    expect(served).toHaveLength(ASTRO_PARSER_LIMITS.maxWaiters);
    // Served only after the hold released the slot. If the hold had not taken
    // the slot yet, a queued call would have taken it and finished early, and
    // this fails rather than passing for the wrong reason.
    for (const result of served) {
      expect(result.endedAt).toBeGreaterThanOrEqual(heldAt + HOLD_MS - 50);
    }
    expect((await held).status).toBe(200);
  });

  it("refuses a request that waits longer than the bounded wait", async () => {
    // The hold must outlast the wait limit (2000 ms) with room to spare, yet
    // close well inside the body deadline (5000 ms), or the hold itself would
    // be refused. At 3500 ms: the queued call may arrive up to 1200 ms late
    // and still time out before the hold ends, and the hold has 1500 ms of
    // slack before its own deadline.
    const held = parser.core("/hold?ms=3500", { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    const waited = await call(parser, "<p>waits</p>");
    expectRefusal(waited, "parser-wait-timeout");
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      ASTRO_PARSER_LIMITS.maxWaitMs - 100,
    );
    expect((await held).status).toBe(200);
  });

  it("ends a body that stops arriving instead of holding the slot", async () => {
    const started = Date.now();
    // The stream would close at 20 s: far past the 5 s deadline, so the
    // refusal can only have come from the deadline, with 5 s of slack on the
    // upper bound below.
    const held = await parser.core("/hold?ms=20000", { method: "POST" });
    expect(held.status).toBe(ASTRO_PARSER_ERROR_STATUS["source-read-timeout"]);
    expect(await held.json()).toMatchObject({
      ok: false,
      error: { code: "source-read-timeout" },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      ASTRO_PARSER_LIMITS.maxBodyReadMs - 100,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
    // The slot is free again.
    await parseOk(parser, "<p>after</p>", { mode: "outline" });
  });
});

describe("bundled by Wrangler from its own wrangler.jsonc", () => {
  // What a deployment would ship: Wrangler resolves the `.wasm` import with
  // the config's CompiledWasm rule. The binding tests above bundle with
  // esbuild directly, so this is the check that the config itself works.
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | undefined;
  beforeAll(async () => {
    worker = await unstable_startWorker({
      config: join(PACKAGE_DIR, "wrangler.jsonc"),
      dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
    });
    await worker.ready;
  }, 120_000);
  afterAll(() => worker?.dispose());

  it("parses", async () => {
    const response = await worker!.fetch(
      "http://localhost/parse/v1?mode=outline",
      { method: "POST", body: "<p>bundled</p>" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      tags: ["p"],
      nodes: [0, 14, 0, 0, 0],
    });
  });
});

describe("after the compiler traps", () => {
  let parser: LocalAstroParser;
  beforeAll(async () => {
    parser = await startLocalAstroParser();
  }, 60_000);
  afterAll(() => parser?.dispose());

  it("poisons the isolate: the trap and every later request are explicit refusals", async () => {
    await parseOk(parser, "<p>before</p>", { mode: "outline" });
    expectRefusal(await call(parser, TRAP), "parser-trapped");
    for (const source of ["<p>after</p>", "<p>still</p>"]) {
      expectRefusal(await call(parser, source), "parser-unavailable");
    }
  });
});
