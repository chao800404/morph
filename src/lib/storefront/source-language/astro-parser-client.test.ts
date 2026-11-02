// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { experimental_readRawConfig } from "wrangler";

import {
  ASTRO_PARSER_ERROR_STATUS,
  ASTRO_PARSER_LIMITS,
  ASTRO_PARSER_WORKER_NAME,
} from "@morph/astro-parser-worker/contract";
import {
  PACKAGE_DIR,
  startLocalAstroParser,
  type LocalAstroParser,
} from "@morph/astro-parser-worker/testing";

import { MORPH_ASTRO_COMPILER_RS_VERSION } from "./astro-compiler-version";
import {
  ASTRO_PARSER_BINDING,
  astroParserBindingFrom,
  classifyAstroParserRefusal,
  parseAstroSource,
  parseAstroTemplate,
  type AstroParserBinding,
  type AstroTemplateRefusalCode,
} from "./astro-parser-client";

const FIXTURE =
  "fixtures/astro/cloudflare-astro-blog-starter/src/pages/index.astro";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A binding that answers every call with `status` and `body`. */
function answering(status: number, body: string): AstroParserBinding {
  return {
    fetch: vi.fn(async () => new Response(body, { status })),
  };
}

async function outlineOf(source: string) {
  return {
    v: 2,
    ok: true,
    mode: "outline",
    source: {
      sha256: await sha256Hex(source),
      bytes: new TextEncoder().encode(source).byteLength,
      length: source.length,
    },
    frontmatter: null,
    nodes: [0, source.length, 0, 0, 0],
    tags: ["p"],
    elementCount: 1,
    maxDepth: 0,
    diagnostics: { total: 0, first: [] },
  };
}

