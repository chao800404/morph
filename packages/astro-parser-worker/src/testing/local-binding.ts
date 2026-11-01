/**
 * Test support: the parser Worker and a stand-in for Core in one local workerd
 * (Miniflare, the runtime under `wrangler dev`), wired with a real service
 * binding, `ASTRO_PARSER`, exactly as Core's configuration names it. Nothing
 * here reaches the network or a Cloudflare account.
 *
 * `binding` is that service binding, handed to Node through Miniflare's
 * bindings proxy, so a test calls the parser the way Core does. `core` is the
 * stand-in Worker itself, for what Node cannot drive through the proxy: a
 * request body that keeps the stream open (see `CORE_STAND_IN`).
 *
 * Node-only; never imported by a Worker.
 */
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_readRawConfig } from "wrangler";

import { ASTRO_PARSER_WORKER_NAME } from "../contract";

export const PACKAGE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const WASM_SPECIFIER =
  "@astrojs/compiler-binding-wasm32-wasi/astro.wasm32-wasi.wasm";
const WASM_MODULE = "astro.wasm32-wasi.wasm";
const MODULES_ROOT = "/astro-parser";

/** The binding name Core's configuration declares. */
export const LOCAL_BINDING_NAME = "ASTRO_PARSER";

/**
 * The stand-in for Core. `POST /hold?ms=N` calls the parser with a body that
 * sends one element, then keeps the stream open for N ms before closing it:
 * the parser takes its slot before reading, so this holds the slot that long.
 * It answers with the parser's status and payload.
 */
const CORE_STAND_IN = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/hold") return new Response("not found", { status: 404 });
    const ms = Number(url.searchParams.get("ms") ?? "0");
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    writer.write(new TextEncoder().encode("<p>held</p>"));
    setTimeout(() => writer.close().catch(() => {}), ms);
    const response = await env.${LOCAL_BINDING_NAME}.fetch(
      "https://astro-parser/parse/v1?mode=outline",
      { method: "POST", body: readable },
    );
    return new Response(await response.text(), { status: response.status });
  },
};
`;

export interface AstroParserBindingLike {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface LocalAstroParser {
  binding: AstroParserBindingLike;
  /** Fetches the Core stand-in (only `/hold`). */
  core(path: string, init?: RequestInit): Promise<Response>;
  /** The JSON log lines both Workers wrote so far, parsed. */
  logs(): Record<string, unknown>[];
  dispose(): Promise<void>;
}

/** The parser's compatibility settings, from its own wrangler.jsonc. */
export function astroParserCompat(): {
  compatibilityDate: string;
  compatibilityFlags: string[];
} {
  const { rawConfig } = experimental_readRawConfig({
    config: join(PACKAGE_DIR, "wrangler.jsonc"),
  });
  return {
    compatibilityDate: rawConfig.compatibility_date!,
    compatibilityFlags: rawConfig.compatibility_flags ?? [],
  };
}

/** Bundles `src/worker.ts` the way the Worker runtime resolves packages. */
export async function bundleAstroParserWorker(): Promise<string> {
  const result = await build({
    entryPoints: [join(PACKAGE_DIR, "src", "worker.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    logLevel: "silent",
    plugins: [
      {
        name: "compiled-wasm",
        setup(build) {
          build.onResolve({ filter: /\.wasm$/ }, (args) =>
            args.path === WASM_SPECIFIER
              ? { path: `./${WASM_MODULE}`, external: true }
              : undefined,
          );
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

export function astroParserWasmBytes(): Uint8Array {
  const require = createRequire(join(PACKAGE_DIR, "package.json"));
  return readFileSync(require.resolve(WASM_SPECIFIER));
}

export async function startLocalAstroParser(): Promise<LocalAstroParser> {
  const [script, wasm] = [
    await bundleAstroParserWorker(),
    astroParserWasmBytes(),
  ];
  // The Core stand-in runs with the parser's settings, which a test in Core
  // keeps equal to Core's own.
  const compat = astroParserCompat();
  const lines: string[] = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      // Kept rather than printed: one JSON line per request would bury the
      // test output. Warnings and errors still go to stderr.
      handleStructuredLogs({ level, message }) {
        if (level === "log" || level === "info") lines.push(message);
        else process.stderr.write(`[astro-parser ${level}] ${message}\n`);
      },
      workers: [
        {
          name: "core",
          modules: true,
          script: CORE_STAND_IN,
          ...compat,
          serviceBindings: { [LOCAL_BINDING_NAME]: ASTRO_PARSER_WORKER_NAME },
        },
        {
          name: ASTRO_PARSER_WORKER_NAME,
          modulesRoot: MODULES_ROOT,
          modules: [
            {
              type: "ESModule",
              path: `${MODULES_ROOT}/worker.mjs`,
              contents: script,
            },
            {
              type: "CompiledWasm",
              path: `${MODULES_ROOT}/${WASM_MODULE}`,
              contents: wasm,
            },
          ],
          ...compat,
        },
      ],
    }),
  );
  try {
    const url = await mf.ready;
    const bindings = await mf.getBindings<Record<string, unknown>>("core");
    const binding = bindings[LOCAL_BINDING_NAME] as AstroParserBindingLike;
    return {
      binding,
      core: (path, init) => fetch(new URL(path, url), init),
      logs: () =>
        lines.flatMap((line) => {
          const json = line.slice(line.indexOf("{"));
          try {
            return [JSON.parse(json) as Record<string, unknown>];
          } catch {
            return [];
          }
        }),
      dispose: () => mf.dispose(),
    };
  } catch (error) {
    await mf.dispose().catch(() => {});
    throw error;
  }
}
