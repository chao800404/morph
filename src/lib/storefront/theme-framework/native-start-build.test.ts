// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { NATIVE_WRANGLER_CONFIG_PATH } from "./tanstack-start-native-build";
import { themeFramework } from ".";

/**
 * A TanStack Start project built with its own configuration, end to end:
 * Morph's plan, the project's own `vite build` with the pinned toolchain, the
 * output moved into Morph's artifact layout, and the Worker answering from it.
 *
 * The project is the starter Theme written the way the official Start
 * Cloudflare example is: its own vite.config.ts and wrangler.jsonc.
 */
const VITE_CONFIG = `import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
`;
const WRANGLER = `{
  // The author's own deployment config.
  "name": "native-starter",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
}
`;
const BUILD_BUDGET_MS = 180_000;

function walk(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.name === "node_modules") return [];
    return entry.isDirectory() ? walk(root, full) : [relative(root, full)];
  });
}

describe("a TanStack Start project built with its own configuration", () => {
  let workspace = "";
  let artifactDir = "";
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;
  let serverWranglerConfig: Record<string, unknown> = {};
  let workerSource = "";

  beforeAll(async () => {
    const plan = themeFramework().build.native.plan([
      ...STARTER_THEME_FILES,
      { path: "vite.config.ts", content: VITE_CONFIG },
      { path: "wrangler.jsonc", content: WRANGLER },
    ]);
    if (!plan.ok) throw new Error(plan.message);

    workspace = mkdtempSync(join(tmpdir(), "native-start-build-"));
    for (const file of plan.workspaceFiles) {
      // Morph's copy carries something the author's config does not, so the
      // build output shows which config the plugin read.
      const content =
        file.path === NATIVE_WRANGLER_CONFIG_PATH
          ? JSON.stringify({
              ...JSON.parse(file.content),
              vars: { MORPH_CONFIG: "used" },
            })
          : file.content;
      mkdirSync(dirname(join(workspace, file.path)), { recursive: true });
      writeFileSync(join(workspace, file.path), content);
    }
    // The pinned toolchain, the same packages Morph's own builds resolve.
    symlinkSync(
      join(process.cwd(), "node_modules"),
      join(workspace, "node_modules"),
    );

    const [command, ...args] = plan.command;
    expect(command).toBe("vite");
    execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", ...args], {
      cwd: workspace,
      env: { ...process.env, ...plan.env },
      stdio: "pipe",
      timeout: BUILD_BUDGET_MS,
    });

    const outputs = new Map(
      walk(workspace).map((path) => [
        path,
        readFileSync(join(workspace, path)),
      ]),
    );
    const artifact = themeFramework().build.native.collect(
      new Map(
        [...outputs].map(([path, bytes]) => [path, new Uint8Array(bytes)]),
      ),
    );

    artifactDir = mkdtempSync(join(tmpdir(), "native-start-artifact-"));
    for (const [path, content] of artifact.files) {
      mkdirSync(dirname(join(artifactDir, path)), { recursive: true });
      writeFileSync(join(artifactDir, path), content);
    }
    serverWranglerConfig = JSON.parse(
      readFileSync(join(artifactDir, "runtime/server/wrangler.json"), "utf8"),
    );
    workerSource = walk(join(artifactDir, "runtime/server"))
      .filter((path) => path.endsWith(".js"))
      .map((path) =>
        readFileSync(join(artifactDir, "runtime/server", path), "utf8"),
      )
      .join("\n");
    expect(artifact.workerEntry).toBe("runtime/server/index.js");

    // Started the way a release starts: from the Worker's own config.
    worker = await unstable_startWorker({
      config: join(artifactDir, "runtime/server/wrangler.json"),
      dev: { server: { port: 0 }, inspector: false, logLevel: "error" },
    });
    await worker.ready;
  }, BUILD_BUDGET_MS + 60_000);

  afterAll(async () => {
    await worker?.dispose();
    for (const dir of [workspace, artifactDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  const request = (path: string) =>
    worker!.fetch(`http://localhost${path}`, { redirect: "manual" });

  it("built with Morph's copy of the Wrangler config", () => {
    expect(serverWranglerConfig).toMatchObject({
      name: "native-starter",
      vars: { MORPH_CONFIG: "used" },
      main: "index.js",
      assets: { directory: "../client" },
    });
  });

  it("ships none of the editor's markers", () => {
    expect(workerSource.length).toBeGreaterThan(0);
    expect(workerSource).not.toMatch(/data-morph-(node|section|loc)/);
  });

  it("serves the starter's pages from the built Worker", async () => {
    for (const path of ["/", "/account", "/order-transfer"]) {
      const response = await request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toContain("text/html");
    }
  });

  it("answers an unknown page with 404", async () => {
    expect((await request("/no-such-page")).status).toBe(404);
  });

  it("serves the static assets beside the Worker", async () => {
    const assets = walk(join(artifactDir, "runtime/client")).filter((path) =>
      path.endsWith(".css"),
    );
    expect(assets.length).toBeGreaterThan(0);
    expect((await request(`/${assets[0]}`)).status).toBe(200);
  });
});