describe("parseAstroSource fails closed", () => {
  it("reads the binding from env only when it is a binding", () => {
    const binding = answering(200, "{}");
    expect(astroParserBindingFrom({ [ASTRO_PARSER_BINDING]: binding })).toBe(
      binding,
    );
    expect(astroParserBindingFrom({})).toBeNull();
    expect(astroParserBindingFrom({ [ASTRO_PARSER_BINDING]: {} })).toBeNull();
    expect(astroParserBindingFrom(undefined)).toBeNull();
  });

  it("is unavailable without a binding", async () => {
    expect(
      await parseAstroSource(null, "<p/>", { mode: "outline" }),
    ).toMatchObject({ status: "unavailable", code: "binding-missing" });
  });

  it("is unavailable when the binding throws", async () => {
    const binding: AstroParserBinding = {
      fetch: async () => {
        throw new Error("Couldn't find a local dev session");
      },
    };
    expect(
      await parseAstroSource(binding, "<p/>", { mode: "outline" }),
    ).toEqual({
      status: "unavailable",
      code: "binding-failed",
      detail: "Couldn't find a local dev session",
    });
  });

  it("does not send a source over the parser's limit", async () => {
    const binding = answering(200, "{}");
    const source = "a".repeat(ASTRO_PARSER_LIMITS.maxSourceBytes + 1);
    expect(
      await parseAstroSource(binding, source, { mode: "outline" }),
    ).toMatchObject({ status: "unavailable", code: "source-too-large" });
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("passes the parser's refusal code through", async () => {
    const body = JSON.stringify({
      v: 2,
      ok: false,
      error: { code: "parser-unavailable", detail: "poisoned" },
    });
    expect(
      await parseAstroSource(answering(503, body), "<p/>", { mode: "outline" }),
    ).toEqual({
      status: "unavailable",
      code: "parser-unavailable",
      detail: "poisoned",
    });
  });

  it.each([
    ["not JSON", 200, "<html>"],
    [
      "an unknown error code",
      500,
      JSON.stringify({ v: 2, ok: false, error: { code: "oops", detail: "" } }),
    ],
    [
      "a refusal under the wrong status",
      200,
      JSON.stringify({
        v: 2,
        ok: false,
        error: { code: "parser-busy", detail: "" },
      }),
    ],
    ["an answer over the response cap", 200, "x".repeat(262_145)],
  ])("does not take %s for an answer", async (_, status, body) => {
    expect(
      await parseAstroSource(answering(status, body), "<p/>", {
        mode: "outline",
      }),
    ).toMatchObject({ status: "unavailable", code: "invalid-response" });
  });

  it("does not take an answer about another source", async () => {
    const other = JSON.stringify(await outlineOf("<p>b</p>"));
    expect(
      await parseAstroSource(answering(200, other), "<p>a</p>", {
        mode: "outline",
      }),
    ).toEqual({
      status: "unavailable",
      code: "invalid-response",
      detail: "source",
    });
  });

  it("does not take a position outside the source", async () => {
    const answer = await outlineOf("<p>a</p>");
    answer.nodes = [0, 9, 0, 0, 0];
    expect(
      await parseAstroSource(
        answering(200, JSON.stringify(answer)),
        "<p>a</p>",
        {
          mode: "outline",
        },
      ),
    ).toMatchObject({ status: "unavailable", code: "invalid-response" });
  });

  it("takes a well-formed answer about the source sent", async () => {
    const answer = await outlineOf("<p>a</p>");
    const binding = answering(200, JSON.stringify(answer));
    const id = crypto.randomUUID();
    expect(
      await parseAstroSource(
        binding,
        "<p>a</p>",
        { mode: "outline" },
        {
          requestId: id,
        },
      ),
    ).toEqual({ status: "parsed", result: answer });
    const [url, init] = vi.mocked(binding.fetch).mock.calls[0];
    expect(url).toBe("https://astro-parser/parse/v1?mode=outline");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "x-morph-request-id": id },
    });
  });

  it.each([
    ["an answer", 200, { v: 1, ok: true }],
    [
      "a refusal",
      503,
      { v: 1, ok: false, error: { code: "parser-busy", detail: "" } },
    ],
  ])(
    "tells %s from another contract version apart",
    async (_, status, body) => {
      expect(
        await parseAstroSource(answering(status, JSON.stringify(body)), "<p/>", {
          mode: "outline",
        }),
      ).toEqual({
        status: "unavailable",
        code: "contract-mismatch",
        detail: "contract-version",
      });
    },
  );
});

/** A correct template answer for `<p>{a}</p>`, from `compiler`. */
async function templateOf(
  source: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    v: 2,
    ok: true,
    mode: "template",
    compiler: MORPH_ASTRO_COMPILER_RS_VERSION,
    source: {
      sha256: await sha256Hex(source),
      bytes: new TextEncoder().encode(source).byteLength,
      length: source.length,
    },
    frontmatter: null,
    frontmatterInner: null,
    tags: ["p"],
    elements: [[0, source.length, 0, -1]],
    attributes: [],
    expressions: [[3, 6, 4, 5, 0, -1, []]],
    elementCount: 1,
    maxDepth: 0,
    diagnostics: { total: 0, first: [] },
    ...overrides,
  };
}

const P = "<p>{a}</p>";

