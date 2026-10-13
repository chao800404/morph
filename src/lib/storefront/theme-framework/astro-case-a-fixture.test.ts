// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseColocatedContentFields } from "../ast/theme-content-fields-source";
import { materializeThemeBuildInput } from "../compiler/theme-build-materializer";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../starter-theme-v3-files";
import {
  CASE_A_FIXTURE_ROOT,
  CASE_A_STAND_IN,
  caseAFixtureFiles,
  moduleSpecifiers,
  pureAstroViolations,
  walkFiles,
} from "./astro-case-a-fixture.test-support";
import { planNativeAstroBuild } from "./astro-native-build";
import { planAstroPreviewWorkspace } from "./astro-preview-workspace";
import { themeToolchainForFramework } from "./theme-toolchains";

/**
 * The pure Astro Theme for case A (fixtures/morph/astro-case-a), read from
 * disk as committed: that it is pure Astro, that the existing gates take it
 * unchanged, and what its stand-in reader does. The real preview and build
 * are local-vite-preview-server.astro-case-a.test.ts and
 * native-astro-case-a.build.test.ts.
 */

/** The fixture as a stored source revision, through the build materializer. */
function materialize(files: readonly { path: string; content: string }[]) {
  return materializeThemeBuildInput({
    build: {
      id: "case-a",
      storefrontId: "store",
      themeId: "theme",
      sourceRevisionId: "rev",
      status: "queued",
      inputHash: null,
      compilerId: null,
      compilerVersion: null,
      contentPublicationId: null,
      framework: "astro",
      inputHashFormat: 2,
      toolchainId: themeToolchainForFramework("astro").id,
    } as StorefrontThemeBuildDTO,
    revision: {
      id: "rev",
      storefrontId: "store",
      themeId: "theme",
      revisionNumber: 1,
      snapshot: files.map((file) => ({ path: file.path, content: file.content })),
    } as unknown as StorefrontThemeRevisionDTO,
    astroThemes: true,
  });
}

