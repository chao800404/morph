import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  THEME_MORPH_SDK_MODULES,
  themeMorphSdkFiles,
} from "../compiler/theme-morph-sdk";
import { THEME_START_TOOLCHAIN } from "../compiler/theme-start-toolchain";
import {
  COMPUTED_SPECIFIER,
  NATIVE_PROOF_VERSION,
  nativeHtmlAssets,
  nativeProductionAdmission,
  nativeResolutionPluginSource,
  nativeSdkSentinel,
  nativeStartSdkFiles,
  readNativeBuildProof,
  sourceSdkImports,
  verifyNativeStartSdkProof,
} from "./native-start-proof";

/**
 * Morph's own check of a native Start build's SDK resolution, against the
 * records the build's plugin wrote, the bytes it wrote and the Theme's
 * sources. Each tamper case is something a Vite config can do to
 * `@morph/sdk`; the real builds are native-start-build.test.ts.
 */
const NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const DIRECTORIES = { server: "dist/server", client: "dist/client" };
const START = "@morph/sdk/start";
const START_FILE = THEME_MORPH_SDK_MODULES[START]!;
const CONTENT = "src/morph/content.ts";
const sentinelStatement = (specifier: string, nonce = NONCE) =>
  `Reflect.set(globalThis,Symbol.for("morph.sdk.sentinel"),${JSON.stringify(nativeSdkSentinel(nonce, specifier))});`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

type Edge = {
  importer: string;
  specifier: string;
  kind: "static" | "dynamic";
  resolved: Record<string, unknown> | null;
  external: boolean;
  inGraph: boolean;
};

const edge = (overrides: Partial<Edge> = {}): Edge => ({
  importer: CONTENT,
  specifier: START,
  kind: "static",
  resolved: { path: START_FILE, query: "" },
  external: false,
  inGraph: true,
  ...overrides,
});

type Chunk = {
  file: string;
  code: string;
  modules: string[];
  isEntry?: boolean;
  /** Written on disk instead of `code` (a later rewrite); null: not written. */
  onDisk?: string | null;
};

type RecordName =
  | "resolution.client"
  | "resolution.ssr"
  | "bundle.client"
  | "bundle.ssr";

const DEFAULT_SERVER: Chunk[] = [
  {
    file: "index.js",
    code: 'import "./assets/sdk.js";export default {};',
    modules: [CONTENT],
    isEntry: true,
  },
  {
    file: "assets/sdk.js",
    code: `export const morph={};${sentinelStatement(START)}`,
    modules: [START_FILE],
  },
];

/**
 * What the build left. By default the Worker's entry chunk holds the
 * Theme's content module and statically imports the chunk holding Morph's
 * `@morph/sdk/start`, which carries its sentinel; the browser has one entry
 * and no SDK.
 */
function build(
  options: {
    server?: Chunk[];
    client?: Chunk[];
    serverEdges?: Edge[];
    clientEdges?: Edge[];
    serverRecord?: Record<string, unknown>;
    clientRecord?: Record<string, unknown>;
    serverBundle?: Record<string, unknown>;
    sources?: Record<string, string>;
    extraOutputs?: Record<string, string>;
    omit?: RecordName[];
  } = {},
) {
  const server = options.server ?? DEFAULT_SERVER;
  const client = options.client ?? [
    { file: "assets/main.js", code: "console.log(1);", modules: [], isEntry: true },
  ];
  const outputs = new Map<string, string>(
    Object.entries({
      [CONTENT]:
        'import { morph } from "@morph/sdk/start";\nexport const read = () => morph.pages.get("/");\n',
      ...options.sources,
      ...options.extraOutputs,
    }),
  );
  const resolution = (
    environment: string,
    outDir: string,
    edges: Edge[],
    modules: string[],
    overrides: Record<string, unknown> | undefined,
  ) =>
    JSON.stringify({
      nonce: NONCE,
      environment,
      consumer: outDir === DIRECTORIES.client ? "client" : "server",
      outDir,
      publicDir: outDir === DIRECTORIES.client ? "public" : null,
      vite: THEME_START_TOOLCHAIN.vite,
      rollup: "4.59.0",
      edges,
      unparsed: [],
      computed: [],
      modules,
      ...overrides,
    });
  const bundle = (
    environment: string,
    outDir: string,
    chunks: Chunk[],
    overrides?: Record<string, unknown>,
  ) =>
    JSON.stringify({
      nonce: NONCE,
      environment,
      outDir,
      chunks: chunks.map((chunk) => ({
        fileName: chunk.file,
        isEntry: chunk.isEntry ?? false,
        isDynamicEntry: false,
        modules: chunk.modules,
        sha256: hash(chunk.code),
      })),
      ...overrides,
    });
  const omit = new Set(options.omit ?? []);
  const write = (path: string, content: string, name: RecordName) => {
    if (!omit.has(name)) outputs.set(path, content);
  };
  const modulesOf = (chunks: Chunk[]) => chunks.flatMap((chunk) => chunk.modules);
  write(
    ".morph/records/resolution.ssr.json",
    resolution(
      "ssr",
      DIRECTORIES.server,
      options.serverEdges ?? [edge()],
      [...new Set([...modulesOf(server), CONTENT])],
      options.serverRecord,
    ),
    "resolution.ssr",
  );
  write(
    ".morph/records/resolution.client.json",
    resolution(
      "client",
      DIRECTORIES.client,
      options.clientEdges ?? [],
      modulesOf(client),
      options.clientRecord,
    ),
    "resolution.client",
  );
  write(
    ".morph/records/bundle.ssr.json",
    bundle("ssr", DIRECTORIES.server, server, options.serverBundle),
    "bundle.ssr",
  );
  write(
    ".morph/records/bundle.client.json",
    bundle("client", DIRECTORIES.client, client),
    "bundle.client",
  );
  for (const [outDir, chunks] of [
    [DIRECTORIES.server, server],
    [DIRECTORIES.client, client],
  ] as const) {
    for (const chunk of chunks) {
      if (chunk.onDisk === null) continue;
      outputs.set(`${outDir}/${chunk.file}`, chunk.onDisk ?? chunk.code);
    }
  }
  return outputs;
}

