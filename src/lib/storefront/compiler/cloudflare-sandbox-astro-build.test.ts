// @vitest-environment node
// Node, not jsdom: the runner's byte reader takes this realm's Uint8Array.
import { describe, expect, it, vi } from "vitest";
import { answerToolchainCommand } from "./sandbox-toolchain.test-support";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import type { StorefrontThemeRevisionDTO } from "../dto/storefront-theme-file.dto";
import {
  astroThemeFiles,
  sealedSnapshot,
} from "../theme-framework/astro-native-prerender.fixtures";
import { themeToolchainForFramework } from "../theme-framework/theme-toolchains";
import {
  CloudflareSandboxViteThemeBuildRunner,
  type CloudflareSandboxSession,
} from "./cloudflare-sandbox-vite-theme-build-runner";
import { materializeThemeBuildInput } from "./theme-build-materializer";

/**
 * The Sandbox runner's native Astro build against a stand-in container
 * (docs/astro-theme-plan.md A4b): the command and environment it runs with
 * the recorded Astro toolchain, and how it reads what the build left —
 * records bound to the pass's nonce, and a failed build's refused read. The
 * real build of the same plan is native-astro-runner.build.test.ts (local
 * runner); a real container run is not part of this test.
 */
const ASTRO = themeToolchainForFramework("astro");

function astroInput(sealed: boolean) {
  const snapshot = sealed ? sealedSnapshot(["/about"]) : undefined;
  return materializeThemeBuildInput({
    build: {
      id: "astro-sandbox",
      storefrontId: "store",
      themeId: "theme",
      sourceRevisionId: "rev",
      status: "queued",
      inputHash: null,
      compilerId: null,
      compilerVersion: null,
      contentPublicationId: snapshot?.publicationId ?? null,
      framework: "astro",
      inputHashFormat: 2,
      toolchainId: ASTRO.id,
    } as StorefrontThemeBuildDTO,
    revision: {
      id: "rev",
      storefrontId: "store",
      themeId: "theme",
      revisionNumber: 1,
      snapshot: astroThemeFiles().map((file) => ({
        path: file.path,
        content: file.content,
      })),
    } as unknown as StorefrontThemeRevisionDTO,
    ...(snapshot ? { contentSnapshot: snapshot } : {}),
    astroThemes: true,
  });
}

/** What @astrojs/cloudflare leaves after a build, by workspace path. */
const BUILT: Record<string, string> = {
  ".wrangler/deploy/config.json": JSON.stringify({
    configPath: "../../dist/server/wrangler.json",
  }),
  "dist/server/wrangler.json": JSON.stringify({
    name: "astro",
    main: "entry.mjs",
    assets: { directory: "../client" },
    kv_namespaces: [],
  }),
  "dist/server/entry.mjs": "export default { fetch() { return new Response('ok'); } };",
  "dist/client/index.html": "<h1>A3-SEALED-A</h1>",
  "dist/client/about/index.html": "<h1>A3-SEALED-A</h1>",
};

type Pass =
  /** The build succeeds and its records are complete. */
  | "built"
  /** The build succeeds but leaves no stamps (the origin never reached a page). */
  | "unstamped"
  /** Fail-fast: the build stops on a refused read, recorded with this nonce. */
  | "refused"
  /** The build fails; the refused read on record is another build's. */
  | "refused-foreign";

