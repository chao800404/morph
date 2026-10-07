// @vitest-environment node
// Node, not jsdom: jsdom's TextEncoder makes a Uint8Array of another realm,
// which the runner's byte reader (`instanceof Uint8Array`) does not take.
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import {
  CloudflareSandboxViteThemeBuildRunner,
  type CloudflareSandboxSession,
} from "./cloudflare-sandbox-vite-theme-build-runner";
import { NATIVE_START_COMPILER_ID } from "./theme-build-materializer";
import type { ThemeBuildRunnerInput } from "./theme-build-runner.types";
import { THEME_START_TOOLCHAIN } from "./theme-start-toolchain";

/**
 * The Sandbox runner's native build against a stand-in container: what it
 * writes, the command and environment it runs, and how it turns what the
 * build left into the native artifact. The real build of the same plan is
 * native-start-runner.test.ts (local runner); the real container run is the
 * publish acceptance.
 */
const OWN_VITE = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig({ plugins: [cloudflare({ viteEnvironment: { name: "ssr" } })] });
`;
const OWN_WRANGLER = `{ "name": "native", "compatibility_date": "2025-09-02", "main": "@tanstack/react-start/server-entry" }`;

const input = (): ThemeBuildRunnerInput =>
  ({
    buildId: "native-sandbox",
    storefrontId: "store",
    themeId: "theme",
    sourceRevisionId: "source",
    revisionNumber: 1,
    entry: "src/index.tsx",
    inputHash: "c".repeat(64),
    compilerId: NATIVE_START_COMPILER_ID,
    compilerVersion: THEME_START_TOOLCHAIN.reactStart,
    buildMode: "native",
    files: [
      { path: "src/index.tsx", content: "export default () => null;\n" },
      { path: "vite.config.ts", content: OWN_VITE },
      { path: "wrangler.jsonc", content: OWN_WRANGLER },
    ],
  }) as ThemeBuildRunnerInput;

/** A root and a home route, enough for the route registry. */
const ROUTES = [
  {
    path: "src/routes/__root.tsx",
    content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
  },
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: () => <h1>Home</h1> });
`,
  },
];

/** A sealed snapshot whose home page carries `sealed-sentinel`. */
const SNAPSHOT = {
  publicationId: "pub",
  storefrontId: "store",
  themeId: "theme",
  documents: [
    {
      item: {
        id: "item",
        publicationId: "pub",
        itemType: "template",
        contentId: "home",
        revisionId: "revision",
        metadata: { templateType: "index" },
      },
      document: {
        version: 1,
        sections: [
          {
            id: "hero",
            type: "hero",
            enabled: true,
            props: { title: "sealed-sentinel" },
          },
        ],
      },
    },
  ],
} as unknown as ThemeBuildRunnerInput["contentSnapshot"];

/** What the Cloudflare plugin leaves after a build, by workspace path. */
const BUILT: Record<string, string> = {
  ".wrangler/deploy/config.json": JSON.stringify({
    configPath: "../../dist/server/wrangler.json",
  }),
  "dist/server/wrangler.json": JSON.stringify({
    name: "native",
    main: "index.js",
    assets: { directory: "../client" },
  }),
  "dist/server/index.js":
    "export default { fetch() { return new Response('ok'); } };",
  "dist/client/assets/app.css": "body{}",
};

