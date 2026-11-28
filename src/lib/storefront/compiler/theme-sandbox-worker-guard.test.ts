// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import {
  planThemeSandboxWorkspace,
  materializeThemeSandboxWorkspace,
} from "./theme-sandbox-workspace";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

/**
 * A Vite Web Worker is its own bundle, built with `worker.plugins` only: the
 * main graphs' plugins never see its imports. These builds run the very
 * `vite.config.ts` the managed (platform) build gives the Sandbox CLI, with
 * the pinned toolchain, and put a worker in the Starter Theme. `zod` is
 * installed beside the toolchain here but is not an approved Theme
 * dependency, so a worker importing it must be refused exactly as the main
 * graph refuses it.
 */

const BUILD_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 150_000;

type Target = "preview" | "runtime";

function themeWith(
  extra: ReadonlyArray<{ path: string; content: string }>,
  footerAppend: string,
) {
  return [
    ...STARTER_THEME_FILES.map((file) =>
      file.path === "src/components/Footer.tsx"
        ? { ...file, content: `${file.content}\n${footerAppend}` }
        : file,
    ),
    ...extra.map((file) => ({ ...file, mimeType: "text/typescript" })),
  ];
}

/** A Footer helper that starts the worker through `?worker`. */
const WORKER_IMPORT = `import ProbeWorker from "../workers/probe?worker";
export function startProbeWorker() {
  return new ProbeWorker();
}
`;

/** The same worker, started through `new Worker(new URL(...))`. */
const WORKER_URL = `export function startProbeWorker() {
  return new Worker(new URL("../workers/probe.ts", import.meta.url), { type: "module" });
}
`;

/**
 * The managed build accepts no Vite plugin from a Theme: the plan writes
 * its own `vite.config.ts` over any the Theme has, and the Sandbox CLI is
 * pointed at it. To show the worker graph check holds even when another
 * resolver answers before the enforcer, this config wraps the generated one
 * and puts a hostile resolver ahead of it, at both levels (first in the list,
 * resolveId ordered "pre"), mapping a made-up name onto an unapproved
 * package's file.
 */
function hostileWrapperConfig(target: string): string {
  return `import base from "./vite.config.ts";
const hostile = {
  name: "hostile-pre-resolver",
  enforce: "pre",
  resolveId: {
    order: "pre",
    handler(source) {
      return source === "sneaky-package" ? ${JSON.stringify(target)} : null;
    },
  },
};
export default {
  ...base,
  worker: {
    ...base.worker,
    plugins: () => [hostile, ...base.worker.plugins()],
  },
};
`;
}

async function buildManaged(
  files: ReturnType<typeof themeWith>,
  target: Target,
  options: { hostileResolverTarget?: string } = {},
): Promise<
  | { ok: true; outDir: string; cleanup: () => Promise<void> }
  | { ok: false; output: string }
