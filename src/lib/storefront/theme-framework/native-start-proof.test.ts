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
  nativeResolutionPluginSource,
  nativeSdkSentinel,
  nativeStartSdkFiles,
  readNativeBuildProof,
  verifyNativeStartSdkProof,
} from "./native-start-proof";

/**
 * Morph's own check of a native Start build's SDK resolution, against the
 * records the build's plugin wrote and the bytes it wrote. Each tamper case
 * is what a Vite config can do to `@morph/sdk`; the real builds are
 * native-start-build.test.ts.
 */
const NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const DIRECTORIES = { server: "dist/server", client: "dist/client" };
const START = "@morph/sdk/start";
const START_FILE = THEME_MORPH_SDK_MODULES[START]!;

type Edge = {
  importer: string;
  specifier: string;
  resolved: Record<string, unknown> | null;
  external: boolean;
  inGraph: boolean;
};

const edge = (overrides: Partial<Edge> = {}): Edge => ({
  importer: "src/morph/content.ts",
  specifier: START,
  resolved: { path: START_FILE },
  external: false,
  inGraph: true,
  ...overrides,
});

const record = (
  environment: string,
  outDir: string,
  edges: Edge[],
  overrides: Record<string, unknown> = {},
) =>
  JSON.stringify({
    nonce: NONCE,
    environment,
    consumer: outDir === DIRECTORIES.client ? "client" : "server",
    outDir,
    vite: THEME_START_TOOLCHAIN.vite,
    rollup: "4.59.0",
    edges,
    unparsed: [],
    sdkModules: edges.length > 0 ? [START_FILE] : [],
    ...overrides,
  });

/** What the build left: one record per environment, and the artifact. */
function build(
  options: {
    client?: Edge[];
    server?: Edge[];
    clientRecord?: Record<string, unknown>;
    serverRecord?: Record<string, unknown>;
    clientScript?: string;
    serverScript?: string;
    extraOutputs?: Record<string, string>;
    omit?: "client" | "server";
  } = {},
) {
  const client = options.client ?? [];
  const server = options.server ?? [edge()];
  const outputs = new Map<string, string>(
    Object.entries(options.extraOutputs ?? {}),
  );
  if (options.omit !== "client") {
    outputs.set(
      ".morph/records/resolution.client.json",
      record("client", DIRECTORIES.client, client, options.clientRecord),
    );
  }
  if (options.omit !== "server") {
    outputs.set(
      ".morph/records/resolution.ssr.json",
      record("ssr", DIRECTORIES.server, server, options.serverRecord),
    );
  }
  const artifactFiles = new Map<string, string>([
    [
      "runtime/server/index.js",
      options.serverScript ??
        `export default {};Reflect.set(globalThis,Symbol.for("morph.sdk.sentinel"),${JSON.stringify(nativeSdkSentinel(NONCE, START))});`,
    ],
    ["runtime/client/assets/main.js", options.clientScript ?? "console.log(1);"],
  ]);
  return { outputs, artifactFiles };
}

const verify = (built: ReturnType<typeof build>, nonce = NONCE) =>
  verifyNativeStartSdkProof({
    ...built,
    directories: DIRECTORIES,
    nonce,
  });

