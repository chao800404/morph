// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { astroThemeFiles } from "./astro-native-prerender.fixtures";
import {
  ASTRO_PREVIEW_INTEGRATION_PATH,
  planAstroPreviewWorkspace,
} from "./astro-preview-workspace";

/**
 * The import guard of an Astro Live Preview, run as the dev server runs it:
 * the integration Morph writes, loaded from a workspace, its `resolveId`
 * called with what Vite's resolver answers.
 */
type ResolveId = (
  this: { resolve: () => Promise<{ id: string } | null> },
  source: string,
  importer: string,
  options: object,
) => Promise<{ id: string } | null>;

let workspace = "";
let guard: { resolveId: ResolveId };

beforeAll(async () => {
  const plan = planAstroPreviewWorkspace({
    files: astroThemeFiles(),
    entry: "",
    buildId: "preview-1",
    approvedDependencies: new Set(),
    mode: "preview-server",
  });
  if (!plan.ok) throw new Error(plan.errorMessage);
  const integration = plan.workspaceFiles.find(
    (file) => file.path === `/workspace/${ASTRO_PREVIEW_INTEGRATION_PATH}`,
  ) as { content: string };
  workspace = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "morph-astro-guard-")),
  );
  const file = path.join(workspace, ASTRO_PREVIEW_INTEGRATION_PATH);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, integration.content);
  // Real files beside the cache, for the paths that only look like it.
  for (const near of ["src/near.js", ".vite-other/near.js"]) {
    await fs.mkdir(path.dirname(path.join(workspace, near)), { recursive: true });
    await fs.writeFile(path.join(workspace, near), "export {};\n");
  }
  const { morphAstroPreview } = (await import(pathToFileURL(file).href)) as {
    morphAstroPreview: () => {
      hooks: Record<string, (input: { updateConfig: (config: never) => void }) => void>;
    };
  };
  let plugins: Array<{ name: string }> = [];
  morphAstroPreview().hooks["astro:config:setup"]!({
    updateConfig: (config: { vite: { plugins: Array<{ name: string }> } }) => {
      plugins = config.vite.plugins;
    },
  } as never);
  guard = plugins.find(
    (plugin) => plugin.name === "morph:astro-preview-import-guard",
  ) as unknown as { resolveId: ResolveId };
});

afterAll(async () => {
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
});

/** Calls the guard as Vite would, with the resolver answering `resolvedId`. */
const resolveThroughGuard = (
  source: string,
  importer: string,
  resolvedId: string,
) =>
  guard.resolveId.call(
    { resolve: async () => ({ id: resolvedId }) },
    source,
    importer,
    {},
  );

describe("the Astro Live Preview import guard", () => {
  // Vite names a discovered dependency's file in the cache before its
  // optimizer has written the directory: the start of a preview resolves
  // `@astrojs/cloudflare/entrypoints/server` to a path in a `deps_ssr` that
  // does not exist until the optimizer commits. Nothing here is on disk.
  it("judges a pre-bundled dependency by its package, before the cache is written", async () => {
    const cached = `${workspace}/.vite/deps_ssr/@astrojs_cloudflare_entrypoints_server.js?v=1`;
    await expect(
      resolveThroughGuard(
        "@astrojs/cloudflare/entrypoints/server",
        `${workspace}/__morph_preview_worker.ts`,
        cached,
      ),
    ).resolves.toEqual({ id: cached });
    // One chunk of the cache importing another.
    await expect(
      resolveThroughGuard(
        "./chunk-abc.js",
        cached,
        `${workspace}/.vite/deps_ssr/chunk-abc.js`,
      ),
    ).resolves.toEqual({ id: `${workspace}/.vite/deps_ssr/chunk-abc.js` });
  });

  it("names a package by its scope and name, never by a subpath or a prefix", async () => {
    const page = `${workspace}/src/pages/index.astro`;
    const cached = `${workspace}/.vite/deps_ssr/dep.js?v=1`;
    await expect(resolveThroughGuard("astro/components", page, cached)).resolves.toEqual({
      id: cached,
    });
    await expect(resolveThroughGuard("astro-evil", page, cached)).rejects.toThrow(
      /^UNAPPROVED_DEPENDENCY: .*from package "astro-evil"/,
    );
    await expect(
      resolveThroughGuard("@astrojs/evil/sub/path.js", page, cached),
    ).rejects.toThrow(/^UNAPPROVED_DEPENDENCY: .*from package "@astrojs\/evil"/);
    await expect(resolveThroughGuard("@evil/pkg?x=1", page, cached)).rejects.toThrow(
      /^UNAPPROVED_DEPENDENCY: .*from package "@evil\/pkg"/,
    );
  });

  // The cache is Vite's output, not a source of trust: what it holds is
  // judged by the package asked for, from a Theme file and from a chunk alike.
  it("never approves a package because it was pre-bundled", async () => {
    await expect(
      resolveThroughGuard(
        "left-pad",
        `${workspace}/src/pages/index.astro`,
        `${workspace}/.vite/deps_ssr/left-pad.js`,
      ),
    ).rejects.toThrow(/^UNAPPROVED_DEPENDENCY: /);
    await expect(
      resolveThroughGuard(
        "left-pad",
        `${workspace}/.vite/deps_ssr/chunk-abc.js?v=1`,
        `${workspace}/.vite/deps_ssr/left-pad.js`,
      ),
    ).rejects.toThrow(/^UNAPPROVED_DEPENDENCY: /);
  });

  it("refuses a Theme importing the cache by path, relative or absolute", async () => {
    const page = `${workspace}/src/pages/index.astro`;
    const chunk = `${workspace}/.vite/deps_ssr/chunk-abc.js`;
    for (const source of [
      "../../.vite/deps_ssr/chunk-abc.js",
      `${workspace}/.vite/deps_ssr/chunk-abc.js`,
      "/.vite/deps_ssr/chunk-abc.js?v=1",
    ]) {
      await expect(resolveThroughGuard(source, page, chunk), source).rejects.toThrow(
        /^UNAPPROVED_DEPENDENCY_PATH: /,
      );
    }
  });

  it("takes nothing that only looks like the cache for it", async () => {
    const page = `${workspace}/src/pages/index.astro`;
    // Workspace files, judged as such: allowed by path, where the cache
    // would have refused a path import.
    for (const id of [
      `${workspace}/.vite-other/near.js`,
      `${workspace}/.vite/../src/near.js`,
    ]) {
      await expect(resolveThroughGuard("./near.js", page, id), id).resolves.toEqual({ id });
    }
    // A chunk's relative import is a chunk only while it stays in the cache.
    await expect(
      resolveThroughGuard(
        "../../../etc/hosts",
        `${workspace}/.vite/deps_ssr/chunk-abc.js?v=1`,
        `${workspace}/.vite/../../../../../../../../etc/hosts`,
      ),
    ).rejects.toThrow(/^WORKSPACE_PATH_ESCAPE: /);
    // A served URL is not a file in the cache, and is never approved as one.
    await expect(
      resolveThroughGuard(
        "x",
        page,
        `/@fs${workspace}/.vite/deps_ssr/x.js`,
      ),
    ).rejects.toThrow();
  });

  it("still refuses an import that resolves outside the workspace", async () => {
    await expect(
      resolveThroughGuard(
        "../../../etc/hosts",
        `${workspace}/src/pages/index.astro`,
        "/etc/hosts",
      ),
    ).rejects.toThrow(/^WORKSPACE_PATH_ESCAPE: /);
  });
});
