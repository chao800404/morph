import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NativePrerenderContent } from "../compiler/theme-prerender-content";
import {
  NATIVE_BUILD_HOOKS_PATH,
  NATIVE_BUILD_LOADER_PATH,
  NATIVE_BUILD_NODE_OPTIONS,
  nativeBuildHooksSource,
  nativeBuildLoaderSource,
} from "./tanstack-start-native-wrapper";
import {
  ASTRO_WRAPPER_CONFIG_PATH,
  astroPrerenderWorkspaceFiles,
  type AstroPrerenderTestFaults,
} from "./astro-native-prerender";

/**
 * The Astro toolchain the Sandbox image installs, installed from the same
 * lockfile into the checkout (`pnpm toolchain:astro`). CI installs it before
 * the tests; a checkout without it skips the build tests and says so.
 */
export const ASTRO_TOOLCHAIN_NODE_MODULES = path.resolve(
  "sandbox/toolchains/astro-7.3/node_modules",
);

export const astroToolchainInstalled = fs.existsSync(
  path.join(ASTRO_TOOLCHAIN_NODE_MODULES, "astro/package.json"),
);

export const newNonce = () => randomBytes(16).toString("hex");

export type AstroBuildRun = Readonly<{
  exitCode: number;
  output: string;
  /** Every file in the workspace after the build, but its packages. */
  outputs: ReadonlyMap<string, Uint8Array>;
  nonce: string;
  /** Command lines of the workerd processes the build started. */
  workerdArgs: readonly string[];
}>;

function walk(
  dir: string,
  base: string,
  into: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (entry.isDirectory()) walk(full, base, into);
    else if (entry.isFile()) into.set(rel, fs.readFileSync(full));
  }
  return into;
}

/**
 * One real `astro build` of `files` with Morph's prerender files, as a native
 * build runs it: the project's config through Morph's wrapper, the pinned
 * toolchain, telemetry off.
 */
export async function runAstroPrerenderBuild(options: {
  files: readonly Readonly<{ path: string; content: string }>[];
  prerenderContent?: NativePrerenderContent;
  testFaults?: AstroPrerenderTestFaults;
  /** The nonce the workspace's files are written with. */
  nonce?: string;
  /** Files already in the workspace before the build, e.g. stale records. */
  before?: readonly Readonly<{ path: string; content: string }>[];
  /**
   * Load the module hook a native build loads first, which gives every
   * `cloudflare(...)` `inspectorPort: false` (tanstack-start-native-wrapper.ts).
   */
  inspectorHook?: boolean;
  /**
   * Build at this absolute path rather than a fresh temporary one. The
   * server bundle records the workspace's path, so builds are compared file
   * for file only at the same one (the Sandbox always builds in /workspace).
   */
  workspace?: string;
  /** More environment for the build, e.g. a fixed `ASTRO_KEY`. */
  env?: Readonly<Record<string, string>>;
}): Promise<AstroBuildRun> {
  const nonce = options.nonce ?? newNonce();
  const workspace = options.workspace
    ? (fs.mkdirSync(options.workspace, { recursive: true }), options.workspace)
    : fs.mkdtempSync(path.join(os.tmpdir(), "morph-astro-a3-"));
  try {
    const files = [
      ...options.files,
      ...(options.before ?? []),
      ...astroPrerenderWorkspaceFiles({
        themeConfigPath: "astro.config.mjs",
        prerenderContent: options.prerenderContent,
        nonce,
        testFaults: options.testFaults,
      }),
      ...(options.inspectorHook
        ? [
            { path: NATIVE_BUILD_HOOKS_PATH, content: nativeBuildHooksSource() },
            { path: NATIVE_BUILD_LOADER_PATH, content: nativeBuildLoaderSource() },
          ]
        : []),
    ];
    for (const file of files) {
      const target = path.join(workspace, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content);
    }
    fs.symlinkSync(
      ASTRO_TOOLCHAIN_NODE_MODULES,
      path.join(workspace, "node_modules"),
    );
    const { exitCode, output, workerdArgs } = await new Promise<{
      exitCode: number;
      output: string;
      workerdArgs: string[];
    }>((resolve) => {
      const seen = new Set<string>();
      const child = execFile(
        process.execPath,
        [
          path.join(ASTRO_TOOLCHAIN_NODE_MODULES, "astro/bin/astro.mjs"),
          "build",
          "--config",
          ASTRO_WRAPPER_CONFIG_PATH,
        ],
        {
          cwd: workspace,
          env: {
            PATH: process.env.PATH ?? "",
            HOME: workspace,
            ASTRO_TELEMETRY_DISABLED: "1",
            ...options.env,
            ...(options.inspectorHook
              ? { NODE_OPTIONS: NATIVE_BUILD_NODE_OPTIONS }
              : {}),
          },
          maxBuffer: 32 * 1024 * 1024,
          timeout: 180_000,
        },
        (error, stdout, stderr) => {
          clearInterval(watch);
          const code = (error as { code?: unknown } | null)?.code;
          resolve({
            exitCode: error ? (typeof code === "number" ? code : 1) : 0,
            output: `${stdout}\n${stderr}`,
            workerdArgs: [...seen],
          });
        },
      );
      // Every workerd the build starts, by its command line: Miniflare passes
      // the debugger port as --inspector-addr.
      const watch = setInterval(() => {
        for (const cmd of descendantCommands(child.pid)) {
          if (cmd.includes("workerd")) seen.add(cmd);
        }
      }, 25);
    });
    return {
      exitCode,
      output,
      outputs: walk(workspace, workspace, new Map()),
      nonce,
      workerdArgs,
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/** Command lines of every running descendant of `pid` (Linux /proc). */
function descendantCommands(pid: number | undefined): string[] {
  if (pid === undefined || !fs.existsSync("/proc")) return [];
  const parents = new Map<number, number>();
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parents.set(Number(entry), ppid);
    } catch {
      // gone
    }
  }
  const commands: string[] = [];
  for (const candidate of parents.keys()) {
    let current: number | undefined = candidate;
    for (let depth = 0; current && depth < 32; depth++) {
      current = parents.get(current);
      if (current === pid) {
        try {
          commands.push(
            fs
              .readFileSync(`/proc/${candidate}/cmdline`, "utf8")
              .replaceAll("\0", " ")
              .trim(),
          );
        } catch {
          // gone
        }
        break;
      }
    }
  }
  return commands;
}

export const text = (content: Uint8Array | string | undefined) =>
  content === undefined
    ? undefined
    : typeof content === "string"
      ? content
      : new TextDecoder().decode(content);
