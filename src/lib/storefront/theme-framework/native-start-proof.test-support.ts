import { createHash } from "node:crypto";
import { THEME_START_TOOLCHAIN } from "../compiler/theme-start-toolchain";

/**
 * What Morph's plugins leave after a native Start build in which neither
 * environment imports the SDK, for tests that stand in for the build (a
 * fake container, synthetic outputs): the resolution and bundle records of
 * `morph:native-resolution` and the checked `cloudflare()` call's count.
 * The real plugin's records are asserted by native-start-build.test.ts.
 *
 * `wrapperSource` is the `.morph/vite.config.ts` the plan wrote: the pass's
 * nonce is read from it, as the plugin reads it. `outputs` are the build's
 * other files: each JavaScript file in an output directory is recorded as a
 * chunk with its own hash (the Worker's `index.js`, and every client
 * script, as entries).
 */
export function nativeStartProofRecordsForTest(
  wrapperSource: string,
  outputs: Readonly<Record<string, string>>,
  directories: Readonly<{ server: string; client: string }> = {
    server: "dist/server",
    client: "dist/client",
  },
): Record<string, string> {
  const nonce = /const morphBuildNonce = ("[^"]*");/.exec(wrapperSource)?.[1];
  if (nonce === undefined) {
    throw new Error("The wrapper carries no build nonce.");
  }
  const value = JSON.parse(nonce) as string;
  const resolution = (environment: string, consumer: string, outDir: string) =>
    JSON.stringify({
      nonce: value,
      environment,
      consumer,
      outDir,
      publicDir: consumer === "client" ? "public" : null,
      vite: THEME_START_TOOLCHAIN.vite,
      rollup: "4.59.0",
      edges: [],
      unparsed: [],
      computed: [],
      modules: [],
    });
  const bundle = (environment: string, outDir: string, server: boolean) =>
    JSON.stringify({
      nonce: value,
      environment,
      outDir,
      chunks: Object.entries(outputs)
        .filter(
          ([path]) =>
            path.startsWith(`${outDir}/`) && /\.(?:m|c)?js$/.test(path),
        )
        .map(([path, content]) => {
          const fileName = path.slice(outDir.length + 1);
          return {
            fileName,
            isEntry: server ? fileName === "index.js" : true,
            isDynamicEntry: false,
            modules: [],
            sha256: createHash("sha256").update(content).digest("hex"),
          };
        }),
    });
  return {
    ".morph/records/resolution.client.json": resolution(
      "client",
      "client",
      directories.client,
    ),
    ".morph/records/resolution.ssr.json": resolution(
      "ssr",
      "server",
      directories.server,
    ),
    ".morph/records/bundle.client.json": bundle(
      "client",
      directories.client,
      false,
    ),
    ".morph/records/bundle.ssr.json": bundle("ssr", directories.server, true),
    ".morph/records/adapter-calls.json": JSON.stringify({
      nonce: value,
      calls: [{ keys: ["viteEnvironment"], environment: "ssr" }],
    }),
  };
}