function fakeSandbox(passes: readonly Pass[], options: { astroThemes?: boolean } = { astroThemes: true }) {
  const files = new Map<string, string>();
  const commands: Array<{ command: string; cwd?: string; env?: Record<string, string> }> = [];
  let builds = 0;
  const nonce = () =>
    /const NONCE = "([0-9a-f]+)";/.exec(
      files.get("/workspace/.morph/astro-build-integration.mjs") ?? "",
    )?.[1] ?? "";
  const session: CloudflareSandboxSession = {
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async (path: string) => ({
      content: new TextEncoder().encode(files.get(path) ?? ""),
    })) as never,
    exec: vi.fn(
      async (command: string, opts?: { cwd?: string; env?: Record<string, string> }) => {
        const toolchainAnswer = answerToolchainCommand(command, ASTRO.id);
        if (toolchainAnswer) return toolchainAnswer;
        commands.push({ command, cwd: opts?.cwd, env: opts?.env });
        if (command.includes("/.bin/astro build")) {
          const pass = passes[builds++] ?? "built";
          const record = (path: string, entries: object[]) =>
            files.set(
              `/workspace/.morph/${path}`,
              entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
            );
          if (pass === "refused" || pass === "refused-foreign") {
            record("prerender-refused-reads.ndjson", [
              {
                nonce: pass === "refused" ? nonce() : "f".repeat(32),
                path: "/about",
                reason: "NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: this build has no sealed content",
              },
            ]);
            return {
              exitCode: 1,
              stdout: "",
              stderr: "Failed to prerender /about/: MORPH_PRERENDER_CONTENT_FAILED",
            };
          }
          for (const [path, content] of Object.entries(BUILT)) {
            files.set(`/workspace/${path}`, content);
          }
          record("prerender-pages.ndjson", [
            { nonce: nonce(), path: "/" },
            { nonce: nonce(), path: "/about" },
            { nonce: nonce(), done: true },
          ]);
          if (pass === "built") {
            record("prerender-stamped.ndjson", [
              { nonce: nonce(), path: "/", reads: 1, failures: 0, refused: 0 },
              { nonce: nonce(), path: "/about", reads: 1, failures: 0, refused: 0 },
            ]);
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.startsWith("stat -c %s ")) {
          const content = files.get(command.slice("stat -c %s ".length));
          return content === undefined
            ? { exitCode: 1, stdout: "", stderr: "No such file" }
            : { exitCode: 0, stdout: `${content.length}\n`, stderr: "" };
        }
        if (command.startsWith("find /workspace -mindepth 1 -maxdepth 1")) {
          for (const path of [...files.keys()]) {
            if (!path.startsWith("/workspace/node_modules/")) files.delete(path);
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.startsWith("find /workspace")) {
          const stdout = [...files.entries()]
            .map(([path, content]) => `${content.length} ${path}`)
            .join("\n");
          return { exitCode: 0, stdout, stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    ) as never,
    destroy: vi.fn(async () => {}),
  };
  const runner = new CloudflareSandboxViteThemeBuildRunner({
    sandboxProvider: { getSandbox: async () => session },
    ...options,
  });
  return { runner, files, commands };
}

const builds = <T extends { command: string }>(commands: T[]) =>
  commands.filter((entry) => entry.command.includes("/.bin/astro build"));

describe("the Sandbox runner's native Astro build", () => {
  it("is refused without the server's Astro switch, before any container command", async () => {
    const { runner, commands } = fakeSandbox(["built"], {});
    const result = await runner.run(astroInput(false));
    expect(result).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "framework" },
      errorMessage: expect.stringMatching(/^THEME_FRAMEWORK_UNAVAILABLE: /),
    });
    expect(commands).toEqual([]);
  });

  it("runs the recorded Astro toolchain's astro through Morph's wrapper, with no Morph secret", async () => {
    const { runner, commands } = fakeSandbox(["built"]);
    await runner.run(astroInput(false));
    const [build] = builds(commands);
    expect(build?.command).toBe(
      `${ASTRO.root}/node_modules/.bin/astro build --config .morph/astro.build.config.mjs`,
    );
    expect(build?.cwd).toBe("/workspace");
    expect(Object.keys(build?.env ?? {}).sort()).toEqual([
      "ASTRO_TELEMETRY_DISABLED",
      "CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH",
      "NODE_ENV",
      "NODE_OPTIONS",
    ]);
    expect(build?.env?.NODE_OPTIONS).toBe(
      "--unhandled-rejections=strict --import=./.morph/native-build-hooks.mjs",
    );
  });

  it("returns the Astro artifact when every prerendered page has its stamp", async () => {
    const { runner } = fakeSandbox(["built"]);
    const result = await runner.run(astroInput(false));
    if (!result.success) throw new Error(`${result.diagnosticsJson?.stage}: ${result.errorMessage}`);
    expect(result.contentDependency).toBe("independent");
    expect(result.manifestJson.artifactEntry).toBe("runtime/server/entry.mjs");
    expect(result.manifestJson.metadata).toMatchObject({ framework: "astro", build: "native" });
  });

  it("fails a build whose prerendered pages have no stamps, though astro build succeeded", async () => {
    const { runner } = fakeSandbox(["unstamped"]);
    const result = await runner.run(astroInput(false));
    expect(result).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "prerender-records" },
      errorMessage: expect.stringMatching(/^NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING: /),
    });
  });

  it("builds again with the sealed content when the first pass stopped on a refused read", async () => {
    const { runner, commands, files } = fakeSandbox(["refused", "built"]);
    const result = await runner.run(astroInput(true));
    expect(result).toMatchObject({ success: true, contentDependency: "dependent" });
    expect(builds(commands)).toHaveLength(2);
    expect(files.get("/workspace/.morph-prerender-content.json")).toContain("A3-SEALED-A");
  });

  it("fails with the refused read when nothing is sealed", async () => {
    const { runner } = fakeSandbox(["refused"]);
    const result = await runner.run(astroInput(false));
    expect(result).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "prerender-content" },
      errorMessage: expect.stringMatching(/^NATIVE_PRERENDER_CONTENT_UNAVAILABLE: /),
    });
  });

  it("reports the build's own failure when the refused read on record is another build's", async () => {
    const { runner, commands } = fakeSandbox(["refused-foreign"]);
    const result = await runner.run(astroInput(true));
    expect(result).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "sandbox-native-compiler" },
      errorMessage: expect.stringContaining("NATIVE_BUILD_FAILED"),
    });
    // Not taken for a content read: no second pass.
    expect(builds(commands)).toHaveLength(1);
  });
});
