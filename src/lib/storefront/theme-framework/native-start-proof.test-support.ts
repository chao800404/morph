import { THEME_START_TOOLCHAIN } from "../compiler/theme-start-toolchain";

/**
 * What Morph's resolution plugin leaves after a native Start build in which
 * neither environment imports the SDK, for tests that stand in for the
 * build (a fake container, synthetic outputs). The real plugin's records are
 * asserted by native-start-build.test.ts.
 *
 * `wrapperSource` is the `.morph/vite.config.ts` the plan wrote: the pass's
 * nonce is read from it, as the plugin reads it.
 */
export function nativeStartProofRecordsForTest(
  wrapperSource: string,
  directories: Readonly<{ server: string; client: string }> = {
    server: "dist/server",
    client: "dist/client",
  },
): Record<string, string> {
  const nonce = /const morphBuildNonce = ("[^"]*");/.exec(wrapperSource)?.[1];
  if (nonce === undefined) {
    throw new Error("The wrapper carries no build nonce.");
  }
  const record = (environment: string, consumer: string, outDir: string) =>
    JSON.stringify({
      nonce: JSON.parse(nonce),
      environment,
      consumer,
      outDir,
      vite: THEME_START_TOOLCHAIN.vite,
      rollup: "4.59.0",
      edges: [],
      unparsed: [],
      sdkModules: [],
    });
  return {
    ".morph/records/resolution.client.json": record(
      "client",
      "client",
      directories.client,
    ),
    ".morph/records/resolution.ssr.json": record(
      "ssr",
      "server",
      directories.server,
    ),
  };
}
