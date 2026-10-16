// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "../starter-theme-v3-files";
import {
  CASE_A_FIXTURE_ROOT,
  CONTENT_READ_CORE_FILE,
  CONTENT_WORKSPACE_PATH,
  CORE_WORKSPACE_PATH,
  PLATFORM_WIRING,
  START_FIXTURE_ROOT,
  astroWorkspaceFiles,
  caseAFixtureFiles,
  moduleSpecifiers,
  pureAstroViolations,
  pureStartViolations,
  readCoreSource,
  sha256,
  startFixtureFiles,
  startWorkspaceFiles,
  walkFiles,
  type FixtureFile,
} from "./content-read-fixtures.test-support";

/**
 * The content read core prototype (fixtures/morph/content-read-core/core.ts,
 * docs/content-read-core-design.md) and the two Themes that read through it.
 *
 * VALIDATION LEVELS, kept apart:
 * - "core prototype": the core run directly in Node. Proves the shared design
 *   is possible. Not a framework, not a wiring.
 * - "Astro wiring in Node": the Astro wiring's real modules (the
 *   AsyncLocalStorage middleware) in Node. Not workerd, not `astro dev`.
 * - The real framework runs are local-vite-preview-server.content-read-parity
 *   .test.ts (astro dev, Start dev) and native-astro-case-a.build.test.ts
 *   (astro build).
 * None of them is production Cloudflare, preview revocation or Design.
 */

const workspaces = () => ({ astro: astroWorkspaceFiles(), start: startWorkspaceFiles() });
const fileIn = (files: readonly FixtureFile[], path: string) =>
  files.find((entry) => entry.path === path)?.content;

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