describe("parseAstroTemplate", () => {
  it("takes a template answer from the pinned compiler without diagnostics", async () => {
    const answer = await templateOf(P);
    const binding = answering(200, JSON.stringify(answer));
    expect(await parseAstroTemplate(binding, P)).toEqual({
      status: "confirmed",
      result: answer,
    });
    expect(vi.mocked(binding.fetch).mock.calls[0][0]).toBe(
      "https://astro-parser/parse/v1?mode=template",
    );
  });

  it("refuses an answer from another compiler, before reading its diagnostics", async () => {
    const answer = await templateOf(P, {
      compiler: "0.5.2",
      diagnostics: { total: 1, first: [] },
    });
    expect(
      await parseAstroTemplate(answering(200, JSON.stringify(answer)), P),
    ).toEqual({
      status: "refused",
      class: "temporarily-unconfirmable",
      reason: "parser-version-mismatch",
      code: "version-mismatch",
      detail: `compiler 0.5.2; Morph is pinned to ${MORPH_ASTRO_COMPILER_RS_VERSION}`,
    });
  });

  it("refuses a source with diagnostics as the author's syntax, with them", async () => {
    const diagnostics = {
      total: 1,
      first: [
        { severity: "error", text: "Unexpected token", byteStart: 4, byteEnd: 5 },
      ],
    };
    const answer = await templateOf(P, { diagnostics });
    expect(
      await parseAstroTemplate(answering(200, JSON.stringify(answer)), P),
    ).toEqual({
      status: "refused",
      class: "author-syntax",
      reason: "author-syntax",
      code: "author-syntax",
      detail: "1 diagnostic(s)",
      diagnostics,
    });
  });

  it("refuses a source over the size limit as a capability limit, unsent", async () => {
    const binding = answering(200, "{}");
    const source = "a".repeat(ASTRO_PARSER_LIMITS.maxSourceBytes + 1);
    expect(await parseAstroTemplate(binding, source)).toMatchObject({
      status: "refused",
      class: "capability-limit",
      reason: "source-too-large",
    });
    expect(binding.fetch).not.toHaveBeenCalled();
  });

  it("refuses an answer over the result limit as a capability limit", async () => {
    const body = JSON.stringify({
      v: 2,
      ok: false,
      error: { code: "result-too-large", detail: "result over 262144 bytes" },
    });
    expect(await parseAstroTemplate(answering(422, body), P)).toMatchObject({
      status: "refused",
      class: "capability-limit",
      reason: "result-too-large",
      code: "result-too-large",
    });
  });

  it.each([
    ["an element past the end", { elements: [[0, P.length + 1, 0, -1]] }],
    ["a negative position", { elements: [[-1, P.length, 0, -1]] }],
    ["an expression outside its owner", { expressions: [[0, 3, 1, 2, 1, -1, []]] }],
    ["an unknown attribute kind", {
      attributes: [[0, "shorthand", "a", 4, 5, 3, 6]],
    }],
    ["no compiler", { compiler: undefined }],
    ["an outline under the template's name", {
      mode: "outline",
      nodes: [0, P.length, 0, 0, 0],
    }],
  ])("refuses %s as an invalid response", async (_, overrides) => {
    const answer = await templateOf(P, overrides);
    expect(
      await parseAstroTemplate(answering(200, JSON.stringify(answer)), P),
    ).toMatchObject({
      status: "refused",
      class: "temporarily-unconfirmable",
      reason: "parser-invalid-response",
      code: "invalid-response",
    });
  });

  // The checks hold ranges to the source's UTF-16 length, so an answer in
  // bytes is caught when it runs past the end, as here. They cannot tell a
  // consistent answer in code points from one in UTF-16 units: that the
  // Worker answers in UTF-16 units is pinned on the real compiler in
  // packages/astro-parser-worker/src/template.test.ts.
  it("takes UTF-16 ranges past an astral character and refuses bytes past the end", async () => {
    // "😀" is two UTF-16 units and four UTF-8 bytes.
    const source = "😀<p>{a}</p>";
    const start = source.indexOf("<p>");
    expect(start).toBe(2);
    const units = await templateOf(source, {
      elements: [[start, source.length, 0, -1]],
      expressions: [[start + 3, start + 6, start + 4, start + 5, 0, -1, []]],
    });
    expect(
      await parseAstroTemplate(answering(200, JSON.stringify(units)), source),
    ).toMatchObject({ status: "confirmed" });
    // In bytes everything sits two further on, and the element runs past the
    // end of the source.
    const bytes = await templateOf(source, {
      elements: [[start + 2, source.length + 2, 0, -1]],
      expressions: [[start + 5, start + 8, start + 6, start + 7, 0, -1, []]],
    });
    expect(
      await parseAstroTemplate(answering(200, JSON.stringify(bytes)), source),
    ).toMatchObject({ code: "invalid-response", detail: "element-range-0" });
  });

  it("refuses an answer from another contract version", async () => {
    const answer = await templateOf(P, { v: 1 });
    expect(
      await parseAstroTemplate(answering(200, JSON.stringify(answer)), P),
    ).toMatchObject({
      class: "temporarily-unconfirmable",
      reason: "parser-contract-mismatch",
      code: "contract-mismatch",
    });
  });

  it("is temporarily unconfirmable without a binding", async () => {
    expect(await parseAstroTemplate(null, P)).toMatchObject({
      status: "refused",
      class: "temporarily-unconfirmable",
      reason: "parser-binding-missing",
    });
  });
});