/** A module's error codes and their words, read from its source text. */
function errorVocabulary(source: string) {
  const union = /export type MorphContentErrorCode =([\s\S]*?);/.exec(source)?.[1] ?? "";
  const codes = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  const table =
    /const MORPH_CONTENT_MESSAGES: Record<MorphContentErrorCode, string> = \{([\s\S]*?)\n\};/.exec(
      source,
    )?.[1] ?? "";
  const messages = Object.fromEntries(
    [...table.matchAll(/([a-z_]+):\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  return { codes, messages };
}

const files = caseAFixtureFiles();
const file = (path: string) => files.find((entry) => entry.path === path)!.content;

describe("the case A fixture is a pure Astro Theme", () => {
  it("is the files a later case A test expects", () => {
    expect(files.map((entry) => entry.path)).toEqual([
      "astro.config.mjs",
      "package.json",
      "src/components/Hero.astro",
      "src/components/Hero.fields.ts",
      "src/middleware.ts",
      "src/morph/content.ts",
      "src/pages/about.astro",
      "src/pages/index.astro",
      "wrangler.jsonc",
    ]);
    // Case A's shape, verbatim (content-binding-contract-design.md §6).
    expect(file("src/pages/index.astro")).toContain(
      'const home = await morph.pages.get("/");\nconst { hero } = home;',
    );
    expect(file("src/pages/index.astro")).toContain("<Hero {...hero} />");
  });

  it("imports nothing but its own files, Node built-ins, Astro and the Cloudflare adapter", () => {
    expect(pureAstroViolations(files)).toEqual([]);
    expect(file("astro.config.mjs")).not.toMatch(/\bintegrations\s*:/);
  });

  it("is told apart from a project that is not pure Astro", () => {
    const withFile = (path: string, content: string) => [
      ...files.filter((entry) => entry.path !== path),
      { path, content },
    ];
    expect(
      pureAstroViolations(withFile("src/components/Island.tsx", "export default () => null;\n")),
    ).toEqual(["src/components/Island.tsx: not an Astro, TypeScript, module or JSON file"]);
    // React is in the Astro toolchain, so the import guards would let it
    // through; pure Astro does not.
    expect(
      pureAstroViolations(
        withFile(
          "src/components/Hero.astro",
          `---\nimport { useState } from "react";\n---\n<h1 />\n`,
        ),
      ),
    ).toEqual(['src/components/Hero.astro: imports "react" from package "react"']);
    expect(
      pureAstroViolations(
        withFile(CASE_A_STAND_IN, 'export { getRequest } from "@tanstack/react-start/server";\n'),
      ),
    ).toContain(
      `${CASE_A_STAND_IN}: imports "@tanstack/react-start/server" from package "@tanstack/react-start"`,
    );
    expect(
      pureAstroViolations(withFile("src/middleware.ts", 'const clsx = await import("clsx");\n')),
    ).toEqual(['src/middleware.ts: imports "clsx" from package "clsx"']);
    expect(
      pureAstroViolations(
        withFile("src/middleware.ts", 'export { onRequest } from "../../outside";\n'),
      ),
    ).toEqual(['src/middleware.ts: "../../outside" is not a file of this Theme']);
    expect(
      pureAstroViolations(
        withFile(
          "package.json",
          '{ "dependencies": { "astro": "7.3.5", "@astrojs/react": "7.0.0" } }\n',
        ),
      ),
    ).toEqual(['package.json: depends on "@astrojs/react"']);
  });

  it("passes the build materializer, the native build plan and the Live Preview plan unchanged", () => {
    const input = materialize(files);
    expect(input.framework).toBe("astro");
    expect(input.files.map((entry) => entry.path).sort()).toEqual(
      files.map((entry) => entry.path).sort(),
    );
    const build = planNativeAstroBuild(files);
    expect(build.ok, build.ok ? "" : build.message).toBe(true);
    const preview = planAstroPreviewWorkspace({
      files,
      entry: "",
      buildId: "case-a",
      approvedDependencies: new Set(),
      mode: "preview-server",
    });
    expect(preview.ok, preview.ok ? "" : preview.errorMessage).toBe(true);
    // The one warning: the preview runs its own adapter call. The build needs
    // imageService "passthrough" (no Images binding), so the config keeps it.
    if (preview.ok) {
      expect(preview.previewWarnings).toEqual([
        {
          path: "astro.config.mjs",
          message: expect.stringMatching(/so imageService from this config do not apply/),
        },
      ]);
    }
  });

  it("declares Hero's fields in a sidecar the field parser reads", () => {
    expect(parseColocatedContentFields(file("src/components/Hero.fields.ts"))).toMatchObject({
      declaration: "valid",
      fields: { title: { type: "text" }, subtitle: { type: "text" } },
    });
  });
});

describe("the fixture's stand-in reader, as source", () => {
  it("is marked as a test stand-in, and no product or test module imports it", () => {
    expect(file(CASE_A_STAND_IN).split("\n")[0]).toBe(
      "// TEST FIXTURE STAND-IN. Not product code, not Starter code, not the Astro",
    );
    // Tests reach the fixture only by reading it from disk.
    const importers = walkFiles(join(process.cwd(), "src")).filter(
      (full) =>
        /\.(ts|tsx)$/.test(full) &&
        moduleSpecifiers(readFileSync(full, "utf8")).some((specifier) =>
          specifier.includes("fixtures/morph"),
        ),
    );
    expect(importers).toEqual([]);
  });

  it("has the Start Starter's error codes, in order, with the same words", () => {
    const start = errorVocabulary(STARTER_THEME_CONTENT_MODULE_SOURCE);
    const standIn = errorVocabulary(file(CASE_A_STAND_IN));
    expect(start.codes).toHaveLength(10);
    expect(Object.keys(start.messages)).toEqual(start.codes);
    expect(standIn).toEqual(start);
    // The comparison sees a drift in either the words or the set.
    expect(
      errorVocabulary(
        file(CASE_A_STAND_IN).replace('"The store has no content for this page."', '"Nothing."'),
      ),
    ).not.toEqual(start);
    expect(
      errorVocabulary(file(CASE_A_STAND_IN).replace('  | "reserved_slot";', ";")).codes,
    ).not.toEqual(start.codes);
  });
});

type StandIn = {
  morph: {
    pages: {
      get(path: string): Promise<Record<string, unknown> & { _hidden: string[] }>;
      isHidden(page: { _hidden: readonly string[] }, slotId: string): boolean;
    };
  };
  onRequest(context: { request: Request }, next: () => Promise<Response>): Promise<Response>;
  MorphContentError: new (...args: never[]) => Error & { code: string };
};

const ORIGIN = "https://store.example";

describe("the fixture's stand-in reader, run as Astro runs it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Loaded by URL, as a file of the fixture: no static import reaches it.
  const load = async () =>
    (await import(
      /* @vite-ignore */ pathToFileURL(join(CASE_A_FIXTURE_ROOT, CASE_A_STAND_IN)).href
    )) as StandIn;

  /** One request through the middleware; the page reads `path`. */
  async function render(
    standIn: StandIn,
    headers: Record<string, string>,
    path = "/",
  ): Promise<unknown> {
    let read: unknown;
    await standIn.onRequest(
      { request: new Request("http://theme.internal/", { headers }) },
      async () => {
        // A turn of the event loop first, as a render awaits other work.
        await new Promise((resolve) => setTimeout(resolve, 1));
        read = await standIn.morph.pages.get(path).catch((error: unknown) => error);
        return new Response("ok");
      },
    );
    return read;
  }

  const answer = (body: unknown, init: ResponseInit = {}) =>
    vi.fn(async (_url: string, _init?: RequestInit) =>
      typeof body === "string" ? new Response(body, init) : Response.json(body, init),
    );

  it("reads the page from the origin the platform forwarded, in Start's page shape", async () => {
    const fetch = answer({ slots: { hero: { title: "T" } }, hiddenSlots: ["promo"] });
    vi.stubGlobal("fetch", fetch);
    const standIn = await load();
    const page = await render(standIn, { "x-morph-content-origin": `${ORIGIN}/ignored/path` });
    expect(page).toEqual({ hero: { title: "T" }, _hidden: ["promo"] });
    expect(standIn.morph.pages.isHidden(page as never, "promo")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}/_morph/content?path=%2F`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "omit" });
  });

  it("names each failure with Start's code and never answers with an empty page", async () => {
    const standIn = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = async (headers: Record<string, string>, path = "/") => {
      const read = await render(standIn, headers, path);
      expect(read).toBeInstanceOf(standIn.MorphContentError);
      return (read as { code: string }).code;
    };
    const forwarded = { "x-morph-content-origin": ORIGIN };

    vi.stubGlobal("fetch", answer({ slots: {}, hiddenSlots: [] }));
    expect(await code({})).toBe("no_content_source");
    expect(await code({ "x-morph-content-origin": "not an address" })).toBe(
      "invalid_content_origin",
    );
    expect(await code({ "x-morph-content-origin": "ftp://store.example" })).toBe(
      "invalid_content_origin",
    );
    expect(await code(forwarded, "home")).toBe("invalid_path");
    expect(await code(forwarded, `/${"a".repeat(500)}`)).toBe("invalid_path");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    expect(await code(forwarded)).toBe("store_unreachable");
    vi.stubGlobal("fetch", answer("Not Found", { status: 404 }));
    expect(await code(forwarded)).toBe("content_not_found");
    vi.stubGlobal("fetch", answer("Bad", { status: 500 }));
    expect(await code(forwarded)).toBe("store_error");
    vi.stubGlobal("fetch", answer({ code: "response_too_large" }, { status: 502 }));
    expect(await code(forwarded)).toBe("response_too_large");
    vi.stubGlobal("fetch", answer("<html>"));
    expect(await code(forwarded)).toBe("invalid_response");
    vi.stubGlobal("fetch", answer({ slots: {} }));
    expect(await code(forwarded)).toBe("invalid_response");
    vi.stubGlobal("fetch", answer({ slots: { _hidden: {} }, hiddenSlots: [] }));
    expect(await code(forwarded)).toBe("reserved_slot");
    warn.mockRestore();
  });

  it("refuses a read outside a request, and each request reads its own origin", async () => {
    const fetch = answer({ slots: {}, hiddenSlots: [] });
    vi.stubGlobal("fetch", fetch);
    const standIn = await load();
    await render(standIn, { "x-morph-content-origin": ORIGIN });
    // After that request ended, nothing of it is left to read with.
    const outside = await standIn.morph.pages.get("/").catch((error: unknown) => error);
    expect(outside).toBeInstanceOf(standIn.MorphContentError);
    expect(outside).toMatchObject({ code: "no_content_source" });
    expect((outside as Error).message).toContain("src/middleware.ts");
    // Two requests at once, interleaved, each with its own origin.
    await Promise.all([
      render(standIn, { "x-morph-content-origin": "https://a.example" }),
      render(standIn, { "x-morph-content-origin": "https://b.example" }, "/about"),
    ]);
    expect(fetch.mock.calls.map((call) => call[0]).sort()).toEqual([
      "https://a.example/_morph/content?path=%2F",
      "https://b.example/_morph/content?path=%2Fabout",
      `${ORIGIN}/_morph/content?path=%2F`,
    ]);
  });
});
