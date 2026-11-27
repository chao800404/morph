import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  THEME_MORPH_SDK_MODULES,
  themeMorphSdkFiles,
} from "../compiler/theme-morph-sdk";
import { THEME_START_TOOLCHAIN } from "../compiler/theme-start-toolchain";
import {
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

const verify = (outputs: Map<string, string>, nonce = NONCE) =>
  verifyNativeStartSdkProof({ outputs, directories: DIRECTORIES, nonce });

const refusal = (outputs: Map<string, string>) => {
  try {
    verify(outputs);
  } catch (error) {
    return (error as Error).message;
  }
  return null;
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

  it("does not mistake a string for an import, nor scan a chunk nothing deployed reaches", () => {
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
            { file: "assets/orphan.js", code: 'import "@morph/sdk";', modules: [] },
          ],
        }),
      ),
    ).toBeNull();
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
    ).toMatch(/is in no chunk the deployed code reaches/);
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
    expect(refusal(build({ serverBundle: { chunks: [] } }))).toMatch(/has no entry chunk/);
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
  "c6df6a1bea168fa01d7ee6ede6f6160d26d8e2912bee44a97474481da6dbe1d7";