describe("classifyAstroParserRefusal", () => {
  it.each<[AstroTemplateRefusalCode, string, string]>([
    ["binding-missing", "temporarily-unconfirmable", "parser-binding-missing"],
    ["binding-failed", "temporarily-unconfirmable", "parser-binding-failed"],
    ["invalid-response", "temporarily-unconfirmable", "parser-invalid-response"],
    ["contract-mismatch", "temporarily-unconfirmable", "parser-contract-mismatch"],
    ["version-mismatch", "temporarily-unconfirmable", "parser-version-mismatch"],
    ["parser-busy", "temporarily-unconfirmable", "parser-busy"],
    ["parser-wait-timeout", "temporarily-unconfirmable", "parser-wait-timeout"],
    ["parser-trapped", "temporarily-unconfirmable", "parser-trapped"],
    ["parser-unavailable", "temporarily-unconfirmable", "parser-unavailable"],
    ["internal", "temporarily-unconfirmable", "parser-fault"],
    ["invalid-request", "temporarily-unconfirmable", "parser-fault"],
    ["not-found", "temporarily-unconfirmable", "parser-fault"],
    ["source-not-utf8", "temporarily-unconfirmable", "parser-fault"],
    ["source-read-timeout", "temporarily-unconfirmable", "parser-fault"],
    ["source-too-large", "capability-limit", "source-too-large"],
    ["result-too-large", "capability-limit", "result-too-large"],
    ["author-syntax", "author-syntax", "author-syntax"],
  ])("puts %s in %s as %s", (code, failureClass, reason) => {
    expect(classifyAstroParserRefusal(code)).toEqual({
      class: failureClass,
      reason,
    });
  });

  it("covers every code the Worker can send", () => {
    for (const code of Object.keys(ASTRO_PARSER_ERROR_STATUS))
      expect(
        classifyAstroParserRefusal(code as AstroTemplateRefusalCode).class,
      ).toBeDefined();
  });
});

