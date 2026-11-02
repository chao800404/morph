// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { experimental_readRawConfig } from "wrangler";

import {
  ASTRO_PARSER_LIMITS,
  ASTRO_PARSER_WORKER_NAME,
} from "@morph/astro-parser-worker/contract";
import {
  PACKAGE_DIR,
  startLocalAstroParser,
  type LocalAstroParser,
} from "@morph/astro-parser-worker/testing";

import {
  ASTRO_PARSER_BINDING,
  astroParserBindingFrom,
  parseAstroSource,
  type AstroParserBinding,
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
    v: 1,
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
      v: 1,
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
    ["another contract version", 200, JSON.stringify({ v: 2, ok: true })],
    [
      "an unknown error code",
      500,
      JSON.stringify({ v: 1, ok: false, error: { code: "oops", detail: "" } }),
    ],
    [
      "a refusal under the wrong status",
      200,
      JSON.stringify({
        v: 1,
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
