import { describe, expect, it } from "vitest";
import {
  THEME_START_SERVER_SPECIFIER,
  createThemePreviewServerStubPlugin,
  themePreviewServerStubPluginSource,
} from "./theme-preview-server-stub";

function loadStub(source: string): string {
  const plugin = createThemePreviewServerStubPlugin();
  const id = plugin.resolveId(source);
  expect(id).not.toBeNull();
  const code = plugin.load(id!);
  expect(typeof code).toBe("string");
  return code as string;
}

describe("createThemePreviewServerStubPlugin", () => {
  it("stubs the Start server module so a client-only preview build resolves", () => {
    const code = loadStub(THEME_START_SERVER_SPECIFIER);

    expect(code).toContain("export const getRequest");
  });

  it("stubs node:async_hooks, which Start's storage context imports", () => {
    // A Theme reaches its server-only branch through `createIsomorphicFn`. The
    // preview build has no Start plugin to strip that branch, so the transitive
    // `AsyncLocalStorage` import would otherwise fail the whole build against
    // Vite's empty browser shim.
    for (const specifier of ["node:async_hooks", "async_hooks"]) {
      expect(loadStub(specifier)).toContain("export class AsyncLocalStorage");
    }
  });

  it("leaves unrelated specifiers to the rest of the build", () => {
    const plugin = createThemePreviewServerStubPlugin();

    expect(plugin.resolveId("react")).toBeNull();
    expect(plugin.resolveId("@tanstack/react-start")).toBeNull();
    expect(plugin.load("\0some-other-virtual-module")).toBeNull();
  });

  it("keeps the async_hooks stub usable rather than throwing on import", async () => {
    const code = loadStub("node:async_hooks");
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
  /** Evaluates the emitted source the way the generated vite config would. */
  function emittedPlugin() {
    return new Function(
      `return (${themePreviewServerStubPluginSource()});`,
    )() as {
      name: string;
      resolveId(source: string): string | null;
      load(id: string): string | null;
    };
  }

  it("stubs exactly what the in-process plugin stubs", () => {
    // The sandbox writes its own config into an image that cannot import
    // Morph's source, so the plugin travels as text. Two copies of what to stub
    // would drift, and preview builds are where that drift stays invisible
    // until a customer's build fails.
    const inProcess = createThemePreviewServerStubPlugin();
    const emitted = emittedPlugin();

    for (const specifier of [
      THEME_START_SERVER_SPECIFIER,
      "node:async_hooks",
      "async_hooks",
      "react",
      "@tanstack/react-start",
    ]) {
      expect({ specifier, id: emitted.resolveId(specifier) }).toEqual({
        specifier,
        id: inProcess.resolveId(specifier),
      });
    }
  });

  it("returns the same stub bodies", () => {
    const inProcess = createThemePreviewServerStubPlugin();
    const emitted = emittedPlugin();

    for (const specifier of [THEME_START_SERVER_SPECIFIER, "node:async_hooks"]) {
      const id = inProcess.resolveId(specifier)!;
      expect(emitted.load(id)).toBe(inProcess.load(id));
    }
    expect(emitted.load("\0unrelated")).toBeNull();
  });

  it("emits source that cannot break out of a template literal", () => {
    // The config is assembled with a template literal, so an unescaped backtick
    // or interpolation would corrupt the file rather than fail loudly.
    const source = themePreviewServerStubPluginSource();

    expect(source).not.toContain("`");
    expect(source).not.toContain("${");
  });
});