/** What only the core may contain: the reading itself. */
const READ_LOGIC = /MORPH_CONTENT_MESSAGES|class MorphContentError|\bfetch\s*\(|_morph\/content/;

describe("one core, shared by both Themes (structure)", () => {
  it("is one file, marked TEST PROTOTYPE, importing nothing", () => {
    const core = readCoreSource();
    expect(core.split("\n")[0]).toBe(
      "// TEST PROTOTYPE. Not product code, not Starter code, not the Morph SDK.",
    );
    // No React, Astro, Start or node: module: framework-agnostic.
    expect(moduleSpecifiers(core)).toEqual([]);
  });

  it("is carried by neither Theme: each reads through it as the platform installs it", () => {
    for (const [root, files] of [
      [CASE_A_FIXTURE_ROOT, caseAFixtureFiles()],
      [START_FIXTURE_ROOT, startFixtureFiles()],
    ] as const) {
      const paths = files.map((entry) => entry.path);
      expect(paths, root).not.toContain(CORE_WORKSPACE_PATH);
      expect(paths, root).not.toContain(CONTENT_WORKSPACE_PATH);
      // The author writes no middleware and no wiring.
      expect(paths, root).not.toContain("src/middleware.ts");
      expect(
        files.filter((entry) => READ_LOGIC.test(entry.content)).map((entry) => entry.path),
        root,
      ).toEqual([]);
    }
  });

  it("is the same bytes in both workspaces, and each wiring resolves its import to it", () => {
    const expected = sha256(readFileSync(CONTENT_READ_CORE_FILE));
    for (const [framework, files] of Object.entries(workspaces())) {
      expect(sha256(fileIn(files, CORE_WORKSPACE_PATH) ?? ""), framework).toBe(expected);
      // Exactly one file of the workspace holds the read logic: the core.
      expect(
        files.filter((entry) => READ_LOGIC.test(entry.content)).map((entry) => entry.path),
        framework,
      ).toEqual([CORE_WORKSPACE_PATH]);
      // The module pages import `morph` from takes it from the core.
      const content = fileIn(files, CONTENT_WORKSPACE_PATH)!;
      const core = moduleSpecifiers(content)
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) => posix.join(posix.dirname(CONTENT_WORKSPACE_PATH), `${specifier}.ts`))
        .filter((target) => target === CORE_WORKSPACE_PATH);
      expect(core.length, framework).toBeGreaterThan(0);
    }
  });

  it("is told apart from a Theme carrying its own copy", () => {
    // The reverse of the case above: a Theme with a reader of its own.
    const copy = { path: "src/lib/reader.ts", content: readCoreSource() };
    const files = [...startWorkspaceFiles(), copy];
    expect(
      files.filter((entry) => READ_LOGIC.test(entry.content)).map((entry) => entry.path),
    ).toEqual([CORE_WORKSPACE_PATH, copy.path]);
  });

  it("leaves each workspace pure: Astro only, or Start and React only", () => {
    const { astro, start } = workspaces();
    expect(pureAstroViolations(astro)).toEqual([]);
    expect(pureStartViolations(start)).toEqual([]);
    // The reverse: each rule sees the other framework.
    expect(pureStartViolations(astro)).toContain(
      `src/morph/request-context.ts: imports "node:async_hooks" from package "node:async_hooks"`,
    );
    expect(pureAstroViolations(start)).toContain(
      `${CONTENT_WORKSPACE_PATH}: imports "@tanstack/react-start" from package "@tanstack/react-start"`,
    );
  });

  it("has the Start Starter's error codes, in order, with the same words", () => {
    const start = errorVocabulary(STARTER_THEME_CONTENT_MODULE_SOURCE);
    const core = errorVocabulary(readCoreSource());
    expect(start.codes).toHaveLength(10);
    expect(Object.keys(start.messages)).toEqual(start.codes);
    expect(core).toEqual(start);
    // The comparison sees a drift in either the words or the set.
    expect(
      errorVocabulary(
        readCoreSource().replace('"The store has no content for this page."', '"Nothing."'),
      ),
    ).not.toEqual(start);
    expect(
      errorVocabulary(readCoreSource().replace('  | "reserved_slot";', ";")).codes,
    ).not.toEqual(start.codes);
  });

  it("is reached by no product or test module except by reading it from disk", () => {
    const importers = walkFiles(join(process.cwd(), "src")).filter(
      (full) =>
        /\.(ts|tsx)$/.test(full) &&
        moduleSpecifiers(readFileSync(full, "utf8")).some((specifier) =>
          specifier.includes("fixtures/morph"),
        ),
    );
    expect(importers).toEqual([]);
  });
});

type Core = {
  createMorph(source: () => unknown): {
    pages: {
      get(path: string): Promise<Record<string, unknown> & { _hidden: string[] }>;
      isHidden(page: { _hidden: readonly string[] }, slotId: string): boolean;
    };
  };
  MorphContentError: new (...args: never[]) => Error & { code: string };
};

const ORIGIN = "https://store.example";

const answer = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    typeof body === "string" ? new Response(body, init) : Response.json(body, init),
  );

// Loaded by URL, as the file it is: no static import reaches it.
const loadCore = async () =>
  (await import(/* @vite-ignore */ pathToFileURL(CONTENT_READ_CORE_FILE).href)) as Core;

