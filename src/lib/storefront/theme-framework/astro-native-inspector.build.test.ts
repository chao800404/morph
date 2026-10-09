// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNativePrerenderContent } from "../compiler/theme-prerender-content";
import { astroRouteRegistry } from "./astro-native-prerender";
import { astroThemeFiles, sealedSnapshot } from "./astro-native-prerender.fixtures";
import {
  astroToolchainInstalled,
  newNonce,
  runAstroPrerenderBuild,
} from "./astro-native-prerender.test-support";

/**
 * The debugger port the adapter's prerender server opens by default
 * (docs/astro-theme-plan.md 7.2). A native build loads Start's module hook,
 * which gives every `cloudflare(...)` `inspectorPort: false` — the adapter's
 * own calls included — without rewriting the author's config. The plan's
 * condition for that: the port is really not opened, and the artifact is the
 * same file for file as without it.
 */
const BUILD = { timeout: 240_000 };

// The adapter's defaults for the inspector: no inspectorPort.
const CONFIG = `import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  session: false,
  devToolbar: { enabled: false },
  telemetry: false,
});
`;

const digests = (outputs: ReadonlyMap<string, Uint8Array>) =>
  new Map(
    [...outputs]
      .filter(([path]) => path.startsWith("dist/"))
      .map(([path, bytes]) => [
        path,
        createHash("sha256").update(bytes).digest("hex"),
      ]),
  );

describe.skipIf(!astroToolchainInstalled || process.platform !== "linux")(
  "the prerender server's debugger port",
  () => {
    it(
      "is not opened under the build's module hook, and the artifact is the same",
      BUILD,
      async () => {
        const files = astroThemeFiles({ config: CONFIG });
        const registry = astroRouteRegistry(files);
        const prerenderContent = await createNativePrerenderContent(
          sealedSnapshot(["/about"]),
          registry,
        );
        // One path, one nonce and one key for all three. The server bundle
        // records the workspace's absolute path, and Astro writes a fresh
        // random key into it on every build unless ASTRO_KEY is set; either
        // alone makes two builds of the same input differ.
        const same = {
          files,
          prerenderContent,
          nonce: newNonce(),
          workspace: path.join(os.tmpdir(), `morph-astro-inspector-${process.pid}`),
          env: { ASTRO_KEY: randomBytes(32).toString("base64") },
        };
        const without = await runAstroPrerenderBuild(same);
        const again = await runAstroPrerenderBuild(same);
        const hooked = await runAstroPrerenderBuild({
          ...same,
          inspectorHook: true,
        });
        expect(without.exitCode, without.output).toBe(0);
        expect(hooked.exitCode, hooked.output).toBe(0);
        // The comparison means something: the same build twice is the same.
        expect(digests(again.outputs)).toEqual(digests(without.outputs));

        // The observation works: without the hook the prerender's workerd is
        // given a debugger address.
        expect(
          without.workerdArgs.some((args) => args.includes("--inspector-addr")),
        ).toBe(true);
        // With it, workerd runs and is given none.
        expect(hooked.workerdArgs.length).toBeGreaterThan(0);
        expect(
          hooked.workerdArgs.filter((args) => args.includes("--inspector-addr")),
        ).toEqual([]);

        expect(digests(hooked.outputs)).toEqual(digests(without.outputs));
      },
    );
  },
);
