// @vitest-environment node
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  STARTER_THEME_ROOT_ROUTE_SOURCE,
} from "./starter-theme-v3-files";

/**
 * Starter 32's content module and the read-failure trap (2026-11-24). It was
 * a candidate on that date; it is the shipped `STARTER_THEME_CONTENT_MODULE_SOURCE`.
 *
 * Two states must stay apart, in the module and here:
 *
 * - the read succeeded and the page has no content: the Document is empty, so
 *   no slot values and no hidden sections, and the components' defaults are
 *   the right answer;
 * - the content source refused, or the read failed: nothing is known about
 *   the page, including which sections the author hid. Answering with an
 *   empty hidden list here would render every hidden section (the layout's
 *   Footer included) with its defaults, on the preview and the public site.
 *
 * The candidate has no trusted display state of the same release to fall
 * back to, so a failed read takes the load-failure path on both sides: the
 * load rejects with `MorphContentError`, the root's `beforeLoad` (Starter 31's,
 * byte for byte) rejects with it, and the router renders its error state
 * instead of the root component and its layout. A server render answers 500
 * (router-core: a match in the error state sets the status to 500).
 *
 * Executes the actual candidate source, not a copy of its loader. This is a
 * test harness, never an untrusted-source sandbox.
 */

type Side = "server" | "client";
type MorphContent = { slots: Record<string, Record<string, unknown>>; hiddenSlots: string[] };
type ContentErrorClass = new (code: string) => Error & { code: string };

function candidate(side: Side, pagesGet: (path: string) => Promise<unknown>) {
  const compiled = ts.transpileModule(STARTER_THEME_CONTENT_MODULE_SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const requireModule = (name: string) => {
    if (name === "react") {
      return { createContext: () => ({ Provider: {} }), useContext: vi.fn() };
    }
    if (name === "@morph/sdk/start") {
      return { morph: { pages: { get: pagesGet } } };
    }
    if (name === "@tanstack/react-start") {
      return {
        createIsomorphicFn: () => ({
          client: (client: unknown) => ({
            server: (server: unknown) => (side === "client" ? client : server),
          }),
        }),
        // The server function as the handler it wraps: input validated, then
        // the handler's answer or its rejection, as Start returns them.
        createServerFn: () => ({
          inputValidator: (validate: (input: unknown) => unknown) => ({
            handler:
              (handler: (ctx: { data: unknown }) => Promise<unknown>) =>
              async ({ data }: { data: unknown }) =>
                handler({ data: validate(data) }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("exports", "require", compiled)(exports, requireModule);
  return {
    load: exports.loadContentSlots as (pathname: string) => Promise<MorphContent>,
    MorphContentError: exports.MorphContentError as ContentErrorClass,
  };
}

/** The SDK's refusal: a `MorphError` carries its code and a message of its own. */
function sdkRefusal(code: string, message = `upstream says no (${code}) at http://10.0.0.7:8787`) {
  return Object.assign(new Error(message), { name: "MorphError", code });
}

const SIDES: Side[] = ["server", "client"];

describe("the Starter 32 candidate tells a failed read from an empty page", () => {
  it.each(SIDES)("%s: a page read that succeeds with no content is empty content", async (side) => {
    const get = vi.fn(async (_path: string) => ({ _hidden: [] as string[] }));
    const { load } = candidate(side, get);
    await expect(load("/no-document")).resolves.toEqual({ slots: {}, hiddenSlots: [] });
    expect(get).toHaveBeenCalledWith("/no-document");
  });

  it.each(SIDES)("%s: a route other than the home reads its own page, by its own path", async (side) => {
    const get = vi.fn(async (path: string) =>
      path === "/about"
        ? { "about-hero": { heading: "About us" }, _hidden: ["about-newsletter"] }
        : { "starter-hero": { heading: "Home" }, _hidden: [] },
    );
    const { load } = candidate(side, get);
    await expect(load("/about")).resolves.toEqual({
      slots: { "about-hero": { heading: "About us" } },
      hiddenSlots: ["about-newsletter"],
    });
    expect(get.mock.calls).toEqual([["/about"]]);
  });

  it.each(SIDES)("%s: a page read that succeeds keeps its values and its hidden list", async (side) => {
    const { load } = candidate(side, async () => ({
      "starter-hero": { heading: "Authored" },
      _hidden: ["starter-footer", "starter-newsletter"],
    }));
    await expect(load("/")).resolves.toEqual({
      slots: { "starter-hero": { heading: "Authored" } },
      hiddenSlots: ["starter-footer", "starter-newsletter"],
    });
  });

  // Each code the SDK refuses with. no_content_source is the missing
  // x-morph-content-origin header; invalid_path is the E2E trap's long path.
  const REFUSALS = [
    "no_content_source",
    "invalid_content_origin",
    "invalid_path",
    "store_unreachable",
    "content_not_found",
    "store_error",
    "redirect_refused",
    "invalid_response",
    "response_too_large",
    "reserved_slot",
  ] as const;

  const cases = SIDES.flatMap((side) => REFUSALS.map((code) => [side, code] as const));

  it.each(cases)(
    "%s: a refused read (%s) rejects with that code, never an empty hidden list",
    async (side, code) => {
      const { load, MorphContentError } = candidate(side, async () => {
        throw sdkRefusal(code);
      });
      const outcome = await load("/").then(
        (content) => ({ resolved: content }),
        (error: unknown) => ({ rejected: error }),
      );
      expect(outcome, "a refused read must not resolve to content").not.toHaveProperty(
        "resolved",
      );
      const error = (outcome as { rejected: unknown }).rejected;
      expect(error).toBeInstanceOf(MorphContentError);
      expect((error as { code: string }).code).toBe(code);
      // The module's own words, never the upstream message or an address:
      // a server render's error is serialized into the page.
      expect((error as Error).message).not.toContain("10.0.0.7");
      expect((error as Error).message).toBe(new MorphContentError(code).message);
    },
  );

  it.each(SIDES)("%s: a failure with no code is the store's error, not empty content", async (side) => {
    const { load, MorphContentError } = candidate(side, async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.7:8787");
    });
    const error = await load("/").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MorphContentError);
    expect((error as { code: string }).code).toBe("store_error");
    expect((error as Error).message).not.toContain("10.0.0.7");
  });

  it.each(SIDES)("%s: a page without a usable hidden list is an invalid response, not 'nothing hidden'", async (side) => {
    for (const page of [
      {},
      { _hidden: "starter-footer" },
      { _hidden: [1] },
      null,
    ]) {
      const { load, MorphContentError } = candidate(side, async () => page);
      const error = await load("/").catch((caught: unknown) => caught);
      expect(error, JSON.stringify(page)).toBeInstanceOf(MorphContentError);
      expect((error as { code: string }).code, JSON.stringify(page)).toBe("invalid_response");
    }
  });

  it("leaves the failure to the root's beforeLoad, which has no error boundary of its own", () => {
    // Starter 31's root, unchanged in 32: the load's rejection is the root
    // match's error, so the router's error state replaces RootComponent and
    // with it the layout (Footer) and every slot section. No section can be
    // rendered from defaults on that path.
    expect(STARTER_THEME_ROOT_ROUTE_SOURCE).toContain(
      "morphContent: await loadContentSlots(location.pathname),",
    );
    expect(STARTER_THEME_ROOT_ROUTE_SOURCE).not.toMatch(/errorComponent|onError|catch/);
  });
});
