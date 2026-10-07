// @vitest-environment node
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planNativeStartBuild } from "./tanstack-start-native-build";

/**
 * The native build's import guard, in a real Vite build: what a Theme may
 * import is decided by where the import resolves, after the project's own
 * aliases. Built as a plain library bundle so each case takes seconds rather
 * than a whole Start build; the guard is the same plugin in the same wrapper.
 */
const VITE_CONFIG = `import { defineConfig } from "vite";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  build: { lib: { entry: "src/entry.ts", formats: ["es"], fileName: "entry" }, outDir: "out" },
});
`;
const WRANGLER = `{ "name": "guard-test", "compatibility_date": "2025-09-02" }`;

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

/**
 * Builds a project whose entry is `entry(workspace)`. A file holding
 * `SECRET` sits beside the workspace, outside it, at `secretPath`.
 */
async function build(
  entry: (paths: { secretName: string; secretPath: string }) => string,
  extra: Record<string, string> = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), "native-guard-"));
  const secretName = `${basename(workspace)}-secret.txt`;
  const secretPath = join(dirname(workspace), secretName);
  writeFileSync(secretPath, "SECRET");
  cleanup.push(workspace, secretPath);

  const plan = planNativeStartBuild([
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "wrangler.jsonc", content: WRANGLER },
    { path: "src/entry.ts", content: entry({ secretName, secretPath }) },
    ...Object.entries(extra).map(([path, content]) => ({ path, content })),
  ]);
  if (!plan.ok) throw new Error(plan.message);
  for (const file of plan.workspaceFiles) {
    mkdirSync(dirname(join(workspace, file.path)), { recursive: true });
    writeFileSync(join(workspace, file.path), file.content);
  }
  symlinkSync(
    join(process.cwd(), "node_modules"),
    join(workspace, "node_modules"),
  );
  const [, ...args] = plan.command;
  return promisify(execFile)(
    process.execPath,
    ["node_modules/vite/bin/vite.js", ...args, "--logLevel", "error"],
    { cwd: workspace, env: { ...process.env, ...plan.env }, timeout: 60_000 },
  ).then(
    () => ({ ok: true as const, output: "" }),
    (error: { stderr?: string; message: string }) => ({
      ok: false as const,
      output: `${error.stderr ?? ""}${error.message}`,
    }),
  );
}

describe("the native build's import guard", () => {
  it("lets a Theme import its own files, through its own aliases, and approved packages", async () => {
    const result = await build(
      () =>
        `import { label } from "@/lib/label";\nimport clsx from "clsx";\nexport default clsx(label);\n`,
      { "src/lib/label.ts": `export const label = "ok";\n` },
    );
    expect(result).toEqual({ ok: true, output: "" });
  }, 90_000);

  it("refuses a package that is installed but not approved", async () => {
    const result = await build(
      () =>
        `import { betterAuth } from "better-auth";\nexport default betterAuth;\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain(
      'UNAPPROVED_DEPENDENCY: Theme imports "better-auth"',
    );
  }, 90_000);

  it("refuses a file outside the Theme by a relative path", async () => {
    const result = await build(
      ({ secretName }) =>
        `import secret from "../../${secretName}?raw";\nexport default secret;\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("WORKSPACE_PATH_ESCAPE");
  }, 90_000);

  it("refuses a file outside the Theme by an absolute path", async () => {
    const result = await build(
      ({ secretPath }) =>
        `import secret from ${JSON.stringify(`${secretPath}?raw`)};\nexport default secret;\n`,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("WORKSPACE_PATH_ESCAPE");
  }, 90_000);
});