describe("a native Start build's SDK resolution proof", () => {
  it("is accepted when every edge resolves to Morph's copy and each environment carries its sentinel", () => {
    expect(verify(build())).toEqual({
      vite: THEME_START_TOOLCHAIN.vite,
      environments: [
        {
          name: "client",
          output: "client",
          specifiers: [],
          edges: 0,
          sentinelFiles: [],
        },
        {
          name: "ssr",
          output: "server",
          specifiers: [START],
          edges: 1,
          sentinelFiles: ["runtime/server/index.js"],
        },
      ],
    });
  });

  it("accepts a browser graph that never imports the SDK, and requires the sentinel where one does", () => {
    // No client edge: nothing to find there (verified above). One client
    // edge: its sentinel must be in the client output.
    expect(() =>
      verify(build({ client: [edge({ importer: "src/routes/index.tsx" })] })),
    ).toThrow(
      /NATIVE_PROOF_SDK_RESOLUTION: the client environment imports @morph\/sdk\/start, but Morph's copy of it is not in the code the build wrote for it/,
    );
    const carried = verify(
      build({
        client: [edge({ importer: "src/routes/index.tsx" })],
        clientScript: `x;${JSON.stringify(nativeSdkSentinel(NONCE, START))}`,
      }),
    );
    expect(carried.environments[0]).toMatchObject({
      name: "client",
      sentinelFiles: ["runtime/client/assets/main.js"],
    });
  });

  it("refuses a redirected alias, naming the edge and where it resolved", () => {
    expect(() =>
      verify(build({ server: [edge({ resolved: { path: "src/fake-sdk.ts" } })] })),
    ).toThrow(
      'NATIVE_PROOF_SDK_RESOLUTION: vite.config.ts changes where @morph/sdk/start resolves (src/morph/content.ts, ssr environment: resolved to src/fake-sdk.ts). Remove the alias or plugin.',
    );
    expect(() =>
      verify(build({ server: [edge({ resolved: { outside: true } })] })),
    ).toThrow(/resolved to a file outside the Theme\)/);
    expect(() =>
      verify(build({ server: [edge({ resolved: { virtual: true } })] })),
    ).toThrow(/resolved to a module a plugin made\)/);
    expect(() => verify(build({ server: [edge({ resolved: null })] }))).toThrow(
      /resolved to nothing\)/,
    );
  });

  it("refuses an edge that resolves to Morph's copy but is not the module the graph bundled", () => {
    expect(() => verify(build({ server: [edge({ inGraph: false })] }))).toThrow(
      /resolved to \.morph\/sdk\/start\/index\.ts, which is not the module the build bundled\)/,
    );
  });

  it("refuses an externalised SDK, from the record", () => {
    expect(() =>
      verify(
        build({
          client: [
            edge({ external: true, resolved: { bare: START }, inGraph: true }),
          ],
        }),
      ),
    ).toThrow(
      /NATIVE_PROOF_SDK_RESOLUTION: vite\.config\.ts leaves "@morph\/sdk\/start" external \(src\/morph\/content\.ts, client environment\)/,
    );
  });

  it("refuses an externalised SDK from the bytes alone, whatever the record says", () => {
    for (const script of [
      'import{morph as o}from"@morph/sdk/start";o();',
      'export * from "@morph/sdk";',
      'const m=await import("@morph/sdk/start");',
      'import "@morph/sdk/section-gate";',
      'const m=require("@morph/sdk");',
    ]) {
      expect(() => verify(build({ clientScript: script })), script).toThrow(
        /NATIVE_PROOF_SDK_RESOLUTION: runtime\/client\/assets\/main\.js still imports "@morph\/sdk(\/start|\/section-gate)?" at run time/,
      );
    }
    // A string that merely names the SDK is not an import.
    expect(() =>
      verify(build({ clientScript: 'console.log("see @morph/sdk docs");' })),
    ).not.toThrow();
  });

  it("refuses a build whose bytes lack the sentinel the record says they need", () => {
    // A plugin's load hook served other code for Morph's copy, or dropped it.
    expect(() =>
      verify(build({ serverScript: "export default {};" })),
    ).toThrow(
      /the ssr environment imports @morph\/sdk\/start, but Morph's copy of it is not in the code the build wrote for it\. A Vite plugin replaces or drops that module; remove it\./,
    );
    // Another pass's sentinel does not count.
    expect(() =>
      verify(
        build({
          serverScript: JSON.stringify(nativeSdkSentinel("f".repeat(32), START)),
        }),
      ),
    ).toThrow(/Morph's copy of it is not in the code the build wrote/);
  });

  it("refuses a missing record for either part of the artifact", () => {
    expect(() => verify(build({ omit: "client" }))).toThrow(
      /the build wrote no SDK resolution record for its browser output/,
    );
    expect(() => verify(build({ omit: "server" }))).toThrow(
      /the build wrote no SDK resolution record for its Worker output/,
    );
    // A record for a directory that is neither part does not stand in.
    expect(() =>
      verify(build({ serverRecord: { outDir: "dist/elsewhere" } })),
    ).toThrow(/no SDK resolution record for its Worker output/);
  });

  it("refuses a record another pass wrote, a foreign file in the records, and an empty nonce", () => {
    expect(() =>
      verify(build({ serverRecord: { nonce: "0".repeat(32) } })),
    ).toThrow(/resolution\.ssr\.json was not written by this build/);
    expect(() =>
      verify(build({ extraOutputs: { ".morph/records/other.json": "{}" } })),
    ).toThrow(/\.morph\/records\/other\.json, which is not one of Morph's records/);
    expect(() =>
      verify(
        build({
          extraOutputs: { ".morph/records/resolution.extra.json": "not json" },
        }),
      ),
    ).toThrow(/resolution\.extra\.json is not JSON/);
    expect(() => verify(build(), "")).toThrow(/this build pass has no nonce/);
  });

  it("refuses code it cannot read, a name that is not an SDK entry, and an uncertified Vite", () => {
    expect(() =>
      verify(build({ serverRecord: { unparsed: ["src/routes/x.tsx"] } })),
    ).toThrow(
      /src\/routes\/x\.tsx names @morph\/sdk in code Morph cannot read in the ssr environment/,
    );
    expect(() =>
      verify(build({ server: [edge({ specifier: "@morph/sdk/other" })] })),
    ).toThrow(/imports "@morph\/sdk\/other", which is not a Morph SDK entry/);
    expect(() => verify(build({ serverRecord: { vite: "8.0.0" } }))).toThrow(
      `ran Vite 8.0.0, not the certified ${THEME_START_TOOLCHAIN.vite}`,
    );
  });

  it("proves the bare @morph/sdk and every subpath against its own file", () => {
    for (const [specifier, file] of Object.entries(THEME_MORPH_SDK_MODULES)) {
      const ok = verify(
        build({
          server: [edge({ specifier, resolved: { path: file } })],
          serverScript: JSON.stringify(nativeSdkSentinel(NONCE, specifier)),
        }),
      );
      expect(ok.environments[1]!.specifiers).toEqual([specifier]);
      // Another entry's file is a redirect.
      const other = specifier === "@morph/sdk" ? START_FILE : THEME_MORPH_SDK_MODULES["@morph/sdk"]!;
      expect(() =>
        verify(build({ server: [edge({ specifier, resolved: { path: other } })] })),
      ).toThrow(/changes where/);
    }
  });
});

