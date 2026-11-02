// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  ASTRO_PARSER_BINDING_CHECK_PATH,
  serveAstroParserBindingCheck,
} from "./astro-parser-binding-check";

const at = (path: string, method = "GET") =>
  new Request(`http://127.0.0.1:3418${path}`, { method });

const binding = () => ({ fetch: vi.fn(async () => new Response("{}")) });

describe("the parser binding check is fenced", () => {
  it("leaves every other path alone", async () => {
    expect(
      await serveAstroParserBindingCheck(at("/_morph/e2e/other"), {
        ASTRO_PARSER: binding(),
      }),
    ).toBeNull();
  });

  it("is not there without the parser binding, as in plain dev", async () => {
    const response = await serveAstroParserBindingCheck(
      at(ASTRO_PARSER_BINDING_CHECK_PATH),
      {},
    );
    expect(response?.status).toBe(404);
  });

  it("is not there in a production environment, binding or not", async () => {
    const parser = binding();
    const response = await serveAstroParserBindingCheck(
      at(ASTRO_PARSER_BINDING_CHECK_PATH),
      { ASTRO_PARSER: parser, ENVIRONMENT: "production" },
    );
    expect(response?.status).toBe(404);
    expect(parser.fetch).not.toHaveBeenCalled();
  });

  it("takes GET only", async () => {
    const parser = binding();
    const response = await serveAstroParserBindingCheck(
      at(ASTRO_PARSER_BINDING_CHECK_PATH, "POST"),
      { ASTRO_PARSER: parser },
    );
    expect(response?.status).toBe(405);
    expect(parser.fetch).not.toHaveBeenCalled();
  });

  it("is reached from the Worker entry only in a dev build", () => {
    const entry = readFileSync("src/server.ts", "utf8");
    const devBlock = entry.slice(
      entry.indexOf("if (import.meta.env.DEV) {"),
      entry.indexOf("const url = new URL(request.url);"),
    );
    expect(devBlock).toContain("@/server/dev/astro-parser-binding-check");
    expect(
      entry.replace(devBlock, "").includes("astro-parser-binding-check"),
    ).toBe(false);
  });
});