describe("parseAstroSource through the local service binding", () => {
  let parser: LocalAstroParser;
  beforeAll(async () => {
    parser = await startLocalAstroParser();
  }, 60_000);
  afterAll(() => parser?.dispose());

  it("parses a real .astro page and answers a position on it", async () => {
    const source = readFileSync(FIXTURE, "utf8");
    const outline = await parseAstroSource(parser.binding, source, {
      mode: "outline",
    });
    expect(outline.status).toBe("parsed");
    if (outline.status !== "parsed" || outline.result.mode !== "outline")
      throw new Error("expected an outline");
    expect(outline.result.tags).toEqual(
      expect.arrayContaining(["html", "BaseHead", "Header", "Footer"]),
    );

    const offset = source.indexOf("<Header");
    const at = await parseAstroSource(parser.binding, source, {
      mode: "at",
      offset: offset + 1,
    });
    if (at.status !== "parsed" || at.result.mode !== "at")
      throw new Error("expected a position");
    expect(at.result.path.at(-1)).toEqual([
      "Header",
      offset,
      expect.any(Number),
    ]);
  });

  it("reports the parser's refusal as a code", async () => {
    expect(
      await parseAstroSource(parser.binding, "<i/>".repeat(25_250), {
        mode: "outline",
      }),
    ).toMatchObject({ status: "unavailable", code: "result-too-large" });
  });

  it("confirms a real page's template from the pinned compiler", async () => {
    const source = readFileSync(FIXTURE, "utf8");
    const outcome = await parseAstroTemplate(parser.binding, source);
    if (outcome.status !== "confirmed")
      throw new Error(`refused: ${JSON.stringify(outcome)}`);
    expect(outcome.result.compiler).toBe(MORPH_ASTRO_COMPILER_RS_VERSION);
    const header = outcome.result.elements.find(
      ([, , tag]) => outcome.result.tags[tag] === "Header",
    );
    expect(header?.[0]).toBe(source.indexOf("<Header"));
  });

  it("refuses a real compiler's diagnostics as the author's syntax", async () => {
    expect(
      await parseAstroTemplate(parser.binding, "<p>{a + }</p>"),
    ).toMatchObject({
      status: "refused",
      class: "author-syntax",
      reason: "author-syntax",
      diagnostics: { total: 1 },
    });
  });

  it("refuses a real template over the result cap as a capability limit", async () => {
    expect(
      await parseAstroTemplate(parser.binding, "<i/>".repeat(25_250)),
    ).toMatchObject({
      status: "refused",
      class: "capability-limit",
      reason: "result-too-large",
    });
  });

  it("is unavailable once nothing runs behind the binding", async () => {
    const { binding } = parser;
    await parser.dispose();
    expect(
      await parseAstroSource(binding, "<p/>", { mode: "outline" }),
    ).toMatchObject({ status: "unavailable", code: "binding-failed" });
  });
});

describe("the parser's service binding in the configuration", () => {
  const core = experimental_readRawConfig({
    config: "wrangler.jsonc",
  }).rawConfig;
  const parserConfig = experimental_readRawConfig({
    config: join(PACKAGE_DIR, "wrangler.jsonc"),
  }).rawConfig;

  it("exists for the editor end-to-end environment", () => {
    expect(core.env?.local_preview_e2e?.services).toContainEqual({
      binding: ASTRO_PARSER_BINDING,
      service: ASTRO_PARSER_WORKER_NAME,
    });
  });

  it("does not exist at the top level, which is also what production deploys", () => {
    const services = core.services ?? [];
    expect(
      services.filter(
        (service: { binding?: string; service?: string }) =>
          service.binding === ASTRO_PARSER_BINDING ||
          service.service === ASTRO_PARSER_WORKER_NAME,
      ),
    ).toEqual([]);
  });

  it("targets a Worker that is reachable only through the binding", () => {
    expect(parserConfig.name).toBe(ASTRO_PARSER_WORKER_NAME);
    expect(parserConfig.workers_dev).toBe(false);
    expect(parserConfig.preview_urls).toBe(false);
    expect(parserConfig.route).toBeUndefined();
    expect(parserConfig.routes).toBeUndefined();
    expect(parserConfig.env).toBeUndefined();
    for (const key of [
      "vars",
      "services",
      "d1_databases",
      "r2_buckets",
      "kv_namespaces",
      "queues",
      "durable_objects",
      "containers",
      "assets",
      "workflows",
      "dispatch_namespaces",
      "ai",
      "browser",
      "hyperdrive",
      "vectorize",
      "analytics_engine_datasets",
      "send_email",
      "secrets_store_secrets",
    ] as const) {
      expect(parserConfig[key], key).toBeUndefined();
    }
  });

  it("runs on Core's compatibility date and flags", () => {
    expect(parserConfig.compatibility_date).toBe(core.compatibility_date);
    expect(parserConfig.compatibility_flags).toEqual(core.compatibility_flags);
  });
});