/** The build's prepared inputs, by default the sources the outputs hold. */
const inputsOf = (outputs: Map<string, string>) =>
  new Map(
    [...outputs].filter(
      ([path]) => path.startsWith("src/") || path.startsWith("public/"),
    ),
  );

const verify = (
  outputs: Map<string, string>,
  nonce = NONCE,
  sources: ReadonlyMap<string, string> = inputsOf(outputs),
) =>
  verifyNativeStartSdkProof({
    outputs,
    directories: DIRECTORIES,
    nonce,
    workerEntry: "dist/server/index.js",
    sources,
  });

const refusal = (
  outputs: Map<string, string>,
  sources?: ReadonlyMap<string, string>,
) => {
  try {
    verify(outputs, NONCE, sources);
  } catch (error) {
    return (error as Error).message;
  }
  return null;
};

/** A Vite Web Worker bundle's records, and its chunk on disk. */
const withWorker = (
  outputs: Map<string, string>,
  worker: {
    code: string;
    edges?: Edge[];
    record?: boolean;
    /** Which worker build (1 by default). */
    index?: number;
    /** Written as a file of the browser output (an inline worker is not). */
    onDisk?: boolean;
    modules?: string[];
  },
) => {
  const index = worker.index ?? 1;
  const file = `assets/worker-${index}.js`;
  if (worker.onDisk !== false) {
    outputs.set(`${DIRECTORIES.client}/${file}`, worker.code);
  }
  if (worker.record === false) return outputs;
  outputs.set(
    `.morph/records/resolution.client__worker${index}.json`,
    JSON.stringify({
      worker: index,
      nonce: NONCE,
      environment: "client",
      consumer: "client",
      outDir: "dist",
      publicDir: "public",
      vite: THEME_START_TOOLCHAIN.vite,
      rollup: "4.59.0",
      edges: worker.edges ?? [],
      unparsed: [],
      computed: [],
      modules: [],
    }),
  );
  outputs.set(
    `.morph/records/bundle.client__worker${index}.json`,
    JSON.stringify({
      worker: index,
      nonce: NONCE,
      environment: "client",
      outDir: "dist",
      chunks: [
        {
          fileName: file,
          isEntry: true,
          isDynamicEntry: false,
          modules:
            worker.modules ??
            (worker.edges?.length ? ["src/workers/sdk.ts", START_FILE] : []),
          sha256: hash(worker.code),
        },
      ],
    }),
  );
  return outputs;
};

const NO_SDK_SERVER: Chunk[] = [
  { file: "index.js", code: "export default {};", modules: [CONTENT], isEntry: true },
];

