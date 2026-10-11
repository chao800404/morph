// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Connect, ViteDevServer } from "vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import {
  isPreviewDevInfrastructureSpecifier,
  previewHttpHmrPluginSource,
  THEME_PREVIEW_HMR_FAILED_EVENT,
  previewDevInfrastructureGuardSource,
  SANDBOX_TOOLCHAIN_ROOT,
  THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES,
  THEME_PREVIEW_DEP_OPTIMIZE_INCLUDES,
  THEME_PREVIEW_SERVER_BASE_PATH,
  THEME_PREVIEW_SERVER_HMR_PATH,
  themePreviewServerSourcePlugin,
  themePreviewServerSourcePluginSource,
} from "./theme-preview-dev-server";
import { START_TOOLCHAIN } from "./sandbox-toolchain.test-support";

describe("server source HTTP boundary", () => {
  it("uses the same refusal in generated configs without blocking ordinary client modules", () => {
    for (const plugin of [
      themePreviewServerSourcePlugin(),
      new Function(`return ${themePreviewServerSourcePluginSource()}`)(),
    ]) {
      let middleware!: Connect.NextHandleFunction;
      const configure = plugin.configureServer as (
        server: ViteDevServer,
      ) => void;
      configure({
        middlewares: {
          use(fn: Connect.NextHandleFunction) {
            middleware = fn;
          },
        },
      } as unknown as ViteDevServer);
      for (const url of [
        "/src/data.server.ts",
        "/src/data.server.ts?raw",
        "/src/data.server.ts.map",
        "/@fs/workspace/src/data.server.mjs",
        "/src/data%2eserver.ts",
        "/src/data.server.tsx?import",
      ]) {
        const headers: Record<string, string> = {};
        const response = {
          statusCode: 200,
          setHeader(name: string, value: string) {
            headers[name] = value;
          },
          end() {},
        };
        let passed = false;
        middleware(
          { url } as Parameters<Connect.NextHandleFunction>[0],
          response as unknown as Parameters<Connect.NextHandleFunction>[1],
          () => {
            passed = true;
          },
        );
        expect(response.statusCode).toBe(403);
        expect(headers["Cache-Control"]).toBe("no-store");
        expect(passed).toBe(false);
      }
      for (const url of [
        "/src/routes/index.tsx",
        "/src/server.ts",
        "/src/data.server.ts/assets.png",
        "/api/search",
        "/robots.txt",
      ]) {
        let passed = false;
        middleware(
          { url } as Parameters<Connect.NextHandleFunction>[0],
          {} as Parameters<Connect.NextHandleFunction>[1],
          () => {
            passed = true;
          },
        );
        expect(passed).toBe(true);
      }
    }
  });
});

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
      `../..${START_TOOLCHAIN.root}/node_modules/vite/dist/client/client.mjs`,
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

  it("pre-bundles router-core's browser entries and nothing on the stubbed path", () => {
    expect(THEME_PREVIEW_DEP_OPTIMIZE_INCLUDES).toEqual([
      "@tanstack/router-core",
      "@tanstack/router-core/ssr/client",
      "@tanstack/router-core/isServer",
    ]);
    // The server entry reaches Node built-ins; the preview never loads it.
    expect(THEME_PREVIEW_DEP_OPTIMIZE_INCLUDES).not.toContain(
      "@tanstack/router-core/ssr/server",
    );
    // Nothing both included and excluded, and no Start package included:
    // pre-bundling one would take it off the path its stub answers on.
    for (const name of THEME_PREVIEW_DEP_OPTIMIZE_INCLUDES) {
      expect(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES).not.toContain(name);
      expect(name).not.toMatch(/^@tanstack\/(react-)?start/);
    }
  });

  it("keeps Theme assets and HMR out of the outer Morph Vite namespace", () => {
    expect(THEME_PREVIEW_SERVER_BASE_PATH).toBe("/__morph-theme-preview__/");
    expect(THEME_PREVIEW_SERVER_HMR_PATH).toBe("hmr");
  });
});

describe("the HTTP HMR relay's edit to Vite's client", () => {
  const relayPlugin = () =>
    new Function(`return ${previewHttpHmrPluginSource()};`)() as {
      transform(code: string, id: string): { code: string } | null;
    };
  const viteClient = () => {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve("vite/package.json"));
    const id = join(root, "dist/client/client.mjs");
    return { id, code: readFileSync(id, "utf8") };
  };

  it("applies to the pinned Vite client, and has it say when a hot update failed", () => {
    const { id, code } = viteClient();
    const transformed = relayPlugin().transform(code, id)!.code;

    expect(transformed).toContain("globalThis.__morphApplyViteHmrPayload");
    expect(transformed).toContain(
      `warnFailedUpdate(err, path) { try { globalThis.dispatchEvent(new Event(${JSON.stringify(THEME_PREVIEW_HMR_FAILED_EVENT)})); } catch {}`,
    );
  });

  it("refuses a client it no longer recognises rather than serve it unedited", () => {
    const { id, code } = viteClient();
    for (const changed of [
      code.replace("warnFailedUpdate(err, path) {", "warnFailedUpdate(e, p) {"),
      code.replace(
        "transport.connect(createHMRHandler(handleMessage));",
        "transport.connect(handleMessage);",
      ),
    ]) {
      expect(() => relayPlugin().transform(changed, id)).toThrow(
        "MORPH_PREVIEW_HMR_CLIENT_CONTRACT_CHANGED",
      );
    }
  });

  it("refuses a client where an edit would have two places to land", () => {
    const { id, code } = viteClient();
    expect(() =>
      relayPlugin().transform(
        `${code}
class Other { warnFailedUpdate(err, path) {} }`,
        id,
      ),
    ).toThrow("MORPH_PREVIEW_HMR_CLIENT_CONTRACT_CHANGED");
  });

  it("leaves every other module alone", () => {
    expect(
      relayPlugin().transform("warnFailedUpdate(err, path) {}", "/src/x.ts"),
    ).toBeNull();
  });
});
