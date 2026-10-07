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
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { planNativeStartBuild } from "./tanstack-start-native-build";

/**
 * The module hook a native build's Node process loads first: the project's
 * `cloudflare(...)` call gets `inspectorPort: false`, so the server Start
 * prerenders through opens no debugger port for a concurrent process to take
 * between the plugin choosing it and Miniflare binding it.
 */
const PROJECT_CONFIG = `import { cloudflare, getLocalWorkerdCompatibilityDate } from "@cloudflare/vite-plugin";
console.log(JSON.stringify({
  own: cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9229 }),
  none: cloudflare(),
  date: getLocalWorkerdCompatibilityDate(),
}));
`;
/** Stands in for the plugin: answers with what it was given. */
const PLUGIN_FILES = {
  "package.json": JSON.stringify({
    name: "@cloudflare/vite-plugin",
    type: "module",
    exports: { ".": { import: "./dist/index.mjs" } },
  }),
  "dist/index.mjs": `import { internal } from "./internal.mjs";
export function cloudflare(options) { return { options: options ?? null, internal }; }
export function getLocalWorkerdCompatibilityDate() { return "2025-09-02"; }
`,
  "dist/internal.mjs": `export const internal = "the plugin's own import";\n`,
};

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function workspace(): { root: string; env: Record<string, string> } {
  const plan = planNativeStartBuild([
    { path: "vite.config.ts", content: "export default {};\n" },
    { path: "wrangler.jsonc", content: '{ "name": "hooks" }' },
  ]);
  if (!plan.ok) throw new Error(plan.message);
  const root = mkdtempSync(join(tmpdir(), "native-build-hooks-"));
  cleanup.push(root);
  for (const file of plan.workspaceFiles) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.content);
  }
  return { root, env: { ...plan.env } };
}

const run = (root: string, script: string, env: Record<string, string>) =>
  promisify(execFile)(process.execPath, [script], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", ...env },
    timeout: 30_000,
  }).then(({ stdout }) => JSON.parse(stdout));

describe("a native build's module hook", () => {
  it("turns the Cloudflare plugin's debugger port off, and changes nothing else", async () => {
    const { root, env } = workspace();
    for (const [path, content] of Object.entries(PLUGIN_FILES)) {
      const full = join(root, "node_modules/@cloudflare/vite-plugin", path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    writeFileSync(join(root, "project-config.mjs"), PROJECT_CONFIG);

    const hooked = await run(root, "project-config.mjs", env);
    expect(hooked).toEqual({
      own: {
        options: { viteEnvironment: { name: "ssr" }, inspectorPort: false },
        internal: "the plugin's own import",
      },
      none: {
        options: { inspectorPort: false },
        internal: "the plugin's own import",
      },
      date: "2025-09-02",
    });

    // Without the hook, the project's options reach the plugin as written:
    // the difference above is the hook's.
    const { NODE_OPTIONS: _hook, ...withoutHook } = env;
    const unhooked = await run(root, "project-config.mjs", withoutHook);
    expect(unhooked.own.options.inspectorPort).toBe(9229);
    expect(unhooked.none.options).toBeNull();
  });

  it("reaches the plugin the toolchain installs, where pnpm puts it", async () => {
    const { root, env } = workspace();
    symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"));
    writeFileSync(
      join(root, "probe.mjs"),
      `import * as plugin from "@cloudflare/vite-plugin";
console.log(JSON.stringify({
  shimmed: plugin.cloudflare.toString().includes("inspectorPort: false"),
  exports: Object.keys(plugin).sort(),
}));
`,
    );
    const hooked = await run(root, "probe.mjs", env);
    const { NODE_OPTIONS: _hook, ...withoutHook } = env;
    const unhooked = await run(root, "probe.mjs", withoutHook);
    expect(hooked.shimmed).toBe(true);
    expect(unhooked.shimmed).toBe(false);
    expect(hooked.exports).toEqual(unhooked.exports);
  });
});