describe("a native Start build's SDK resolution proof", () => {
  it("is accepted when each edge resolves to Morph's copy and the importing chunk reaches the chunk carrying its sentinel", () => {
    expect(verify(build())).toEqual({
      vite: THEME_START_TOOLCHAIN.vite,
      publicDir: "public",
      environments: [
        { name: "client", output: "client", specifiers: [], edges: 0, sentinelFiles: [] },
        {
          name: "ssr",
          output: "server",
          specifiers: [START],
          edges: 1,
          sentinelFiles: ["runtime/server/assets/sdk.js"],
        },
      ],
    });
  });

  it("refuses a redirected alias, naming the edge and where it resolved", () => {
    expect(
      refusal(build({ serverEdges: [edge({ resolved: { path: "src/fake-sdk.ts" } })] })),
    ).toBe(
      "NATIVE_PROOF_SDK_RESOLUTION: vite.config.ts changes where @morph/sdk/start resolves (src/morph/content.ts, ssr environment: resolved to src/fake-sdk.ts). Remove the alias or plugin.",
    );
    expect(refusal(build({ serverEdges: [edge({ resolved: { outside: true } })] }))).toMatch(
      /resolved to a file outside the Theme\)/,
    );
    expect(refusal(build({ serverEdges: [edge({ resolved: { virtual: true } })] }))).toMatch(
      /resolved to a module a plugin made\)/,
    );
  });

  it("refuses a dynamic import a resolveDynamicImport hook redirected, even beside a static import of the same name", () => {
    expect(
      refusal(
        build({
          serverEdges: [edge(), edge({ kind: "dynamic", inGraph: false })],
        }),
      ),
    ).toMatch(
      /changes where @morph\/sdk\/start resolves \(src\/morph\/content\.ts, ssr environment, dynamic import: resolved to \.morph\/sdk\/start\/index\.ts, which is not the module the build bundled\)/,
    );
  });

  it("refuses an SDK left external, from the record and from the bytes of a reachable chunk", () => {
    expect(
      refusal(build({ serverEdges: [edge({ external: true, resolved: { bare: START } })] })),
    ).toMatch(
      /vite\.config\.ts leaves "@morph\/sdk\/start" external \(src\/morph\/content\.ts, ssr environment\)/,
    );
    for (const code of [
      'import{morph as o}from"@morph/sdk/start";o();',
      'export * from "@morph/sdk";',
      "const m=await import(`@morph/sdk/start`);",
      'import "@morph/sdk/section-gate";',
    ]) {
      expect(
        refusal(build({ client: [{ file: "assets/main.js", code, modules: [], isEntry: true }] })),
        code,
      ).toMatch(
        /^NATIVE_PROOF_SDK_RESOLUTION: runtime\/client\/assets\/main\.js still imports "@morph\/sdk(\/start|\/section-gate)?" at run time/,
      );
    }
  });

  it("does not mistake a string for an import", () => {
    expect(
      refusal(
        build({
          client: [
            {
              file: "assets/main.js",
              code: 'const sample = "import { morph } from \\"@morph/sdk/start\\"";console.log(sample);',
              modules: [],
              isEntry: true,
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("checks every shipped script, not only those an entry reaches", () => {
    // A recorded chunk nothing imports can still be loaded: a Worker imports
    // any module it was deployed with, a browser any file it is served.
    expect(
      refusal(
        build({
          client: [
            { file: "assets/main.js", code: "console.log(1);", modules: [], isEntry: true },
            { file: "assets/orphan.js", code: 'import "@morph/sdk";', modules: [] },
          ],
        }),
      ),
    ).toMatch(/runtime\/client\/assets\/orphan\.js still imports "@morph\/sdk" at run time/);
  });

  it("refuses a shipped script the bundler did not emit, and an import of one", () => {
    // Written into the Worker's output by a plugin, not in the record.
    expect(
      refusal(
        build({ extraOutputs: { "dist/server/assets/extra.js": 'export * from "@morph/sdk";' } }),
      ),
    ).toBe(
      "NATIVE_PROOF_SDK_RESOLUTION: runtime/server/assets/extra.js is not code the bundler emitted for this output, so Morph cannot vouch for it. A Vite plugin writes it into the output; remove it.",
    );
    // The recorded entry imports a file that is not shipped at all.
    expect(
      refusal(
        build({
          server: [
            {
              file: "index.js",
              code: 'import "./assets/sdk.js";import "./assets/missing.js";export default {};',
              modules: [CONTENT],
              isEntry: true,
            },
            DEFAULT_SERVER[1]!,
          ],
        }),
      ),
    ).toMatch(
      /runtime\/server\/index\.js imports runtime\/server\/assets\/missing\.js, which is not code the bundler emitted/,
    );
  });

  it("admits a Vite Web Worker bundle its own records cover, and proves its SDK edges", () => {
    expect(
      refusal(withWorker(build(), { code: "self.onmessage=(e)=>self.postMessage(e.data);" })),
    ).toBeNull();
    // The worker imports the SDK: its bundle must carry the sentinel.
    const sdkWorker = withWorker(build(), {
      code: `const morph={};${sentinelStatement(START)}self.onmessage=()=>self.postMessage(String(morph));`,
      edges: [edge({ importer: "src/workers/sdk.ts" })],
    });
    expect(verify(sdkWorker).environments[0]).toMatchObject({
      name: "client",
      output: "client",
      specifiers: [START],
      sentinelFiles: ["runtime/client/assets/worker-1.js"],
    });
    expect(
      refusal(
        withWorker(build(), {
          code: "self.onmessage=()=>{};",
          edges: [edge({ importer: "src/workers/sdk.ts" })],
        }),
      ),
    ).toMatch(
      /the client Web Worker 1 environment imports @morph\/sdk\/start \(src\/workers\/sdk\.ts\), but the code the build wrote for it does not reach Morph's copy of it/,
    );
    // The same bytes with no worker record are not vouched for.
    expect(
      refusal(withWorker(build(), { code: "self.onmessage=()=>{};", record: false })),
    ).toMatch(/runtime\/client\/assets\/worker-1\.js is not code the bundler emitted/);
  });

  it("proves an inline Web Worker (?worker&inline) from the string its parent chunk embeds", () => {
    const workerCode = `const morph={};${sentinelStatement(START)}self.onmessage=()=>self.postMessage(String(morph));`;
    const parent = `const jsContent = ${JSON.stringify(workerCode)};export const start=()=>new Worker(URL.createObjectURL(new Blob([jsContent])));`;
    const inline = withWorker(
      build({ client: [{ file: "assets/main.js", code: parent, modules: [], isEntry: true }] }),
      { code: workerCode, edges: [edge({ importer: "src/workers/sdk.ts" })], onDisk: false },
    );
    // The SDK is proven in the embedded code; the parent chunk is the file
    // that carries it.
    expect(verify(inline).environments[0]).toMatchObject({
      output: "client",
      specifiers: [START],
      sentinelFiles: ["runtime/client/assets/main.js"],
    });
    // Embedded code that is not the recorded bundle's is not this worker.
    const other = withWorker(
      build({
        client: [
          {
            file: "assets/main.js",
            code: `const jsContent = ${JSON.stringify(`${workerCode}//changed`)};`,
            modules: [],
            isEntry: true,
          },
        ],
      }),
      { code: workerCode, edges: [edge({ importer: "src/workers/sdk.ts" })], onDisk: false },
    );
    expect(refusal(other)).toMatch(
      /the client Web Worker 1 bundle was emitted, but no output holds its files or embeds its code/,
    );
    // An inline worker that imports an SDK name at run time is caught too.
    const externalCode = `import("@morph/sdk/start");self.onmessage=()=>self.postMessage("an inline worker payload long enough to be scanned");`;
    expect(
      refusal(
        withWorker(
          build({
            client: [
              {
                file: "assets/main.js",
                code: `const jsContent = ${JSON.stringify(externalCode)};`,
                modules: [],
                isEntry: true,
              },
            ],
          }),
          { code: externalCode, onDisk: false },
        ),
      ),
    ).toMatch(/still imports "@morph\/sdk\/start" at run time/);
  });

  it("proves reachability within each bundle: one worker's dead SDK import is not held to another worker's SDK chunk", () => {
    // Worker 1's dynamic SDK import was dropped as dead: its bundle holds
    // no SDK file. Worker 2 bundles the SDK. Pooled together, worker 1
    // would be required to reach worker 2's chunk.
    const twoWorkers = withWorker(
      withWorker(build(), {
        index: 1,
        code: "self.onmessage=()=>self.postMessage(1);",
        edges: [edge({ importer: "src/workers/dead.ts", kind: "dynamic" })],
        modules: ["src/workers/dead.ts"],
      }),
      {
        index: 2,
        code: `const morph={};${sentinelStatement(START)}self.onmessage=()=>self.postMessage(String(morph));`,
        edges: [edge({ importer: "src/workers/sdk.ts" })],
      },
    );
    expect(verify(twoWorkers).environments[0]).toMatchObject({
      output: "client",
      specifiers: [START],
      sentinelFiles: ["runtime/client/assets/worker-2.js"],
    });
  });

  it("admits a public copy only against the build's public input, not the public directory the build left", () => {
    const copy = "self.addEventListener('install', () => {});";
    // In the workspace after the build, but not one of the build's inputs.
    expect(
      refusal(
        build({ extraOutputs: { "public/sw.js": copy, "dist/client/sw.js": copy } }),
        inputsOf(build()),
      ),
    ).toMatch(/runtime\/client\/sw\.js is not code the bundler emitted for this output/);
    // The input says otherwise than the workspace: the input decides.
    expect(
      refusal(
        build({ extraOutputs: { "public/sw.js": copy, "dist/client/sw.js": copy } }),
        new Map([...inputsOf(build()), ["public/sw.js", `${copy}//input`]]),
      ),
    ).toMatch(/runtime\/client\/sw\.js is not code the bundler emitted for this output/);
  });

  it("reads a classic script copied from the public directory as a classic script, and still scans it", () => {
    // Valid only outside strict mode: duplicate parameters.
    const classic = "function pick(a, a) { return a; }\nwindow.pick = pick;\n";
    expect(
      refusal(
        build({
          extraOutputs: { "public/legacy.js": classic, "dist/client/legacy.js": classic },
        }),
      ),
    ).toBeNull();
    const loader = 'function load(a, a) { return import("@morph/sdk"); }\n';
    expect(
      refusal(
        build({
          extraOutputs: { "public/legacy.js": loader, "dist/client/legacy.js": loader },
        }),
      ),
    ).toMatch(/runtime\/client\/legacy\.js still imports "@morph\/sdk" at run time/);
    // Bundler output stays a module: the same sloppy code there is refused.
    expect(
      refusal(
        build({
          client: [{ file: "assets/main.js", code: classic, modules: [], isEntry: true }],
        }),
      ),
    ).toMatch(/dist\/client\/assets\/main\.js is not JavaScript Morph can read/);
  });

  it("reads the Worker graph's sources from the build's inputs, not the workspace the build left", () => {
    const importing =
      'import { morph } from "@morph/sdk/start";\nexport const read = () => morph;\n';
    // Rewritten during the build: the workspace copy no longer imports the
    // SDK, the input still does, and the final code has no edge.
    const rewritten = build({
      serverEdges: [],
      server: NO_SDK_SERVER,
      sources: { [CONTENT]: "export const read = () => null;\n" },
    });
    expect(refusal(rewritten, new Map([[CONTENT, importing]]))).toMatch(
      /src\/morph\/content\.ts imports @morph\/sdk\/start, but the code the ssr environment built from it does not/,
    );
    // Deleted during the build: still checked, from the input.
    const deleted = build({ serverEdges: [], server: NO_SDK_SERVER });
    deleted.delete(CONTENT);
    expect(refusal(deleted, new Map([[CONTENT, importing]]))).toMatch(
      /src\/morph\/content\.ts imports @morph\/sdk\/start, but the code the ssr environment built from it does not/,
    );
    // A Theme module of the Worker's graph the build was not given.
    expect(refusal(build(), new Map())).toBe(
      "NATIVE_PROOF_SDK_RESOLUTION: src/morph/content.ts is in the ssr environment's graph but is not one of the files the build was given. A Vite plugin writes it during the build; remove it.",
    );
  });

  it("admits a browser script copied unchanged from the public directory, and still scans it", () => {
    const copy = "self.addEventListener('install', () => {});";
    expect(
      refusal(build({ extraOutputs: { "public/sw.js": copy, "dist/client/sw.js": copy } })),
    ).toBeNull();
    expect(
      refusal(
        build({
          extraOutputs: {
            "public/sw.js": 'import "@morph/sdk";',
            "dist/client/sw.js": 'import "@morph/sdk";',
          },
        }),
      ),
    ).toMatch(/runtime\/client\/sw\.js still imports "@morph\/sdk" at run time/);
    // Changed on the way: not the author's file any more.
    expect(
      refusal(
        build({ extraOutputs: { "public/sw.js": copy, "dist/client/sw.js": `${copy}//x` } }),
      ),
    ).toMatch(/runtime\/client\/sw\.js is not code the bundler emitted/);
  });

  it("requires the deployed Worker entry to be a verified entry chunk", () => {
    expect(
      refusal(
        build({
          server: [
            { ...DEFAULT_SERVER[0]!, isEntry: false },
            { ...DEFAULT_SERVER[1]!, isEntry: true },
          ],
        }),
      ),
    ).toMatch(
      /the Worker's entry runtime\/server\/index\.js is not an entry chunk the bundler emitted/,
    );
  });

  it("matches the sentinel as Morph's statement, not as text anywhere in the chunk", () => {
    expect(
      refusal(
        build({
          server: [
            DEFAULT_SERVER[0]!,
            {
              file: "assets/sdk.js",
              code: `export const morph={};const note=${JSON.stringify(nativeSdkSentinel(NONCE, START))};`,
              modules: [START_FILE],
            },
          ],
        }),
      ),
    ).toMatch(/does not reach Morph's copy of it/);
  });

  it("refuses a computed SDK specifier left in the shipped code", () => {
    expect(
      refusal(
        build({
          client: [
            {
              file: "assets/main.js",
              code: "const n='start';import(`@morph/sdk/${n}`);",
              modules: [],
              isEntry: true,
            },
          ],
        }),
      ),
    ).toMatch(/still imports "<computed>" at run time/);
  });

  it("refuses a chunk whose bytes lack the sentinel (a load impostor), or carry another pass's", () => {
    for (const code of [
      "export const morph={};",
      `export const morph={};${sentinelStatement(START, "f".repeat(32))}`,
    ]) {
      expect(
        refusal(
          build({
            server: [DEFAULT_SERVER[0]!, { file: "assets/sdk.js", code, modules: [START_FILE] }],
          }),
        ),
      ).toMatch(
        /the ssr environment imports @morph\/sdk\/start \(src\/morph\/content\.ts\), but the code the build wrote for it does not reach Morph's copy of it/,
      );
    }
  });

  it("refuses a consumer redirected after bundling while Morph's copy sits in an unreached chunk (renderChunk)", () => {
    expect(
      refusal(
        build({
          server: [
            {
              file: "index.js",
              code: 'import "./assets/fake.js";export default {};',
              modules: [CONTENT],
              isEntry: true,
            },
            { file: "assets/fake.js", code: "export const morph={};", modules: [] },
            DEFAULT_SERVER[1]!,
          ],
        }),
      ),
    ).toMatch(/does not reach Morph's copy of it/);
  });

  it("refuses a chunk rewritten or removed after the bundle was generated (writeBundle)", () => {
    expect(
      refusal(
        build({
          server: [
            DEFAULT_SERVER[0]!,
            { ...DEFAULT_SERVER[1]!, onDisk: "export const morph={};" },
          ],
        }),
      ),
    ).toMatch(/assets\/sdk\.js in the ssr output is not the code the bundler emitted/);
    expect(
      refusal(build({ server: [DEFAULT_SERVER[0]!, { ...DEFAULT_SERVER[1]!, onDisk: null }] })),
    ).toMatch(/emitted assets\/sdk\.js, but the build did not write it/);
  });

  it("follows the import kind: a static edge needs a static path, a dynamic one may be lazy", () => {
    const lazy: Chunk[] = [
      {
        file: "index.js",
        code: 'const m=()=>import("./assets/sdk.js");export default {m};',
        modules: [CONTENT],
        isEntry: true,
      },
      DEFAULT_SERVER[1]!,
    ];
    const dynamicSource = {
      [CONTENT]: 'export const read = () => import("@morph/sdk/start");\n',
    };
    expect(
      refusal(
        build({ server: lazy, serverEdges: [edge({ kind: "dynamic" })], sources: dynamicSource }),
      ),
    ).toBeNull();
    expect(refusal(build({ server: lazy }))).toMatch(/does not reach Morph's copy of it/);
  });

  it("does not require a dynamic import the bundler removed as dead, and does require a static one", () => {
    const dynamicSource = {
      [CONTENT]: 'export const read = () => import("@morph/sdk/start");\n',
    };
    expect(
      refusal(
        build({
          server: NO_SDK_SERVER,
          serverEdges: [edge({ kind: "dynamic" })],
          sources: dynamicSource,
        }),
      ),
    ).toBeNull();
    expect(refusal(build({ server: NO_SDK_SERVER }))).toMatch(
      /imports @morph\/sdk\/start in the ssr environment, but Morph's copy of it is in no chunk the deployed code reaches/,
    );
  });

  it("refuses a Theme source whose SDK import a transform removed from the Worker's code", () => {
    expect(refusal(build({ serverEdges: [], server: NO_SDK_SERVER }))).toBe(
      "NATIVE_PROOF_SDK_RESOLUTION: src/morph/content.ts imports @morph/sdk/start, but the code the ssr environment built from it does not. A Vite plugin rewrites that import; remove it.",
    );
    // Types only: TypeScript drops the import, so no edge is expected.
    expect(
      refusal(
        build({
          serverEdges: [],
          server: NO_SDK_SERVER,
          sources: {
            [CONTENT]:
              'import { MorphPage } from "@morph/sdk";\nimport type { Morph } from "@morph/sdk/start";\nexport let page: MorphPage | null = null;\nexport type M = Morph;\n',
          },
        }),
      ),
    ).toBeNull();
  });

  it("refuses a missing record of either kind, another pass's, a foreign file, an empty nonce and a bundle without entries", () => {
    for (const omit of [
      "resolution.client",
      "resolution.ssr",
      "bundle.client",
      "bundle.ssr",
    ] as const) {
      expect(refusal(build({ omit: [omit] })), omit).toMatch(
        /the build wrote no (SDK resolution|bundle) record for its (browser|Worker) output/,
      );
    }
    expect(refusal(build({ serverRecord: { nonce: "0".repeat(32) } }))).toMatch(
      /resolution\.ssr\.json was not written by this build/,
    );
    expect(refusal(build({ serverBundle: { nonce: "0".repeat(32) } }))).toMatch(
      /bundle\.ssr\.json was not written by this build/,
    );
    expect(refusal(build({ extraOutputs: { ".morph/records/other.json": "{}" } }))).toMatch(
      /\.morph\/records\/other\.json, which is not one of Morph's records/,
    );
    expect(() => verify(build(), "")).toThrow(/this build pass has no nonce/);
    // A record that leaves out what was shipped vouches for none of it.
    expect(refusal(build({ serverBundle: { chunks: [] } }))).toMatch(
      /runtime\/server\/(index|assets\/sdk)\.js is not code the bundler emitted/,
    );
  });

  it("refuses code it cannot read, a computed SDK specifier, a name that is not an entry, and an uncertified Vite", () => {
    expect(refusal(build({ serverRecord: { unparsed: ["src/routes/x.tsx"] } }))).toMatch(
      /src\/routes\/x\.tsx names @morph\/sdk in code Morph cannot read/,
    );
    expect(
      refusal(
        build({ serverRecord: { computed: [{ importer: "src/routes/x.tsx", kind: "dynamic" }] } }),
      ),
    ).toMatch(/src\/routes\/x\.tsx imports @morph\/sdk through a specifier computed at run time/);
    expect(refusal(build({ serverEdges: [edge({ specifier: "@morph/sdk/other" })] }))).toMatch(
      /imports "@morph\/sdk\/other", which is not a Morph SDK entry/,
    );
    expect(refusal(build({ serverRecord: { vite: "8.0.0" } }))).toMatch(
      `ran Vite 8.0.0, not the certified ${THEME_START_TOOLCHAIN.vite}`,
    );
  });
});

describe("a Theme source's SDK imports, as compiled code keeps them", () => {
  it("keeps value, side-effect, re-export and dynamic imports, and drops type-only ones in TypeScript", () => {
    expect(
      sourceSdkImports(
        "src/a.tsx",
        [
          'import { morph } from "@morph/sdk/start";',
          'import { MorphPage } from "@morph/sdk";',
          'import type { Morph } from "@morph/sdk/astro";',
          'import "@morph/sdk/section-gate";',
          'export { createMorph } from "@morph/sdk";',
          "export const a = (p: MorphPage) => <p>{String(morph)}</p>;",
          'export const b = () => import("@morph/sdk/start");',
        ].join("\n"),
      ),
    ).toEqual([
      { specifier: "@morph/sdk/section-gate", kind: "static" },
      { specifier: "@morph/sdk", kind: "static" },
      { specifier: "@morph/sdk/start", kind: "static" },
      { specifier: "@morph/sdk/start", kind: "dynamic" },
    ]);
  });

  it("keeps an unused value import in JavaScript, which nothing drops", () => {
    expect(
      sourceSdkImports("src/a.js", 'import { morph } from "@morph/sdk/start";\n'),
    ).toEqual([{ specifier: "@morph/sdk/start", kind: "static" }]);
  });

  it("drops type-only re-exports, which TypeScript erases, and keeps a re-export with one value", () => {
    expect(
      sourceSdkImports(
        "src/a.ts",
        [
          'export { type MorphPage } from "@morph/sdk";',
          'export type { Morph } from "@morph/sdk/start";',
          'export type * from "@morph/sdk/astro";',
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      sourceSdkImports("src/a.ts", 'export { type MorphPage, isMorphError } from "@morph/sdk";'),
    ).toEqual([{ specifier: "@morph/sdk", kind: "static" }]);
  });

  it("reads dynamic template specifiers as the shipped-code check does", () => {
    expect(
      sourceSdkImports(
        "src/a.ts",
        "export const a = () => import(`@morph/sdk/start`);\nconst n = 'start';\nexport const b = () => import(`@morph/sdk/${n}`);\n",
      ),
    ).toEqual([
      { specifier: "@morph/sdk/start", kind: "dynamic" },
      { specifier: COMPUTED_SPECIFIER, kind: "dynamic" },
    ]);
  });

  it("is null for a file it cannot parse", () => {
    expect(sourceSdkImports("src/a.ts", "import {")).toBeNull();
  });
});

describe("the native Start build's SDK copy", () => {
  it("is the platform's copy, with one sentinel statement appended to each reserved entry", () => {
    const platform = themeMorphSdkFiles();
    const native = nativeStartSdkFiles(NONCE);
    expect(native.map((file) => file.path)).toEqual(platform.map((file) => file.path));
    const entries = new Set(Object.values(THEME_MORPH_SDK_MODULES));
    for (const [index, file] of native.entries()) {
      const original = platform[index]!;
      if (!entries.has(file.path)) {
        expect(file.content).toBe(original.content);
        continue;
      }
      expect(file.content.startsWith(original.content)).toBe(true);
      const specifier = Object.entries(THEME_MORPH_SDK_MODULES).find(
        ([, path]) => path === file.path,
      )![0];
      expect(file.content.slice(original.content.length)).toContain(
        `Reflect.set(globalThis, Symbol.for("morph.sdk.sentinel"), ${JSON.stringify(nativeSdkSentinel(NONCE, specifier))});`,
      );
    }
    expect(entries.size).toBe(4);
  });

  it("names a different sentinel for each entry and each pass", () => {
    const names = Object.keys(THEME_MORPH_SDK_MODULES).map((specifier) =>
      nativeSdkSentinel(NONCE, specifier),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(nativeSdkSentinel(NONCE, START)).toBe(`morph-sdk:start:${NONCE}:start`);
    expect(nativeSdkSentinel("b".repeat(32), START)).not.toBe(
      nativeSdkSentinel(NONCE, START),
    );
  });
});

describe("the resolution record plugin's identity", () => {
  it("is pinned: change NATIVE_PROOF_VERSION with the plugin once released, and record the hash", () => {
    expect({
      version: NATIVE_PROOF_VERSION,
      sha256: hash(nativeResolutionPluginSource()),
    }).toEqual({ version: "np-1", sha256: PLUGIN_SHA256 });
  });
});

describe("static HTML in a native artifact", () => {
  it("is listed with where it came from, by the public directory the build used", () => {
    const artifactFiles = new Map<string, string>([
      ["runtime/client/about/index.html", "<html>"],
      ["runtime/client/legal.HTM", "<html>"],
      ["runtime/client/_shell.html", "<html>"],
      ["runtime/client/assets/app.js", ""],
    ]);
    const outputs = new Map<string, string>([["static/legal.HTM", "<html>"]]);
    expect(nativeHtmlAssets({ artifactFiles, outputs, publicDir: "static" })).toEqual([
      { path: "runtime/client/_shell.html", source: "spa-shell" },
      { path: "runtime/client/about/index.html", source: "prerender" },
      { path: "runtime/client/legal.HTM", source: "public" },
    ]);
  });
});

const PROOF = {
  version: NATIVE_PROOF_VERSION,
  sdk: {
    environments: [
      { name: "client", output: "client", specifiers: [], edges: 0, sentinelFiles: [] },
      {
        name: "ssr",
        output: "server",
        specifiers: [START],
        edges: 1,
        sentinelFiles: ["runtime/server/assets/sdk.js"],
      },
    ],
  },
  toolchain: { vite: THEME_START_TOOLCHAIN.vite },
  html: [],
};
const withServer = (patch: Record<string, unknown>) => ({
  ...PROOF,
  sdk: {
    environments: [
      PROOF.sdk.environments[0],
      { ...PROOF.sdk.environments[1], ...patch },
    ],
  },
});

describe("a manifest's nativeProof, read back", () => {
  it("is the proof Morph wrote", () => {
    expect(readNativeBuildProof(JSON.parse(JSON.stringify(PROOF)))).toEqual(PROOF);
  });

  it.each([
    ["none", undefined],
    ["another version", { ...PROOF, version: "np-0" }],
    ["another Vite", { ...PROOF, toolchain: { vite: "8.0.0" } }],
    ["no Worker part", { ...PROOF, sdk: { environments: [PROOF.sdk.environments[0]] } }],
    [
      "two Worker parts",
      {
        ...PROOF,
        sdk: { environments: [...PROOF.sdk.environments, PROOF.sdk.environments[1]] },
      },
    ],
    ["an SDK edge with no sentinel file", withServer({ sentinelFiles: [] })],
    ["fewer edges than entries", withServer({ edges: 0 })],
    [
      "a sentinel file that is not JavaScript",
      withServer({ sentinelFiles: ["runtime/server/assets/app.css"] }),
    ],
    [
      "a sentinel file of the other part",
      withServer({ sentinelFiles: ["runtime/client/assets/sdk.js"] }),
    ],
    ["a name that is not an SDK entry", withServer({ specifiers: ["@morph/sdk/other"] })],
    ["a sentinel file without an entry", withServer({ specifiers: [], edges: 0 })],
    ["edges without the names they import", withServer({ specifiers: [], edges: 2, sentinelFiles: [] })],
    ["an HTML entry outside the assets", { ...PROOF, html: [{ path: "x.html", source: "public" }] }],
  ])("is null for %s", (_label, value) => {
    expect(readNativeBuildProof(value)).toBeNull();
  });
});

describe("the native production admission", () => {
  const files = (...extra: string[]) =>
    [
      "runtime/server/index.js",
      "runtime/server/assets/sdk.js",
      "runtime/client/assets/main.js",
      ...extra,
    ].map((path) => ({ path }));

  it("admits a consistent proof with its files and no HTML", () => {
    expect(
      nativeProductionAdmission({ runtime: { nativeProof: PROOF }, files: files() }),
    ).toBeNull();
  });

  it("refuses a missing or inconsistent proof, or one naming a file the artifact lacks", () => {
    for (const nativeProof of [undefined, withServer({ sentinelFiles: [] })]) {
      expect(
        nativeProductionAdmission({ runtime: { nativeProof }, files: files() })?.code,
      ).toBe("NATIVE_PROOF_MISSING");
    }
    expect(
      nativeProductionAdmission({
        runtime: { nativeProof: PROOF },
        files: [{ path: "runtime/server/index.js" }],
      })?.message,
    ).toContain(
      "it names runtime/server/assets/sdk.js, which the artifact does not hold",
    );
  });

  it("refuses static HTML at any depth and case, naming the file and the path it would be served at", () => {
    expect(
      nativeProductionAdmission({
        runtime: { nativeProof: PROOF },
        files: files("runtime/client/a/B.HTM"),
      }),
    ).toEqual({
      code: "NATIVE_HTML_ASSET_UNAVAILABLE",
      message:
        "NATIVE_HTML_ASSET_UNAVAILABLE: The build would serve runtime/client/a/B.HTM as /a/B.HTM. Static HTML is not published yet: the asset layer would answer it before the Theme Worker and Core. Remove the prerender setting, the SPA shell or the file.",
    });
  });
});

/** sha256 of `nativeResolutionPluginSource()`. */
const PLUGIN_SHA256 =
  "e5ee0ffb4983622cde34c2d115e290c615cb48878795219816dae41e9bd83d8e";