describe("core prototype, run directly (proves the shared design is possible)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const forwarded = (origin: string | null = ORIGIN) => () => ({ kind: "forwarded", origin });

  it("read succeeds: the page from the forwarded origin, in Start's page shape", async () => {
    const fetch = answer({ slots: { hero: { title: "T" } }, hiddenSlots: [] });
    vi.stubGlobal("fetch", fetch);
    const { createMorph } = await loadCore();
    const page = await createMorph(forwarded(`${ORIGIN}/ignored/path`)).pages.get("/");
    expect(page).toEqual({ hero: { title: "T" }, _hidden: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}/_morph/content?path=%2F`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "omit" });
    // In a browser, the page's own origin.
    await createMorph(() => ({ kind: "same-origin" })).pages.get("/about");
    expect(fetch.mock.calls[1]![0]).toBe("/_morph/content?path=%2Fabout");
  });

  it("hidden section: no values for it, and it is listed as hidden", async () => {
    vi.stubGlobal("fetch", answer({ slots: { intro: { text: "I" } }, hiddenSlots: ["hero"] }));
    const { createMorph } = await loadCore();
    const morph = createMorph(forwarded());
    const page = await morph.pages.get("/");
    expect(page).toEqual({ intro: { text: "I" }, _hidden: ["hero"] });
    expect(page.hero).toBeUndefined();
    expect(morph.pages.isHidden(page, "hero")).toBe(true);
    expect(morph.pages.isHidden(page, "intro")).toBe(false);
  });

  it("API refusal and bad answers: each shared code, never an empty page", async () => {
    const { createMorph, MorphContentError } = await loadCore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const code = async (source: () => unknown, path = "/") => {
      const read = await createMorph(source)
        .pages.get(path)
        .catch((error: unknown) => error);
      expect(read).toBeInstanceOf(MorphContentError);
      return (read as { code: string }).code;
    };

    vi.stubGlobal("fetch", answer({ slots: {}, hiddenSlots: [] }));
    expect(await code(() => undefined)).toBe("no_content_source");
    expect(await code(forwarded(null))).toBe("no_content_source");
    expect(await code(forwarded("not an address"))).toBe("invalid_content_origin");
    expect(await code(forwarded("ftp://store.example"))).toBe("invalid_content_origin");
    // A present but unusable header is not replaced by the local fallback.
    expect(
      await code(() => ({ kind: "forwarded", origin: "nope", localOrigin: ORIGIN })),
    ).toBe("invalid_content_origin");
    expect(await code(forwarded(), "home")).toBe("invalid_path");
    expect(await code(forwarded(), `/${"a".repeat(500)}`)).toBe("invalid_path");

    vi.stubGlobal("fetch", answer("Not Found", { status: 404 }));
    expect(await code(forwarded())).toBe("content_not_found");
    vi.stubGlobal("fetch", answer("Bad", { status: 500 }));
    expect(await code(forwarded())).toBe("store_error");
    vi.stubGlobal("fetch", answer({ code: "redirect_refused" }, { status: 502 }));
    expect(await code(forwarded())).toBe("redirect_refused");
    vi.stubGlobal("fetch", answer({ code: "response_too_large" }, { status: 502 }));
    expect(await code(forwarded())).toBe("response_too_large");
    vi.stubGlobal("fetch", answer("<html>"));
    expect(await code(forwarded())).toBe("invalid_response");
    vi.stubGlobal("fetch", answer({ slots: {} }));
    expect(await code(forwarded())).toBe("invalid_response");
    vi.stubGlobal("fetch", answer({ slots: { _hidden: {} }, hiddenSlots: [] }));
    expect(await code(forwarded())).toBe("reserved_slot");
    warn.mockRestore();
  });

  it("network error: store_unreachable, with no address in the error", async () => {
    const { createMorph, MorphContentError } = await loadCore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("connect ECONNREFUSED"))),
    );
    const read = await createMorph(forwarded())
      .pages.get("/")
      .catch((error: unknown) => error);
    expect(read).toBeInstanceOf(MorphContentError);
    expect(read).toMatchObject({ code: "store_unreachable" });
    expect((read as Error).message).not.toContain("store.example");
    expect((read as Error).message).not.toContain("ECONNREFUSED");
    // The detail is in the server log only.
    expect(warn.mock.calls.flat().join(" ")).toContain("ECONNREFUSED");
    warn.mockRestore();
  });

  it("two concurrent requests with different preview contexts each read their own", async () => {
    // A context per request, as each framework holds one (Astro: the
    // wiring's AsyncLocalStorage; Start: getRequest). Each origin answers
    // its own content.
    const fetch = vi.fn(async (url: string) =>
      Response.json({
        slots: { hero: { title: new URL(url, "http://relative.invalid").host } },
        hiddenSlots: [],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { createMorph } = await loadCore();
    const context = new AsyncLocalStorage<string>();
    const morph = createMorph(() => {
      const origin = context.getStore();
      return origin === undefined ? undefined : { kind: "forwarded", origin };
    });
    const request = (origin: string, delay: number) =>
      context.run(origin, async () => {
        // The reads interleave: each waits while the other starts.
        await new Promise((resolve) => setTimeout(resolve, delay));
        const first = await morph.pages.get("/");
        await new Promise((resolve) => setTimeout(resolve, delay));
        const second = await morph.pages.get("/");
        const title = (page: Record<string, unknown>) => (page.hero as { title: string }).title;
        return [title(first), title(second)];
      });
    const [a, b] = await Promise.all([
      request("https://preview-a.example", 5),
      request("https://preview-b.example", 1),
    ]);
    expect(a).toEqual(["preview-a.example", "preview-a.example"]);
    expect(b).toEqual(["preview-b.example", "preview-b.example"]);
    // Nothing kept between reads: four reads, four fetches.
    expect(fetch).toHaveBeenCalledTimes(4);
    // And outside either request, nothing is left to read with.
    await expect(morph.pages.get("/")).rejects.toMatchObject({ code: "no_content_source" });
  });
});

/** The Astro wiring's modules, laid out as in a workspace, under the repo. */
const ASTRO_WIRING_DIR = join(process.cwd(), ".morph-previews-content-read-core-test");

describe("Astro wiring in Node (its real modules; not workerd, not astro dev)", () => {
  afterAll(() => {
    rmSync(ASTRO_WIRING_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type AstroWiring = {
    content: { morph: ReturnType<Core["createMorph"]> };
    middleware: {
      onRequest(context: { request: Request }, next: () => Promise<Response>): Promise<Response>;
    };
  };

  async function loadAstroWiring(): Promise<AstroWiring> {
    rmSync(ASTRO_WIRING_DIR, { recursive: true, force: true });
    for (const file of astroWorkspaceFiles()) {
      if (!file.path.startsWith("src/morph/")) continue;
      const full = join(ASTRO_WIRING_DIR, file.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.content);
    }
    const url = (path: string) =>
      pathToFileURL(join(ASTRO_WIRING_DIR, path)).href;
    const middlewarePath = PLATFORM_WIRING.astro.find(([from]) => from === "astro/middleware.ts")![1];
    expect(existsSync(join(ASTRO_WIRING_DIR, CORE_WORKSPACE_PATH))).toBe(true);
    return {
      content: await import(/* @vite-ignore */ url(CONTENT_WORKSPACE_PATH)),
      middleware: await import(/* @vite-ignore */ url(middlewarePath)),
    };
  }

  it("two concurrent requests through the middleware each read their own origin", async () => {
    const fetch = vi.fn(async (url: string) =>
      Response.json({ slots: { hero: { title: new URL(url).host } }, hiddenSlots: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const { content, middleware } = await loadAstroWiring();
    const render = async (origin: string | null, delay: number) => {
      let read: unknown;
      await middleware.onRequest(
        {
          request: new Request("http://theme.internal/", {
            headers: origin === null ? {} : { "x-morph-content-origin": origin },
          }),
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          read = await content.morph.pages.get("/").catch((error: unknown) => error);
          return new Response("ok");
        },
      );
      return read;
    };
    const [a, b, none] = await Promise.all([
      render("https://preview-a.example", 5),
      render("https://preview-b.example", 1),
      render(null, 3),
    ]);
    expect(a).toEqual({ hero: { title: "preview-a.example" }, _hidden: [] });
    expect(b).toEqual({ hero: { title: "preview-b.example" }, _hidden: [] });
    // A request without the header: refused, not answered from another's.
    expect(none).toMatchObject({ code: "no_content_source" });
    // After the requests, outside any: refused.
    await expect(content.morph.pages.get("/")).rejects.toMatchObject({
      code: "no_content_source",
    });
  });
});
