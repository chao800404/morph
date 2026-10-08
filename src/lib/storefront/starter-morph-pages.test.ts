// @vitest-environment node
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "./starter-theme-v3-files";
import {
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";

type Page = { _hidden: string[]; [slotId: string]: unknown };
type Morph = {
  pages: {
    get(path: string): Promise<Page>;
    isHidden(page: Page, slotId: string): boolean;
  };
};

/**
 * Executes the real starter module, as the navigation test does, choosing the
 * branch Start would: the server build keeps `.server`, the browser `.client`.
 */
function loadMorph(args: {
  branch: "server" | "client";
  fetcher: typeof fetch;
  requestHeaders?: Record<string, string>;
  /** What Vite's import.meta.env.DEV is: true under the dev server, false in a build. */
  dev?: boolean;
}): { morph: Morph; MorphContentError: new (message: string) => Error } {
  const compiled = ts
    .transpileModule(STARTER_THEME_CONTENT_MODULE_SOURCE, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replaceAll("import.meta", "__importMeta");
  const exports: Record<string, unknown> = {};
  const requireModule = (name: string) => {
    if (name === "react")
      return { createContext: () => ({ Provider: {} }), useContext: vi.fn() };
    if (name === "@tanstack/react-start/server")
      return {
        getRequest: () => ({ headers: new Headers(args.requestHeaders) }),
      };
    if (name === "@tanstack/react-start")
      return {
        createIsomorphicFn: () =>
          args.branch === "server"
            ? { client: () => ({ server: (fn: unknown) => fn }) }
            : { client: (fn: unknown) => ({ server: () => fn }) },
      };
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("exports", "require", "fetch", "__importMeta", compiled)(
    exports,
    requireModule,
    args.fetcher,
    { env: { DEV: args.dev ?? true } },
  );
  return exports as never;
}

const published = {
  slots: { hero: { heading: "Published" }, "summer-sale": { title: "Sale" } },
  hiddenSlots: ["newsletter"],
};

const respond = (body: unknown = published, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(
    status === 200
      ? Response.json(body)
      : new Response(null, { status }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("morph.pages.get on the server", () => {
  it("reads the origin the platform forwarded and spreads slots by id", async () => {
    const fetcher = respond();
    const { morph } = loadMorph({
      branch: "server",
      fetcher,
      requestHeaders: { "x-morph-content-origin": "https://core.example" },
    });

    const home = await morph.pages.get("/home");

    expect(fetcher).toHaveBeenCalledWith(
      "https://core.example/_morph/content?path=%2Fhome",
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(home.hero).toEqual({ heading: "Published" });
    expect(home["summer-sale"]).toEqual({ title: "Sale" });
    expect(home._hidden).toEqual(["newsletter"]);
    expect(morph.pages.isHidden(home, "newsletter")).toBe(true);
    expect(morph.pages.isHidden(home, "hero")).toBe(false);
  });

  it("reads MORPH_CONTENT_ORIGIN on a local machine where nothing forwards one", async () => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example/ignored/path");
    const fetcher = respond();
    const { morph } = loadMorph({ branch: "server", fetcher });

    await morph.pages.get("/");

    expect(fetcher.mock.calls[0]![0]).toBe(
      "https://store.example/_morph/content?path=%2F",
    );
  });

  it("prefers the forwarded origin over the local one", async () => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://local.example");
    const fetcher = respond();
    const { morph } = loadMorph({
      branch: "server",
      fetcher,
      requestHeaders: { "x-morph-content-origin": "https://core.example" },
    });

    await morph.pages.get("/");

    expect(String(fetcher.mock.calls[0]![0])).toContain("https://core.example/");
  });

  it("ignores MORPH_CONTENT_ORIGIN outside the dev server, and never calls it", async () => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example");
    const fetcher = respond();
    const { morph, MorphContentError } = loadMorph({
      branch: "server",
      fetcher,
      dev: false,
    });

    const failure = await morph.pages.get("/").catch((error) => error);

    expect(failure).toBeInstanceOf(MorphContentError);
    expect(failure.message).toContain("No content source");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["not a url", "platform content origin header"],
    ["ftp://core.example", "platform content origin header"],
    ["", "platform content origin header"],
  ])(
    "refuses the platform header %j without falling back to the local address",
    async (header, label) => {
      vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example");
      const fetcher = respond();
      const { morph } = loadMorph({
        branch: "server",
        fetcher,
        requestHeaders: { "x-morph-content-origin": header },
      });

      const failure = await morph.pages.get("/").catch((error) => error);

      expect(failure.message).toContain(label);
      expect(failure.message).not.toContain("MORPH_CONTENT_ORIGIN");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("refuses a content source that sends a slot named _hidden", async () => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example");
    const { morph } = loadMorph({
      branch: "server",
      fetcher: respond({
        slots: { _hidden: { heading: "x" } },
        hiddenSlots: [],
      }),
    });

    await expect(morph.pages.get("/")).rejects.toThrow("_hidden");
  });

  it("says what to set instead of falling back to defaults", async () => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "");
    const fetcher = respond();
    const { morph, MorphContentError } = loadMorph({
      branch: "server",
      fetcher,
    });

    const failure = await morph.pages.get("/").catch((error) => error);

    expect(failure).toBeInstanceOf(MorphContentError);
    expect(failure.message).toContain("MORPH_CONTENT_ORIGIN");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["not a url", "ftp://store.example", "file:///etc/passwd"])(
    "refuses %s as a content origin",
    async (value) => {
      vi.stubEnv("MORPH_CONTENT_ORIGIN", value);
      const fetcher = respond();
      const { morph } = loadMorph({ branch: "server", fetcher });

      await expect(morph.pages.get("/")).rejects.toThrow("MORPH_CONTENT_ORIGIN");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an unsuccessful answer", () => respond(null, 503), "store_error"],
    ["a missing page", () => respond(null, 404), "content_not_found"],
    [
      "an unreachable source",
      () => vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED")),
      "store_unreachable",
    ],
    [
      "a malformed payload",
      () => respond({ slots: {}, hiddenSlots: [123] }),
      "invalid_response",
    ],
    [
      "an answer that is not JSON",
      () => vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>")),
      "invalid_response",
    ],
  ])("throws on %s rather than returning defaults", async (_label, make, code) => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example");
    const { morph } = loadMorph({ branch: "server", fetcher: make() });

    await expect(morph.pages.get("/")).rejects.toMatchObject({ code });
  });

  it("keeps addresses, upstream words and stacks out of what a page may render, and logs them on the server", async () => {
    vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { morph } = loadMorph({
      branch: "server",
      fetcher: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:443")),
    });

    const failure = await morph.pages.get("/home").catch((error) => error);

    expect(failure.message).not.toMatch(/store\.example|10\.1\.2\.3|ECONNREFUSED|_morph/);
    expect(failure.stack).not.toMatch(/10\.1\.2\.3/);
    expect(warn.mock.calls.flat().join(" ")).toContain("store.example");
    warn.mockRestore();
  });

  it.each(["home", "", "/" + "a".repeat(500)])(
    "refuses the page path %j before any request",
    async (path) => {
      vi.stubEnv("MORPH_CONTENT_ORIGIN", "https://store.example");
      const fetcher = respond();
      const { morph } = loadMorph({ branch: "server", fetcher });

      await expect(morph.pages.get(path)).rejects.toThrow("page path");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe("morph.pages.get in the browser", () => {
  it("reads the same origin and throws on failure", async () => {
    const fetcher = respond();
    const { morph } = loadMorph({ branch: "client", fetcher });

    const home = await morph.pages.get("/home");

    expect(fetcher.mock.calls[0]![0]).toBe("/_morph/content?path=%2Fhome");
    expect(home.hero).toEqual({ heading: "Published" });

    const failing = loadMorph({ branch: "client", fetcher: respond(null, 500) });
    await expect(failing.morph.pages.get("/home")).rejects.toMatchObject({
      code: "store_error",
    });
  });

  it("shows the reason the development proxy gave, in the library's own words", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused = (code: string, status: number) =>
      loadMorph({
        branch: "client",
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          Response.json(
            { code, message: "words from the proxy that the page must not repeat" },
            { status },
          ),
        ),
      }).morph.pages.get("/home");

    await expect(refused("content_not_found", 404)).rejects.toThrow(
      "The store has no content for this page.",
    );
    await expect(refused("no_content_source", 503)).rejects.toThrow(
      "MORPH_CONTENT_ORIGIN",
    );
    // A code outside the set is not taken on trust.
    const unknown = await refused("<script>", 502).catch((error) => error);
    expect(unknown.code).toBe("store_error");
    expect(unknown.message).not.toContain("script");
    // The browser keeps no log of its own.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("existing workspaces keep their content module", () => {
  const START_MANIFEST = {
    id: "manifest",
    path: "morph.theme.json",
    content: JSON.stringify({
      name: "Starter",
      entry: "src/routes/index.tsx",
      router: { framework: "tanstack-start" },
      components: {},
    }),
    version: 1,
  };
  /** The complete workspace a new store starts with, with this content module. */
  const workspace = (content: string, withManifest: boolean) => [
    ...starterThemeWorkspaceFiles().map((file, index) => ({
      id: `file-${index}`,
      path: file.path,
      content: file.path === "src/morph/content.ts" ? content : file.content,
      version: 1,
    })),
    ...(withManifest ? [START_MANIFEST] : []),
  ];

  it("starts a new workspace on the module with pages", () => {
    expect(
      starterThemeWorkspaceFiles().find(
        (file) => file.path === "src/morph/content.ts",
      )?.content,
    ).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
  });

  it.each([
    ["source-first, untouched", LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE, false],
    ["with a Start manifest, untouched", LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE, true],
    ["source-first, edited", LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE + "\n// mine", false],
    ["with a Start manifest, edited", LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE + "\n// mine", true],
  ])(
    "no upgrade plan replaces the previous module (%s)",
    (_label, content, withManifest) => {
      const plan = createStarterThemeWorkspaceUpgradePlan(
        workspace(content, withManifest) as never,
      );
      expect(
        plan.files.some((file) => file.path === "src/morph/content.ts"),
      ).toBe(false);
    },
  );

  it("keeps the previous module as it was, without pages", () => {
    expect(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE).not.toContain(
      "morph.pages",
    );
    expect(LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE).toContain(
      "loadContentSlots",
    );
    expect(STARTER_THEME_CONTENT_MODULE_SOURCE).toContain("export const morph");
  });
});
