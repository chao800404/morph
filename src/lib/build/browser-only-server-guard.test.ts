import { describe, expect, it } from "vitest";
import type { Plugin } from "vite";
import {
  browserOnlyServerGuard,
  findBrowserOnlyFiles,
  findBrowserOnlyModules,
} from "./browser-only-server-guard";

const ROOT = "/repo";
const PNPM = `${ROOT}/node_modules/.pnpm`;

function plugins() {
  const [stub, guard] = browserOnlyServerGuard() as [Plugin, Plugin];
  return { stub, guard };
}

describe("findBrowserOnlyModules", () => {
  it("finds Monaco, its React wrapper and the runtime, however they are addressed", () => {
    expect(
      findBrowserOnlyModules([
        `${PNPM}/monaco-editor@0.55.1/node_modules/monaco-editor/esm/vs/editor/editor.api.js`,
        `${PNPM}/monaco-editor@0.55.1/node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker`,
        `${PNPM}/@monaco-editor+loader@1.7.0/node_modules/@monaco-editor/loader/lib/es/index.js`,
        `${ROOT}/src/routes/_editor/-components/editor-code-monaco-runtime.ts`,
        `\0${ROOT}/node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css?inline`,
      ]).map(({ label }) => label),
    ).toEqual([
      "monaco-editor",
      "monaco-editor",
      "@monaco-editor/*",
      "editor-code-monaco-runtime",
      "monaco-editor",
    ]);
  });

  it("passes the workspace, the loader, the stub and code that only names Monaco", () => {
    expect(
      findBrowserOnlyModules([
        `${ROOT}/src/routes/_editor/-components/editor-code-workspace.tsx`,
        `${ROOT}/src/routes/_editor/-components/editor-code-monaco-loader.ts`,
        `${ROOT}/src/routes/_editor/-components/editor-code-monaco-status.tsx`,
        `${ROOT}/src/routes/_editor/-components/editor-code-language-support.ts`,
        "\0morph:browser-only-stub:editor-code-monaco-runtime",
        `${PNPM}/react@19.2.1/node_modules/react/index.js`,
      ]),
    ).toEqual([]);
  });
});

describe("findBrowserOnlyFiles", () => {
  it("finds the worker bundles and the codicon font Monaco's build emits", () => {
    expect(
      findBrowserOnlyFiles([
        "assets/editor.worker-CdQrwHl8.js",
        "assets/ts.worker-BIGweoR_.js",
        "assets/css.worker-DBVD8oXr.js",
        "assets/html.worker-CwpTb9lJ.js",
        "assets/json.worker-BoL8UZqY.js",
        "assets/codicon-ngg6Pgfi.ttf",
      ]).map(({ label }) => label),
    ).toEqual([
      ...Array(5).fill("Monaco worker"),
      "Monaco codicon font",
    ]);
  });

  it("passes the server's own workers and chunks", () => {
    expect(
      findBrowserOnlyFiles([
        "index.js",
        "assets/worker-entry-BzVGfUb5.js",
        "assets/theme-worker-deployer.factory-D7rbrOSY.js",
        "assets/sandbox-wrangler-theme-worker-deployer-Dv2de2_q.js",
        "assets/workers-DH4IZ1Bi.js",
      ]),
    ).toEqual([]);
  });
});

describe("browserOnlyServerGuard", () => {
  type Hook = (
    this: { error: (message: string) => never; getModuleIds: () => Iterable<string> },
    options: unknown,
    bundle: Record<string, unknown>,
  ) => void;

  const SERVER = `${ROOT}/src/server.ts`;
  const STUB = "\0morph:browser-only-stub:editor-code-monaco-runtime";
  const chunk = (code = "export {}", moduleIds: string[] = [SERVER]) => ({
    type: "chunk",
    code,
    moduleIds,
  });

  function run(graph: string[], bundle: Record<string, unknown>) {
    const hook = (plugins().guard.generateBundle as { handler: Hook }).handler;
    const errors: string[] = [];
    const context = {
      getModuleIds: () => graph,
      error: (message: string): never => {
        errors.push(message);
        throw new Error(message);
      },
    };
    try {
      hook.call(context, {}, bundle);
    } catch {
      // Recorded above.
    }
    return errors;
  }

  it("works on the server environment only", () => {
    const { stub, guard } = plugins();
    for (const plugin of [stub, guard]) {
      const applies = plugin.applyToEnvironment as (env: {
        name: string;
      }) => boolean;
      expect(applies({ name: "ssr" })).toBe(true);
      expect(applies({ name: "client" })).toBe(false);
    }
    expect(guard.apply).toBe("build");
    expect(stub.apply).toBeUndefined();
  });

  it("resolves the runtime to a stub that throws if the server ever runs it", () => {
    const { stub } = plugins();
    const resolveId = stub.resolveId as (source: string) => string | null;
    const load = stub.load as (id: string) => string | null;
    for (const source of [
      "./editor-code-monaco-runtime",
      "./editor-code-monaco-runtime.ts",
      "/src/routes/_editor/-components/editor-code-monaco-runtime.ts?t=1",
    ]) {
      const id = resolveId(source);
      expect(id).toBe(STUB);
      expect(load(id!)).toContain("throw new Error");
    }
    expect(resolveId("./editor-code-monaco-loader")).toBeNull();
    expect(load(SERVER)).toBeNull();
  });

  it("fails a server build that loaded Monaco, even where no chunk kept it", () => {
    const errors = run(
      [
        SERVER,
        `${PNPM}/monaco-editor@0.55.1/node_modules/monaco-editor/esm/vs/editor/editor.api.js`,
      ],
      { "index.js": chunk() },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "1 browser-only module(s) or file(s) reached the server build",
    );
    expect(errors[0]).toContain("editor.api.js");
  });

  it("drops the Monaco workers Vite re-emits into the server bundle when nothing names them", () => {
    const bundle: Record<string, unknown> = {
      "index.js": chunk(),
      "assets/ts.worker-BIGweoR_.js": { type: "asset" },
      "assets/editor.worker-CdQrwHl8.js": { type: "asset" },
      "assets/worker-entry-BzVGfUb5.js": chunk(),
    };
    expect(run([SERVER, STUB], bundle)).toEqual([]);
    expect(Object.keys(bundle)).toEqual([
      "index.js",
      "assets/worker-entry-BzVGfUb5.js",
    ]);
  });

  it("fails a server bundle whose chunk names a Monaco worker", () => {
    const bundle: Record<string, unknown> = {
      "index.js": chunk('new Worker(new URL("./ts.worker-BIGweoR_.js", import.meta.url))'),
      "assets/ts.worker-BIGweoR_.js": { type: "asset" },
    };
    const errors = run([SERVER], bundle);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      "Monaco worker, named by a server chunk: assets/ts.worker-BIGweoR_.js",
    );
  });

  it("passes a server build without Monaco", () => {
    expect(
      run([SERVER, STUB], {
        "index.js": chunk(),
        "assets/worker-entry-BzVGfUb5.js": chunk(),
      }),
    ).toEqual([]);
  });
});
