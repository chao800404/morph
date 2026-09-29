import { describe, expect, it } from "vitest";
import {
  THEME_START_SERVER_SPECIFIER,
  createThemePreviewServerStubPlugin,
  themePreviewServerStubPluginSource,
} from "./theme-preview-server-stub";

async function loadStub(source: string): Promise<string> {
  const plugin = createThemePreviewServerStubPlugin();
  const id = plugin.resolveId(source);
  expect(id).not.toBeNull();
  const code = await plugin.load(id!);
  expect(typeof code).toBe("string");
  return code as string;
}

describe("createThemePreviewServerStubPlugin", () => {
  it("stubs the Start server module so a client-only preview build resolves", async () => {
    const code = await loadStub(THEME_START_SERVER_SPECIFIER);

    expect(code).toContain("export const getRequest");
  });

  it("exports every name the real Start server module does, so no import can break a build", async () => {
    // A Theme that imports `getCookie` failed the whole Theme build: every
    // build runs this client-only preview build too, and a name the stub
    // lacked is a build error there.
    const real = await import("@tanstack/react-start/server");
    const code = await loadStub(THEME_START_SERVER_SPECIFIER);
    for (const name of Object.keys(real).filter((key) => key !== "default")) {
      expect(code, name).toContain("export const " + name + " =");
    }
    for (const name of ["getCookie", "setCookie", "deleteCookie"]) {
      expect(code).toContain("export const " + name + " =");
    }
  });

  it("fails when a stubbed name is called, saying it is unsupported, never on import", async () => {
    const code = await loadStub(THEME_START_SERVER_SPECIFIER);
    const module = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    expect(() => module.getCookie("x")).toThrow(
      "Theme preview cannot call getCookie(): server APIs run only in the deployed Theme Worker.",
    );
  });

  it("stubs node:async_hooks, which Start's storage context imports", async () => {
    // A Theme reaches its server-only branch through `createIsomorphicFn`. The
    // preview build has no Start plugin to strip that branch, so the transitive
    // `AsyncLocalStorage` import would otherwise fail the whole build against
    // Vite's empty browser shim.
    for (const specifier of ["node:async_hooks", "async_hooks"]) {
      expect(await loadStub(specifier)).toContain(
        "export class AsyncLocalStorage",
      );
    }
  });

  it("stubs @tanstack/start-fn-stubs so createIsomorphicFn chooses client implementation in browser", async () => {
    const code = await loadStub("@tanstack/start-fn-stubs");
    expect(code).toContain("export function createIsomorphicFn");
    const module = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    const clientFn = () => "from-client";
    const serverFn = () => "from-server";
    const iso = module.createIsomorphicFn().client(clientFn).server(serverFn);
    expect(iso()).toBe("from-client");
  });

  it("leaves unrelated specifiers to the rest of the build", async () => {
    const plugin = createThemePreviewServerStubPlugin();

    expect(plugin.resolveId("react")).toBeNull();
    expect(plugin.resolveId("@tanstack/react-start")).toBeNull();
    expect(await plugin.load("\0some-other-virtual-module")).toBeNull();
  });

  it("keeps the async_hooks stub usable rather than throwing on import", async () => {
    const code = await loadStub("node:async_hooks");
    const module = await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
    const storage = new module.AsyncLocalStorage();

    expect(storage.getStore()).toBeUndefined();
    expect(storage.run({ id: 1 }, () => storage.getStore())).toEqual({ id: 1 });
    expect(storage.getStore()).toBeUndefined();
  });
});

describe("the same stub inside a container-generated config", () => {
  /**
   * Evaluates the emitted source the way the generated vite config would.
   *
   * A dynamic `import()` cannot run inside `new Function`, so the one that
   * reads the real Start server module is handed the module instead; what is
   * under test is the stub built from it, not Node's module loader.
   */
  async function emittedPlugin() {
    const real = await import("@tanstack/react-start/server");
    const source = themePreviewServerStubPluginSource().replace(
      'import("' + THEME_START_SERVER_SPECIFIER + '")',
      "Promise.resolve(injectedReal)",
    );
    expect(source).toContain("Promise.resolve(injectedReal)");
    return new Function("injectedReal", `return (${source});`)(real) as {
      name: string;
      resolveId(source: string): string | null;
      load(id: string): string | null | Promise<string | null>;
    };
  }

  it("stubs exactly what the in-process plugin stubs", async () => {
    // The sandbox writes its own config into an image that cannot import
    // Morph's source, so the plugin travels as text. Two copies of what to stub
    // would drift, and preview builds are where that drift stays invisible
    // until a customer's build fails.
    const inProcess = createThemePreviewServerStubPlugin();
    const emitted = await emittedPlugin();

    for (const specifier of [
      THEME_START_SERVER_SPECIFIER,
      "node:async_hooks",
      "async_hooks",
      "@tanstack/start-fn-stubs",
      "react",
      "@tanstack/react-start",
    ]) {
      expect({ specifier, id: emitted.resolveId(specifier) }).toEqual({
        specifier,
        id: inProcess.resolveId(specifier),
      });
    }
  });

  it("returns the same stub bodies", async () => {
    const inProcess = createThemePreviewServerStubPlugin();
    const emitted = await emittedPlugin();

    for (const specifier of [
      THEME_START_SERVER_SPECIFIER,
      "node:async_hooks",
      "@tanstack/start-fn-stubs",
    ]) {
      const id = inProcess.resolveId(specifier)!;
      expect(await emitted.load(id)).toBe(await inProcess.load(id));
    }
    expect(await emitted.load("\0unrelated")).toBeNull();
  });

  it("emits source that cannot break out of a template literal", () => {
    // The config is assembled with a template literal, so an unescaped backtick
    // or interpolation would corrupt the file rather than fail loudly.
    const source = themePreviewServerStubPluginSource();

    expect(source).not.toContain("`");
    expect(source).not.toContain("${");
  });
});
