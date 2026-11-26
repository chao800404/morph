// @vitest-environment node
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "./starter-theme-v3-files";

/**
 * Starter 32's client loader in the full Start Live Preview (2026-11-26).
 *
 * The author's unsaved edits reach the canvas the way Starter 31's did: the
 * bridge applies them to the page's in-page preview content and refreshes
 * the router, and the client loader lays them over what its read returned.
 * Starter 31 got them by fetching `/_morph/content`, which the preview
 * answers in the page; Starter 32 reads through a server function, which
 * answers from the saved drafts only, so the loader asks the page's
 * read-only accessor (`window.__morphLivePreviewContent`, installed by the
 * Start Live Preview client) for the edits of the exact path it read.
 *
 * Only where Morph's build sets `__MORPH_START_LIVE_PREVIEW__` to true: the
 * full Start Live Preview workspace. Everywhere else (a published build,
 * Build Preview, the prerender) the branch is dead code and a page that
 * defines a hook of the same name is never asked.
 *
 * Executes the actual module source, with the flag replaced the way Vite's
 * `define` replaces it. A test harness, never an untrusted-source sandbox.
 */

type Side = "server" | "client";
type MorphContent = { slots: Record<string, Record<string, unknown>>; hiddenSlots: string[] };

function loader(options: {
  side: Side;
  flag: "true" | "false" | null;
  pagesGet: (path: string) => Promise<unknown>;
  hook?: unknown;
}) {
  let compiled = ts.transpileModule(STARTER_THEME_CONTENT_MODULE_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  if (options.flag !== null) {
    compiled = compiled.replaceAll("__MORPH_START_LIVE_PREVIEW__", options.flag);
  }
  const exports: Record<string, unknown> = {};
  const requireModule = (name: string) => {
    if (name === "react") return { createContext: () => ({ Provider: {} }), useContext: vi.fn() };
    if (name === "@morph/sdk/start") return { morph: { pages: { get: options.pagesGet } } };
    if (name === "@tanstack/react-start") {
      return {
        createIsomorphicFn: () => ({
          client: (client: unknown) => ({
            server: (server: unknown) => (options.side === "client" ? client : server),
          }),
        }),
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
  const globals = { __morphLivePreviewContent: options.hook };
  new Function("exports", "require", "globalThis", compiled)(exports, requireModule, globals);
  return exports.loadContentSlots as (pathname: string) => Promise<MorphContent>;
}

const SAVED = { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" }, _hidden: [] as string[] };
const savedRead = () => vi.fn(async (_path: string) => SAVED);

function liveHook(answer: (pathname: string, base: MorphContent) => unknown) {
  return { overlay: vi.fn(answer) };
}

describe("Starter 32's client loader in the full Start Live Preview", () => {
  it("lays the page's unsaved edits for the path it read over the saved read", async () => {
    const get = savedRead();
    const hook = liveHook((_pathname, base) => ({
      slots: { ...base.slots, "starter-hero": { ...base.slots["starter-hero"], heading: "Typed" } },
      hiddenSlots: [...base.hiddenSlots],
    }));
    const load = loader({ side: "client", flag: "true", pagesGet: get, hook });
    await expect(load("/")).resolves.toEqual({
      slots: { "starter-hero": { heading: "Typed", eyebrow: "Saved eyebrow" } },
      hiddenSlots: [],
    });
    // The read happens as before; the overlay is asked about that path, with that answer.
    expect(get).toHaveBeenCalledWith("/");
    expect(hook.overlay).toHaveBeenCalledWith("/", {
      slots: { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" } },
      hiddenSlots: [],
    });
  });

  it("returns the read as it was when the page holds no edit for the path", async () => {
    const hook = liveHook(() => null);
    const load = loader({ side: "client", flag: "true", pagesGet: savedRead(), hook });
    await expect(load("/about")).resolves.toEqual({
      slots: { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" } },
      hiddenSlots: [],
    });
    expect(hook.overlay).toHaveBeenCalledWith("/about", expect.anything());
  });

  it("uses only a well-formed answer, as a copy", async () => {
    const shared = { slots: { "starter-hero": { heading: "Typed" } }, hiddenSlots: ["promo"] };
    for (const bad of [
      { slots: [], hiddenSlots: [] },
      { slots: { a: "not an object" }, hiddenSlots: [] },
      { slots: {}, hiddenSlots: [1] },
      { slots: {} },
      "nope",
    ]) {
      const load = loader({ side: "client", flag: "true", pagesGet: savedRead(), hook: liveHook(() => bad) });
      await expect(load("/")).resolves.toEqual({
        slots: { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" } },
        hiddenSlots: [],
      });
    }
    const load = loader({ side: "client", flag: "true", pagesGet: savedRead(), hook: liveHook(() => shared) });
    const content = await load("/");
    expect(content).toEqual(shared);
    content.slots["starter-hero"].heading = "changed";
    content.hiddenSlots.push("x");
    expect(shared).toEqual({ slots: { "starter-hero": { heading: "Typed" } }, hiddenSlots: ["promo"] });
  });

  it("keeps a failed read a failure, whatever the page holds", async () => {
    const hook = liveHook(() => ({ slots: {}, hiddenSlots: [] }));
    const load = loader({
      side: "client",
      flag: "true",
      pagesGet: async () => Promise.reject(Object.assign(new Error("no"), { code: "store_unreachable" })),
      hook,
    });
    await expect(load("/")).rejects.toMatchObject({ name: "MorphContentError", code: "store_unreachable" });
    expect(hook.overlay).not.toHaveBeenCalled();
  });

  it("falls back to the read when the page has no accessor", async () => {
    const load = loader({ side: "client", flag: "true", pagesGet: savedRead() });
    await expect(load("/")).resolves.toEqual({
      slots: { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" } },
      hiddenSlots: [],
    });
  });

  it.each([
    ["a build that sets the flag false", "false"],
    ["a build that never defines it", null],
  ] as const)("never asks a hook of the same name in %s", async (_label, flag) => {
    const hook = liveHook(() => ({ slots: { "starter-hero": { heading: "DRAFT MARKER" } }, hiddenSlots: [] }));
    const load = loader({ side: "client", flag, pagesGet: savedRead(), hook });
    await expect(load("/")).resolves.toEqual({
      slots: { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" } },
      hiddenSlots: [],
    });
    expect(hook.overlay).not.toHaveBeenCalled();
  });

  it("never asks it on the server, even in the Live Preview", async () => {
    const hook = liveHook(() => ({ slots: { "starter-hero": { heading: "DRAFT MARKER" } }, hiddenSlots: [] }));
    const load = loader({ side: "server", flag: "true", pagesGet: savedRead(), hook });
    await expect(load("/")).resolves.toEqual({
      slots: { "starter-hero": { heading: "Saved", eyebrow: "Saved eyebrow" } },
      hiddenSlots: [],
    });
    expect(hook.overlay).not.toHaveBeenCalled();
  });
});