function fakeSandbox(
  options: {
    buildFails?: boolean;
    extraBytes?: number;
    refusedReads?: string;
    /** Only the first build leaves `refusedReads`, as one given content would not. */
    refusedOnFirstBuildOnly?: boolean;
  } = {},
) {
  let builds = 0;
  const files = new Map<string, string>();
  const commands: Array<{
    command: string;
    cwd?: string;
    env?: Record<string, string>;
  }> = [];
  const session: CloudflareSandboxSession = {
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async (path: string) => ({
      content: new TextEncoder().encode(files.get(path) ?? ""),
    })) as never,
    exec: vi.fn(
      async (
        command: string,
        opts?: { cwd?: string; env?: Record<string, string> },
      ) => {
        commands.push({ command, cwd: opts?.cwd, env: opts?.env });
        if (command.includes("vite") && command.includes(" build")) {
          if (options.buildFails) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: '✘ [ERROR] Could not resolve "./missing"',
            };
          }
          for (const [path, content] of Object.entries(BUILT)) {
            files.set(`/workspace/${path}`, content);
          }
          builds += 1;
          if (
            options.refusedReads !== undefined &&
            (!options.refusedOnFirstBuildOnly || builds === 1)
          ) {
            files.set(
              "/workspace/.morph/prerender-refused-reads.ndjson",
              options.refusedReads,
            );
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.startsWith("find /workspace -mindepth 1 -maxdepth 1")) {
          // Clearing the workspace between passes: all but the toolchain link.
          for (const path of [...files.keys()]) {
            if (!path.startsWith("/workspace/node_modules/")) files.delete(path);
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (command.startsWith("find /workspace")) {
          const stdout = [...files.entries()]
            .map(
              ([path, content]) =>
                `${content.length + (path.endsWith("index.js") ? (options.extraBytes ?? 0) : 0)} ${path}`,
            )
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
  });
  return { runner, files, commands };
}

describe("the Sandbox runner's native build", () => {
  it("lays out the project's own config with Morph's wrapper and copy, and nothing else of Morph's", async () => {
    const { runner, files } = fakeSandbox();
    await runner.run(input());
    expect(files.get("/workspace/vite.config.ts")).toBe(OWN_VITE);
    expect(files.get("/workspace/wrangler.jsonc")).toBe(OWN_WRANGLER);
    expect(files.get("/workspace/.morph/vite.config.ts")).toContain(
      'import themeConfig from "../vite.config.ts";',
    );
    expect(files.has("/workspace/.morph/wrangler.json")).toBe(true);
    // No platform-generated entry or config of the platform build.
    expect(files.has("/workspace/__entry.tsx")).toBe(false);
  });

  it("builds with the image's pinned Vite through the wrapper, in the workspace, with no Morph secret", async () => {
    const { runner, commands } = fakeSandbox();
    await runner.run(input());
    const build = commands.find((entry) => entry.command.includes(" build"));
    expect(build?.command).toBe(
      "/opt/morph-toolchain/node_modules/.bin/vite build --config .morph/vite.config.ts --logLevel error",
    );
    expect(build?.cwd).toBe("/workspace");
    expect(Object.keys(build?.env ?? {}).sort()).toEqual([
      "CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH",
      "NODE_ENV",
      "NODE_OPTIONS",
    ]);
  });

  it("returns the native artifact and manifest from what the build left", async () => {
    const { runner } = fakeSandbox();
    const result = await runner.run(input());
    if (!result.success) {
      throw new Error(
        `${result.diagnosticsJson?.stage}: ${result.errorMessage} ${JSON.stringify(result.logs?.slice(-3))}`,
      );
    }
    expect(result.artifacts.map((file) => file.path).sort()).toEqual([
      "runtime/client/assets/app.css",
      "runtime/server/index.js",
      "runtime/server/wrangler.json",
    ]);
    expect(result.manifestJson.artifactEntry).toBe("runtime/server/index.js");
    expect(result.manifestJson.metadata).toMatchObject({ build: "native" });
  });

  it("reports the build's own error when it fails", async () => {
    const { runner } = fakeSandbox({ buildFails: true });
    const result = await runner.run(input());
    expect(result).toMatchObject({
      success: false,
      errorMessage: expect.stringContaining(
        'NATIVE_BUILD_FAILED: ✘ [ERROR] Could not resolve "./missing"',
      ),
    });
  });

  it("fails a build whose prerender read content it could not answer", async () => {
    // What the wrapper's content plugin leaves when a prerendered page read
    // Morph content the build has not sealed: Start itself reports success.
    const { runner } = fakeSandbox({
      refusedReads: [
        '{"path":"/landing","reason":"NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: this build has no sealed content"}',
        '{"path":"/landing","reason":"NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: this build has no sealed content"}',
        "",
      ].join("\n"),
    });
    const result = await runner.run(input());
    expect(result).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "prerender-content" },
      errorMessage: expect.stringContaining(
        "NATIVE_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed: /landing (NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT",
      ),
    });
  });

  it("records an artifact independent when its build, given no content, succeeds", async () => {
    const { runner, files } = fakeSandbox();
    const result = await runner.run({
      ...input(),
      contentSnapshot: SNAPSHOT,
    });
    expect(result).toMatchObject({
      success: true,
      contentDependency: "independent",
    });
    // The one pass it took held none of the sealed content.
    expect(files.get("/workspace/.morph-prerender-content.json")).not.toContain(
      "sealed-sentinel",
    );
  });

  it("builds again, from a cleared workspace, with the content its prerender read", async () => {
    const { runner, files, commands } = fakeSandbox({
      refusedReads:
        '{"path":"/","reason":"NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: this build has no sealed content"}\n',
      refusedOnFirstBuildOnly: true,
    });
    const result = await runner.run({
      ...input(),
      // Routes, so the sealed content is resolved per page.
      files: [...input().files, ...ROUTES],
      contentSnapshot: SNAPSHOT,
    });
    expect(result).toMatchObject({
      success: true,
      contentDependency: "dependent",
    });
    const builds = commands.filter((entry) => entry.command.includes(" build"));
    expect(builds).toHaveLength(2);
    // Cleared between the passes, keeping only the toolchain link, and the
    // first pass's record did not survive into the second.
    const clear = commands.findIndex((entry) =>
      entry.command.startsWith("find /workspace -mindepth 1 -maxdepth 1"),
    );
    expect(clear).toBeGreaterThan(
      commands.findIndex((entry) => entry.command.includes(" build")),
    );
    expect(commands[clear]!.command).toContain("! -name node_modules");
    expect(files.has("/workspace/.morph/prerender-refused-reads.ndjson")).toBe(
      false,
    );
    // The second pass was the one given the sealed content.
    expect(files.get("/workspace/.morph-prerender-content.json")).toContain(
      "sealed-sentinel",
    );
  });

  it("refuses a workspace it would have to read past its limits", async () => {
    const { runner } = fakeSandbox({ extraBytes: 100 * 1024 * 1024 });
    const result = await runner.run(input());
    expect(result).toMatchObject({
      success: false,
      diagnosticsJson: { stage: "output-limits" },
    });
  });

  it("still refuses a platform build's identity for native input", async () => {
    const { runner } = fakeSandbox();
    const result = await runner.run({
      ...input(),
      compilerId: "tailwind-v4-build",
      compilerVersion: "4.1.17",
    });
    expect(result).toMatchObject({
      success: false,
      errorMessage: expect.stringContaining("COMPILER_IDENTITY_MISMATCH"),
    });
  });
});
