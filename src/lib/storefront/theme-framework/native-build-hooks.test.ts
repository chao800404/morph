// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  nativeAdapterRefusalMessage,
  planNativeStartBuild,
} from "./tanstack-start-native-build";
import {
  NATIVE_ADAPTER_CALLS_PATH,
  NATIVE_ADAPTER_REFUSAL_PATH,
  nativeBuildLoaderSource,
} from "./tanstack-start-native-wrapper";

/** sha256 of the shim every native build had before the adapter check. */
const LEGACY_LOADER_SHA256 =
  "2d4734c0cfd5551e6cd2e02e1f8ec3d2ee97fd84b0e57dba261770d69e662677";

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
    // The Wrangler key contract requires a compatibility date.
    {
      path: "wrangler.jsonc",
      content: '{ "name": "hooks", "compatibility_date": "2025-09-02" }',
    },
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
        options: {
          viteEnvironment: { name: "ssr" },
          inspectorPort: false,
          // A native Start build is local: forced, whatever the project says.
          remoteBindings: false,
        },
        internal: "the plugin's own import",
      },
      none: {
        options: { inspectorPort: false, remoteBindings: false },
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

  /** A project config that calls the plugin with `options` (source). */
  const callWith = (options: string) => `import { cloudflare } from "@cloudflare/vite-plugin";
let result;
try {
  result = { options: cloudflare(${options}).options };
} catch (error) {
  result = { refused: error.message };
}
console.log(JSON.stringify(result));
`;

  function pluginWorkspace() {
    const { root, env } = workspace();
    for (const [path, content] of Object.entries(PLUGIN_FILES)) {
      const full = join(root, "node_modules/@cloudflare/vite-plugin", path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return { root, env };
  }

  const remedy = '; keep wrangler.jsonc at the project root.';
  it.each([
    [
      "configPath",
      '{ configPath: "./other.jsonc" }',
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes configPath to cloudflare(). Morph supplies the Wrangler config the plugin reads, from wrangler.jsonc at the project root; a config path would replace it. Remove "configPath"${remedy}`,
    ],
    [
      "the config customiser",
      "{ config: () => ({ vars: { A: 1 } }) }",
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes config to cloudflare(). A config customiser rewrites the Worker config after Morph has checked it. Remove "config"${remedy}`,
    ],
    [
      "auxiliary Workers",
      '{ auxiliaryWorkers: [{ configPath: "./aux.jsonc" }] }',
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes auxiliaryWorkers to cloudflare(). Morph deploys one Theme Worker; auxiliary Workers would be built but never checked or deployed. Remove "auxiliaryWorkers"${remedy}`,
    ],
    [
      "remote bindings",
      "{ remoteBindings: true }",
      `NATIVE_REMOTE_BINDING: vite.config.ts passes remoteBindings to cloudflare(). Builds never connect to a Cloudflare account. Remove "remoteBindings"${remedy}`,
    ],
    [
      "a tunnel",
      '{ tunnel: { name: "x" } }',
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes tunnel to cloudflare(). Builds never open a tunnel. Remove "tunnel"${remedy}`,
    ],
    [
      "experimental options",
      '{ experimental: { prerenderWorker: { configPath: "./p.jsonc" } } }',
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes experimental to cloudflare(). Experimental options change what the build emits, and Morph has not certified them. Remove "experimental"${remedy}`,
    ],
    [
      "an assets-only build",
      "{ assetsOnly: true }",
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes assetsOnly to cloudflare(). Morph publishes the Theme Worker; an assets-only build has none. Remove "assetsOnly"${remedy}`,
    ],
    [
      "child environments",
      '{ viteEnvironment: { name: "ssr", childEnvironments: ["rsc"] } }',
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes viteEnvironment other than { name } to cloudflare(). Morph builds one Worker environment, named by viteEnvironment.name. Remove "viteEnvironment other than { name }"${remedy}`,
    ],
    [
      "an option Morph does not know",
      "{ someFutureOption: 1 }",
      `NATIVE_ADAPTER_OPTION: vite.config.ts passes someFutureOption to cloudflare(). Morph has not certified this option of the Cloudflare plugin. Remove "someFutureOption"${remedy}`,
    ],
  ])(
    "refuses %s where the project calls the plugin, and records why",
    async (_name, options, message) => {
      const { root, env } = pluginWorkspace();
      writeFileSync(join(root, "project-config.mjs"), callWith(options));
      expect(await run(root, "project-config.mjs", env)).toEqual({
        refused: message,
      });
      const recorded = readFileSync(
        join(root, NATIVE_ADAPTER_REFUSAL_PATH),
        "utf8",
      );
      expect(JSON.parse(recorded).message).toBe(message);
      expect(nativeAdapterRefusalMessage(recorded)).toBe(message);
    },
  );

  it.each([
    [
      "a getter",
      '{ viteEnvironment: { name: "ssr" }, get persistState() { return false; } }',
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes persistState as a getter to cloudflare(). Morph reads each plugin option once, as a value. Remove "persistState as a getter"; keep wrangler.jsonc at the project root.',
    ],
    [
      "an inherited setting",
      'Object.assign(Object.create({ configPath: "./x.jsonc" }), { viteEnvironment: { name: "ssr" } })',
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes options that are not a plain object to cloudflare(). Morph reads the plugin options as a plain object, not one that inherits settings. Remove "options that are not a plain object"; keep wrangler.jsonc at the project root.',
    ],
    [
      "an inherited child environment",
      '{ viteEnvironment: Object.assign(Object.create({ childEnvironments: ["rsc"] }), { name: "ssr" }) }',
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes viteEnvironment options that are not a plain object to cloudflare(). Morph reads the plugin options as a plain object, not one that inherits settings. Remove "viteEnvironment options that are not a plain object"; keep wrangler.jsonc at the project root.',
    ],
    [
      "a hidden (non-enumerable) option",
      'Object.defineProperty({ viteEnvironment: { name: "ssr" } }, "configPath", { value: "./x.jsonc", enumerable: false })',
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes configPath to cloudflare(). Morph supplies the Wrangler config the plugin reads, from wrangler.jsonc at the project root; a config path would replace it. Remove "configPath"; keep wrangler.jsonc at the project root.',
    ],
    [
      "a symbol key",
      '{ [Symbol("x")]: 1 }',
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes options with a symbol key to cloudflare(). Morph reads the plugin options by name. Remove "options with a symbol key"; keep wrangler.jsonc at the project root.',
    ],
    [
      // JSON.parse makes "__proto__" an own key; copied by assignment it
      // would give the snapshot an inherited childEnvironments.
      "an own __proto__ key",
      `JSON.parse('{"viteEnvironment":{"__proto__":{"childEnvironments":["rsc"]},"name":"ssr"}}')`,
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes __proto__ in viteEnvironment options to cloudflare(). Morph reads the plugin options as plain settings, not prototypes. Remove "__proto__ in viteEnvironment options"; keep wrangler.jsonc at the project root.',
    ],
    [
      "a constructor key",
      '{ viteEnvironment: { name: "ssr" }, ["constructor"]: 1 }',
      'NATIVE_ADAPTER_OPTION: vite.config.ts passes constructor in options to cloudflare(). Morph reads the plugin options as plain settings, not prototypes. Remove "constructor in options"; keep wrangler.jsonc at the project root.',
    ],
  ])(
    "refuses options given as %s, which a check of their keys alone would miss",
    async (_name, options, message) => {
      const { root, env } = pluginWorkspace();
      writeFileSync(join(root, "project-config.mjs"), callWith(options));
      expect(await run(root, "project-config.mjs", env)).toEqual({
        refused: message,
      });
    },
  );

  it("gives the plugin the checked snapshot, frozen, marks what it returns and counts the call", async () => {
    const { root, env } = pluginWorkspace();
    writeFileSync(
      join(root, "project-config.mjs"),
      `import { cloudflare } from "@cloudflare/vite-plugin";
const environment = { name: "ssr" };
const made = cloudflare({ viteEnvironment: environment });
environment.childEnvironments = ["late"];
console.log(JSON.stringify({
  options: made.options,
  frozen: Object.isFrozen(made.options.viteEnvironment),
  // Registered where only this pass's shim and wrapper look (the plan here
  // has no nonce, so the key ends in ":").
  marked: globalThis[Symbol.for("morph.cloudflare.registry:")].has(made),
  // A copy of the plugin object is not registered: the mark is not a
  // property a config could copy or set.
  copied: globalThis[Symbol.for("morph.cloudflare.registry:")].has({ ...made }),
}));
`,
    );
    expect(await run(root, "project-config.mjs", env)).toEqual({
      // The late change to the project's own object does not reach it.
      options: {
        viteEnvironment: { name: "ssr" },
        inspectorPort: false,
        remoteBindings: false,
      },
      frozen: true,
      marked: true,
      copied: false,
    });
    expect(
      JSON.parse(readFileSync(join(root, NATIVE_ADAPTER_CALLS_PATH), "utf8")),
    ).toEqual({
      nonce: "",
      calls: [{ keys: ["viteEnvironment"], environment: "ssr" }],
    });
  });

  it("accepts the guide's options and the local ones, and records nothing", async () => {
    const { root, env } = pluginWorkspace();
    writeFileSync(
      join(root, "project-config.mjs"),
      callWith(
        '{ viteEnvironment: { name: "ssr" }, persistState: false, inspectorPort: 9230, remoteBindings: false, tunnel: false }',
      ),
    );
    expect(await run(root, "project-config.mjs", env)).toEqual({
      options: {
        viteEnvironment: { name: "ssr" },
        persistState: false,
        inspectorPort: false,
        remoteBindings: false,
        tunnel: false,
      },
    });
    expect(existsSync(join(root, NATIVE_ADAPTER_REFUSAL_PATH))).toBe(false);
  });

  it("leaves every other native build's shim as it was (Astro's)", () => {
    // sha256 of nativeBuildLoaderSource() on 0a01b30, before the check.
    expect(
      createHash("sha256").update(nativeBuildLoaderSource()).digest("hex"),
    ).toBe(LEGACY_LOADER_SHA256);
    expect(nativeBuildLoaderSource()).not.toContain(
      "morphCheckCloudflareOptions",
    );
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