describe("the native Start build's SDK copy", () => {
  it("is the platform's copy, with one sentinel statement appended to each reserved entry", () => {
    const platform = themeMorphSdkFiles();
    const native = nativeStartSdkFiles(NONCE);
    expect(native.map((file) => file.path)).toEqual(
      platform.map((file) => file.path),
    );
    const entries = new Set(Object.values(THEME_MORPH_SDK_MODULES));
    for (const [index, file] of native.entries()) {
      const original = platform[index]!;
      if (!entries.has(file.path)) {
        expect(file.content).toBe(original.content);
        continue;
      }
      expect(file.content.startsWith(original.content)).toBe(true);
      const added = file.content.slice(original.content.length);
      const specifier = Object.entries(THEME_MORPH_SDK_MODULES).find(
        ([, path]) => path === file.path,
      )![0];
      expect(added).toContain(
        `Reflect.set(globalThis, Symbol.for("morph.sdk.sentinel"), ${JSON.stringify(nativeSdkSentinel(NONCE, specifier))});`,
      );
    }
    // Four entries: @morph/sdk, /start, /astro, /section-gate.
    expect(entries.size).toBe(4);
  });

  it("names a different sentinel for each entry and each pass", () => {
    const names = Object.keys(THEME_MORPH_SDK_MODULES).map((specifier) =>
      nativeSdkSentinel(NONCE, specifier),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(nativeSdkSentinel(NONCE, START)).toBe(
      `morph-sdk:start:${NONCE}:start`,
    );
    expect(nativeSdkSentinel(NONCE, "@morph/sdk")).toBe(
      `morph-sdk:start:${NONCE}:sdk`,
    );
    expect(nativeSdkSentinel("b".repeat(32), START)).not.toBe(
      nativeSdkSentinel(NONCE, START),
    );
  });
});

describe("the resolution record plugin's identity", () => {
  it("is pinned to the proof version: change NATIVE_PROOF_VERSION with the plugin", () => {
    // If this fails, the plugin changed: bump NATIVE_PROOF_VERSION (it joins
    // the native compiler identity) and record the new hash here.
    expect({
      version: NATIVE_PROOF_VERSION,
      sha256: createHash("sha256")
        .update(nativeResolutionPluginSource())
        .digest("hex"),
    }).toEqual({
      version: "np-1",
      sha256: PLUGIN_SHA256,
    });
  });
});

describe("static HTML in a native artifact", () => {
  it("is listed with where it came from", () => {
    const artifactFiles = new Map<string, string>([
      ["runtime/client/about/index.html", "<html>"],
      ["runtime/client/legal.html", "<html>"],
      ["runtime/client/_shell.html", "<html>"],
      ["runtime/client/assets/app.js", ""],
      ["runtime/server/index.js", ""],
    ]);
    const outputs = new Map<string, string>([["public/legal.html", "<html>"]]);
    expect(nativeHtmlAssets({ artifactFiles, outputs })).toEqual([
      { path: "runtime/client/_shell.html", source: "spa-shell" },
      { path: "runtime/client/about/index.html", source: "prerender" },
      { path: "runtime/client/legal.html", source: "public" },
    ]);
  });
});

describe("a manifest's nativeProof, read back", () => {
  const proof = {
    version: NATIVE_PROOF_VERSION,
    sdk: {
      environments: [
        { name: "client", output: "client", specifiers: [], edges: 0, sentinelFiles: [] },
        {
          name: "ssr",
          output: "server",
          specifiers: [START],
          edges: 1,
          sentinelFiles: ["runtime/server/index.js"],
        },
      ],
    },
    toolchain: { vite: THEME_START_TOOLCHAIN.vite },
    html: [],
  };

  it("is the proof Morph wrote", () => {
    expect(readNativeBuildProof(JSON.parse(JSON.stringify(proof)))).toEqual(proof);
  });

  it("is null for anything else: none, another version, a missing part", () => {
    expect(readNativeBuildProof(undefined)).toBeNull();
    expect(readNativeBuildProof({ ...proof, version: "np-0" })).toBeNull();
    expect(
      readNativeBuildProof({
        ...proof,
        sdk: { environments: [proof.sdk.environments[1]] },
      }),
    ).toBeNull();
    expect(readNativeBuildProof({ ...proof, toolchain: {} })).toBeNull();
    expect(
      readNativeBuildProof({ ...proof, html: [{ path: "x", source: "other" }] }),
    ).toBeNull();
  });
});

/** sha256 of `nativeResolutionPluginSource()` at NATIVE_PROOF_VERSION np-1. */
const PLUGIN_SHA256 =
  "525da0a19ad9fc3205ecc7c826c968819215387733768302c166c2032902aa52";