> {
  const workspace = await fs.mkdtemp(
    path.join(process.cwd(), ".morph-worker-guard-"),
  );
  const cleanup = () => fs.rm(workspace, { recursive: true, force: true });
  const localPath = (file: string) => {
    if (file !== "/workspace" && !file.startsWith("/workspace/"))
      throw new Error("unexpected workspace path");
    return path.join(workspace, file.slice("/workspace".length));
  };
  try {
    const plan = planThemeSandboxWorkspace({
      files,
      entry: "src/routes/index.tsx",
      buildId: `worker-guard-${target}`,
      approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
      mode: "build",
      // The static preview target is the default, chosen by
      // MORPH_THEME_BUILD_TARGET below as the Sandbox runner chooses it.
      ...(target === "runtime" ? { buildTarget: "runtime" as const } : {}),
      hostWorkspaceRoot: workspace,
      toolchainRoot: process.cwd(),
    });
    if (!plan.ok) throw new Error(plan.errorMessage);
    await materializeThemeSandboxWorkspace(
      {
        async mkdir(file) {
          await fs.mkdir(localPath(file), { recursive: true });
        },
        async writeFile(file, content) {
          await fs.writeFile(localPath(file), content);
        },
      },
      plan.workspaceFiles,
    );
    await fs.symlink(
      path.join(process.cwd(), "node_modules"),
      path.join(workspace, "node_modules"),
      "dir",
    );
    let configPath = path.join(workspace, "vite.config.ts");
    if (options.hostileResolverTarget) {
      configPath = path.join(workspace, "vite.hostile.config.ts");
      await fs.writeFile(
        configPath,
        hostileWrapperConfig(options.hostileResolverTarget),
      );
    }
    try {
      await promisify(execFile)(
        process.execPath,
        [
          path.join(process.cwd(), "node_modules/vite/bin/vite.js"),
          "build",
          "--config",
          configPath,
        ],
        {
          cwd: workspace,
          env: {
            ...process.env,
            NODE_ENV: "production",
            MORPH_THEME_BUILD_TARGET: target,
            WRANGLER_SEND_METRICS: "false",
          },
          timeout: BUILD_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (error) {
      const failed = error as Error & { stdout?: string; stderr?: string };
      await cleanup();
      return {
        ok: false,
        output: [failed.message, failed.stdout, failed.stderr].join("\n"),
      };
    }
    return {
      ok: true,
      outDir: path.join(
        workspace,
        target === "runtime" ? "dist/runtime" : "dist/preview",
      ),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

describe("the generated config's worker plugins", () => {
  it.each([
    { mode: "build", buildTarget: undefined },
    { mode: "build", buildTarget: "runtime" },
    { mode: "preview-server", buildTarget: undefined },
  ] as const)(
    "put the enforcer first, ordered pre, in every worker bundle ($mode $buildTarget)",
    ({ mode, buildTarget }) => {
      const plan = planThemeSandboxWorkspace({
        files: STARTER_THEME_FILES,
        entry: "src/routes/index.tsx",
        buildId: "worker-plugins",
        approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
        mode,
        ...(buildTarget ? { buildTarget } : {}),
        ...(mode === "preview-server"
          ? { previewContent: { templates: {}, pages: {} } }
          : {}),
      });
      if (!plan.ok) throw new Error(plan.errorMessage);
      const config = plan.workspaceFiles.find(
        (file) => file.path === "/workspace/vite.config.ts",
      );
      const source = config && "content" in config ? config.content : "";
      const worker = source.slice(source.indexOf("  worker: {"));
      expect(worker.indexOf("workerDependencyEnforcerPlugin,")).toBeGreaterThan(0);
      expect(worker.indexOf("workerDependencyEnforcerPlugin,")).toBeLessThan(
        worker.indexOf("workerGraphGuardPlugin,"),
      );
      // The main graphs' handler itself, at the hook's "pre" order.
      expect(source).toContain(
        'resolveId: { order: "pre", handler: dependencyEnforcerPlugin.resolveId }',
      );
    },
  );
});

describe("Web Workers in the managed Theme build", () => {
  it(
    "refuses a ?worker that imports an installed package the Theme may not use",
    async () => {
      const built = await buildManaged(
        themeWith(
          [
            {
              path: "src/workers/probe.ts",
              content: `import { z } from "zod";
self.onmessage = (event: MessageEvent) => self.postMessage(z.string().safeParse(event.data).success);
`,
            },
          ],
          WORKER_IMPORT,
        ),
        "preview",
      );
      if (built.ok) await built.cleanup();
      expect(built.ok).toBe(false);
      // The main graph's own error, word for word.
      expect((built as { output: string }).output).toContain(
        'UNAPPROVED_DEPENDENCY: Theme imports unapproved module "zod".',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses the same import from a new Worker(new URL(...)) worker in the runtime build",
    async () => {
      const built = await buildManaged(
        themeWith(
          [
            {
              path: "src/workers/probe.ts",
              content: `import { z } from "zod";
self.onmessage = (event: MessageEvent) => self.postMessage(z.string().safeParse(event.data).success);
`,
            },
          ],
          WORKER_URL,
        ),
        "runtime",
      );
      if (built.ok) await built.cleanup();
      expect(built.ok).toBe(false);
      expect((built as { output: string }).output).toContain(
        'UNAPPROVED_DEPENDENCY: Theme imports unapproved module "zod".',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a worker that reaches into node_modules by path",
    async () => {
      const built = await buildManaged(
        themeWith(
          [
            {
              path: "src/workers/probe.ts",
              content: `import { z } from "/node_modules/zod/index.js";
self.onmessage = (event: MessageEvent) => self.postMessage(z.string().safeParse(event.data).success);
`,
            },
          ],
          WORKER_IMPORT,
        ),
        "preview",
      );
      if (built.ok) await built.cleanup();
      expect(built.ok).toBe(false);
      expect((built as { output: string }).output).toContain(
        "UNAPPROVED_DEPENDENCY_PATH:",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses an unapproved package a resolver ahead of the enforcer handed the worker",
    async () => {
      const zod = await fs.realpath(
        path.join(process.cwd(), "node_modules/zod/index.js"),
      );
      const built = await buildManaged(
        themeWith(
          [
            {
              path: "src/workers/probe.ts",
              content: `import { z } from "sneaky-package";
self.onmessage = (event: MessageEvent) => self.postMessage(z.string().safeParse(event.data).success);
`,
            },
          ],
          WORKER_IMPORT,
        ),
        "preview",
        { hostileResolverTarget: zod },
      );
      if (built.ok) await built.cleanup();
      expect(built.ok).toBe(false);
      // Not the enforcer's resolveId (the hostile resolver answered first):
      // the check of the worker's built module graph.
      const output = (built as { output: string }).output;
      expect(output).toContain("UNAPPROVED_DEPENDENCY: Theme worker module");
      expect(output).toContain('from package "zod", which is not an approved dependency.');
    },
    TEST_TIMEOUT_MS,
  );

  it.each(["preview", "runtime"] as const)(
    "still builds a worker that imports an approved package, an alias, a baseUrl path and its own module (%s build)",
    async (target) => {
      const built = await buildManaged(
        themeWith(
          [
            {
              path: "tsconfig.json",
              content: JSON.stringify({
                compilerOptions: { baseUrl: "src", paths: { "@w/*": ["workers/*"] } },
              }),
            },
            {
              path: "src/workers/label.ts",
              content: `export const WORKER_LABEL = "worker-guard-allowed-probe";
`,
            },
            {
              path: "src/workers/alias-label.ts",
              content: `export const ALIAS_LABEL = "worker-guard-alias-probe";
`,
            },
            {
              path: "src/workers/base-url-label.ts",
              content: `export const BASE_URL_LABEL = "worker-guard-base-url-probe";
`,
            },
            {
              path: "src/workers/probe.ts",
              content: `import { clsx } from "clsx";
import { WORKER_LABEL } from "./label";
import { ALIAS_LABEL } from "@w/alias-label";
import { BASE_URL_LABEL } from "workers/base-url-label";
self.onmessage = (event: MessageEvent) =>
  self.postMessage(clsx(WORKER_LABEL, ALIAS_LABEL, BASE_URL_LABEL, String(event.data)));
`,
            },
          ],
          WORKER_IMPORT,
        ),
        target,
      );
      if (!built.ok) throw new Error(built.output);
      try {
        const entries = await fs.readdir(built.outDir, { recursive: true });
        const scripts = await Promise.all(
          entries
            .filter((file) => file.endsWith(".js"))
            .map((file) => fs.readFile(path.join(built.outDir, file), "utf8")),
        );
        // The worker was bundled, with each of its modules inlined.
        for (const label of [
          "worker-guard-allowed-probe",
          "worker-guard-alias-probe",
          "worker-guard-base-url-probe",
        ]) {
          expect(scripts.some((script) => script.includes(label))).toBe(true);
        }
      } finally {
        await built.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
