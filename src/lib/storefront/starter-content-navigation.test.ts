// @vitest-environment node
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE,
} from "./starter-theme-v3-files";
import { createStarterThemeWorkspaceUpgrade } from "./starter-theme-files";

// Execute the actual trusted platform starter module, not a handwritten copy
// of its loader. This is a test harness, never an untrusted-source sandbox.
function clientLoader(
  fetcher: typeof fetch,
): (pathname: string) => Promise<unknown> {
  const compiled = ts.transpileModule(STARTER_THEME_CONTENT_MODULE_SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const requireModule = (name: string) => {
    if (name === "react")
      return { createContext: () => ({ Provider: {} }), useContext: vi.fn() };
    if (name === "@tanstack/react-start/server")
      return {
        getRequest: () => {
          throw new Error("Client used server request");
        },
      };
    if (name === "@tanstack/react-start")
      return {
        createIsomorphicFn: () => ({
          client: (fn: unknown) => ({ server: () => fn }),
        }),
      };
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("exports", "require", "fetch", compiled)(
    exports,
    requireModule,
    fetcher,
  );
  return exports.loadContentSlots as (pathname: string) => Promise<unknown>;
}

describe("starter client content navigation", () => {
  it("loads each destination, preserving overrides and hidden sections on return", async () => {
    const home = {
      slots: { hero: { heading: "Published" } },
      hiddenSlots: ["newsletter"],
    };
    const about = { slots: { intro: { heading: "About" } }, hiddenSlots: [] };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        Response.json(String(url).endsWith("%2Fabout") ? about : home),
      );
    const load = clientLoader(fetcher);
    expect(await load("/")).toEqual(home);
    expect(await load("/about")).toEqual(about);
    expect(await load("/")).toEqual(home);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not turn a failed request into empty default content", async () => {
    const load = clientLoader(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(load("/")).rejects.toThrow("unavailable");
  });
  it("rejects invalid visibility payloads", async () => {
    const load = clientLoader(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ slots: {}, hiddenSlots: [123] })),
    );
    await expect(load("/")).rejects.toThrow("Invalid");
  });
  it("upgrades only untouched v13 modules", () => {
    const files = (content: string) => [
      {
        id: "manifest",
        path: "morph.theme.json",
        content: JSON.stringify({
          name: "Starter",
          entry: "src/routes/index.tsx",
          router: { framework: "tanstack-start" },
          components: {},
        }),
        version: 1,
      },
      { id: "content", path: "src/morph/content.ts", content, version: 1 },
    ];
    expect(
      createStarterThemeWorkspaceUpgrade(
        files(LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE) as never,
      ).find((file) => file.path === "src/morph/content.ts")?.content,
    ).toBe(STARTER_THEME_CONTENT_MODULE_SOURCE);
    expect(
      createStarterThemeWorkspaceUpgrade(
        files(
          LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE + "\n// custom",
        ) as never,
      ).some((file) => file.path === "src/morph/content.ts"),
    ).toBe(false);
  });
});
