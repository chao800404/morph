// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isPreviewDevInfrastructureSpecifier,
  previewDevInfrastructureGuardSource,
  SANDBOX_TOOLCHAIN_ROOT,
  THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES,
  THEME_PREVIEW_SERVER_BASE_PATH,
  THEME_PREVIEW_SERVER_HMR_PATH,
} from "./theme-preview-dev-server";

const compileGuard = (): ((source: string) => boolean) =>
  new Function(`return (${previewDevInfrastructureGuardSource()});`)() as (
    source: string,
  ) => boolean;

describe("preview dev infrastructure allowance", () => {
  it("allows the dev client and refresh runtime Vite serves from the pinned toolchain", () => {
    for (const source of [
      `/@fs${SANDBOX_TOOLCHAIN_ROOT}/node_modules/vite/dist/client/client.mjs`,
      `/@fs${SANDBOX_TOOLCHAIN_ROOT}/node_modules/@vitejs/plugin-react/dist/refresh-runtime.js`,
    ]) {
      expect(isPreviewDevInfrastructureSpecifier(source)).toBe(true);
    }
  });

  it("stays a toolchain allowance rather than a filesystem escape hatch", () => {
    for (const source of [
      "/@fs/etc/passwd",
      "/@fs/workspace/../../etc/shadow",
      "/@fs/opt/other-toolchain/node_modules/evil.js",
      `/@fs${SANDBOX_TOOLCHAIN_ROOT}/secrets.env`,
      `${SANDBOX_TOOLCHAIN_ROOT}/node_modules/vite/dist/client/client.mjs`,
      "../../opt/morph-toolchain/node_modules/vite/dist/client/client.mjs",
    ]) {
      expect(isPreviewDevInfrastructureSpecifier(source)).toBe(false);
    }
  });

  it("emits a guard that decides exactly what the in-process predicate decides", () => {
    const guard = compileGuard();
    for (const source of [
      `/@fs${SANDBOX_TOOLCHAIN_ROOT}/node_modules/vite/dist/client/client.mjs`,
      "/@fs/etc/passwd",
      "react",
      "./Hero",
      "/workspace/src/Hero.tsx",
    ]) {
      expect(guard(source)).toBe(isPreviewDevInfrastructureSpecifier(source));
    }
  });

  it("excludes the Start entry points whose stubs are Rollup plugins", () => {
    // Pre-bundling never calls a Rollup resolveId, so anything the preview
    // stubs must stay off that path or the stub silently does not apply.
    expect(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES).toContain(
      "@tanstack/react-start",
    );
    expect(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES).toContain(
      "@tanstack/react-start/server",
    );
    // The packages that actually import node:async_hooks, rather than only
    // the entry point a Theme names.
    expect(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES).toContain(
      "@tanstack/start-storage-context",
    );
    expect(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES).toContain(
      "@tanstack/start-server-core",
    );
  });

  it("keeps Theme assets and HMR out of the outer Morph Vite namespace", () => {
    expect(THEME_PREVIEW_SERVER_BASE_PATH).toBe("/__morph-theme-preview__/");
    expect(THEME_PREVIEW_SERVER_HMR_PATH).toBe("hmr");
  });
});
