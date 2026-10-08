import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { NativePrerenderContent } from "../compiler/theme-prerender-content";
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
}): Promise<AstroBuildRun> {
  const nonce = options.nonce ?? newNonce();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "morph-astro-a3-"));
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
    let exitCode = 0;
    let output = "";
    try {
      const result = await promisify(execFile)(
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
          },
          maxBuffer: 32 * 1024 * 1024,
          timeout: 180_000,
        },
      );
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      const failed = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      exitCode = typeof failed.code === "number" ? failed.code : 1;
      output = `${failed.stdout ?? ""}\n${failed.stderr ?? String(error)}`;
    }
    return {
      exitCode,
      output,
      outputs: walk(workspace, workspace, new Map()),
      nonce,
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

export const text = (content: Uint8Array | string | undefined) =>
  content === undefined
    ? undefined
    : typeof content === "string"
      ? content
      : new TextDecoder().decode(content);
