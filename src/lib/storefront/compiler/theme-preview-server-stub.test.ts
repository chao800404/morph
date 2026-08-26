import { describe, expect, it } from "vitest";
import {
  THEME_START_SERVER_SPECIFIER,
  createThemePreviewServerStubPlugin,
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
