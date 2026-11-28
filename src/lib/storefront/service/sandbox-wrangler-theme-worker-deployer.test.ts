import { describe, expect, it, vi } from "vitest";
import {
  SandboxWranglerThemeWorkerDeployer,
  deploymentSandboxSessionId,
  scrubDeploymentSecrets,
  wranglerDeployConfig,
} from "./sandbox-wrangler-theme-worker-deployer";
import {
  expectValidSandboxId,
  sandboxIdViolation,
  validatingGetSandbox,
} from "./sandbox-id.test-support";
import type { ThemeWorkerDeploymentRequest } from "./theme-worker-deployer.types";
import {
  THEME_BUILD_ID_VAR,
  THEME_BUILD_MATCH_MODULE,
  themeBuildMatchModuleSource,
} from "./theme-worker-build-match";

const TOKEN = "cf_live_token_abcdef0123456789";
const ACCOUNT = "acct_0123456789abcdef";

const request: ThemeWorkerDeploymentRequest = {
  storefrontId: "sf_1",
  releaseId: "rel_1",
  themeBuildId: "bld_1",
  artifactPrefix: "themes/th_1/builds/bld_1",
  plan: {
    scriptName: "morph-theme-sf-1",
    mainModule: "index.js",
    compatibilityDate: "2025-09-02",
    compatibilityFlags: ["nodejs_compat"],
    modules: [
      {
        modulePath: "index.js",
        artifactPath: "runtime/server/index.js",
        contentType: "application/javascript",
      },
      {
        modulePath: "assets/worker-entry.js",
        artifactPath: "runtime/server/assets/worker-entry.js",
        contentType: "application/javascript",
      },
    ],
    assets: [
      {
        servedPath: "/assets/app.js",
        artifactPath: "runtime/client/assets/app.js",
        contentType: "application/javascript",
      },
    ],
  },
};

function sandboxStub(exec: any) {
  const writes: Array<{ path: string }> = [];
  const session = {
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (path: string) => {
      writes.push({ path });
    }),
    readFile: vi.fn(),
    exec,
    destroy: vi.fn(async () => {}),
  };
  return { session, writes };
}

function r2() {
  return {
    get: vi.fn(async () => ({
      arrayBuffer: async () => new TextEncoder().encode("bytes").buffer,
    })),
  } as any;
}

function deployer(session: any, overrides: any = {}) {
  return new SandboxWranglerThemeWorkerDeployer({
    sandboxProvider: { getSandbox: validatingGetSandbox(session) },
    sandboxBinding: {},
    r2Bucket: r2(),
    credentials: { apiToken: TOKEN, accountId: ACCOUNT },
    ...overrides,
  });
}

describe("scrubDeploymentSecrets", () => {
  it("removes credentials from any surfaced text", () => {
    const text = `deploying with ${TOKEN} to ${ACCOUNT}`;
    const scrubbed = scrubDeploymentSecrets(text, [TOKEN, ACCOUNT]);
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).not.toContain(ACCOUNT);
    expect(scrubbed).toContain("[redacted]");
  });

  it("ignores empty and short values so ordinary text is not mangled", () => {
    expect(scrubDeploymentSecrets("hello world", [undefined, "", "abc"])).toBe(
      "hello world",
    );
  });
});

describe("deploymentSandboxSessionId", () => {
  it("never collides with a build session id", async () => {
    const id = await deploymentSandboxSessionId("sf_1", "rel_1");
    expect(id).not.toBe("bld_1");
    expect(id.startsWith("deploy-")).toBe(true);
  });

  it("is deterministic per pair and differs across pairs", async () => {
    const a = await deploymentSandboxSessionId("sf_1", "rel_1");
    expect(await deploymentSandboxSessionId("sf_1", "rel_1")).toBe(a);
    expect(await deploymentSandboxSessionId("sf_1", "rel_2")).not.toBe(a);
    expect(await deploymentSandboxSessionId("sf_2", "rel_1")).not.toBe(a);
    expect(await deploymentSandboxSessionId("a-b", "c")).not.toBe(
      await deploymentSandboxSessionId("a", "b-c"),
    );
  });

  it("is accepted by the Sandbox SDK id rule with real UUIDs", async () => {
    const id = await deploymentSandboxSessionId(
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
    expectValidSandboxId(id);
  });
});

describe("sandbox id guard in the fake provider", () => {
  const uuid = () => crypto.randomUUID();

  it("refuses the old deploy-<uuid>-<uuid> form and invalid characters", async () => {
    const { session } = sandboxStub(vi.fn());
    const get = validatingGetSandbox(session);
    const old = `deploy-${uuid()}-${uuid()}`;
    expect(old.length).toBeGreaterThan(63);
    await expect(get({}, old)).rejects.toThrow(/1-63 characters/);
    await expect(get({}, "deploy_SF.1")).rejects.toThrow(/lowercase DNS label/);
    expect(sandboxIdViolation("deploy-" + "a".repeat(32))).toBeNull();
  });

  it("fails a deploy whose provider is handed an invalid id", async () => {
    const { session } = sandboxStub(vi.fn());
    // The id builder is called inside the deployer module, so the old form is
    // injected at the provider boundary: the deployer must surface the error.
    const real = validatingGetSandbox(session);
    for (const bad of [`deploy-${uuid()}-${uuid()}`, "deploy_SF.1"]) {
      const result = await deployer(session, {
        sandboxProvider: { getSandbox: (b: unknown) => real(b, bad) },
      }).deploy(request);
      expect(result).toMatchObject({ success: false, reason: "DEPLOY_ERROR" });
    }
  });

  it("deploys with real UUID inputs through the validating provider", async () => {
    const exec = vi.fn(async () => ({
      exitCode: 0,
      success: true,
      stdout: "Current Version ID: 1a2b3c4d-5e6f",
      stderr: "",
    }));
    const { session } = sandboxStub(exec);
    const result = await deployer(session).deploy({
      ...request,
      storefrontId: uuid(),
      releaseId: uuid(),
    });
    expect(result.success).toBe(true);
  });
});

describe("SandboxWranglerThemeWorkerDeployer", () => {
  it("materializes only planned bytes and deploys with the pinned wrangler", async () => {
    let execCommand = "";
    const exec = vi.fn(async (command: string) => {
      execCommand = command;
      return {
        exitCode: 0,
        success: true,
        stdout: "Deployed morph-theme-sf-1\nCurrent Version ID: 1a2b3c4d-5e6f",
        stderr: "",
      };
    });
    const { session, writes } = sandboxStub(exec);

    const result = await deployer(session).deploy(request);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.scriptName).toBe("morph-theme-sf-1");
    expect(result.deploymentId).toBe("1a2b3c4d-5e6f");

    const paths = writes.map((w) => w.path);
    expect(paths).toContain("/workspace/deploy/server/index.js");
    expect(paths).toContain("/workspace/deploy/server/assets/worker-entry.js");
    expect(paths).toContain("/workspace/deploy/client/assets/app.js");
    expect(paths).toContain("/workspace/deploy/server/wrangler.json");
    expect(execCommand).toContain(
      "/opt/morph-platform/node_modules/.bin/wrangler deploy",
    );
  });

  // The SDK stores a string, and serialises anything else into its JSON
  // request as an object of numbered keys. Each artifact therefore has to
  // arrive as base64 that decodes to exactly what the build produced.
  it("hands every artifact to the sandbox as base64 of its exact bytes", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 10, 13]);
    const writes = new Map<string, { content: unknown; encoding?: string }>();
    const session = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(
        async (
          path: string,
          content: unknown,
          options?: { encoding?: string },
        ) => {
          writes.set(path, { content, encoding: options?.encoding });
        },
      ),
      readFile: vi.fn(),
      exec: vi.fn(async () => ({
        exitCode: 0,
        success: true,
        stdout: "Current Version ID: 1a2b3c4d-5e6f",
        stderr: "",
      })),
      destroy: vi.fn(async () => {}),
    };
    const bucket = {
      get: vi.fn(async () => ({
        arrayBuffer: async () => bytes.slice().buffer,
      })),
    };

    await deployer(session, { r2Bucket: bucket }).deploy(request);

    for (const path of [
      "/workspace/deploy/server/index.js",
      "/workspace/deploy/server/assets/worker-entry.js",
      "/workspace/deploy/client/assets/app.js",
    ]) {
      const write = writes.get(path);
      expect(write?.encoding, path).toBe("base64");
      expect(typeof write?.content, path).toBe("string");
      expect(
        Buffer.compare(Buffer.from(write!.content as string, "base64"), bytes),
        path,
      ).toBe(0);
    }
  });

  it("writes module rules so no_bundle chunks resolve at runtime", async () => {
    let config: any = null;
    const exec = vi.fn(async () => ({
      exitCode: 0,
      success: true,
      stdout: "",
      stderr: "",
    }));
    const session = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, content: any) => {
        if (path.endsWith("wrangler.json")) config = JSON.parse(content);
      }),
      readFile: vi.fn(),
      exec,
      destroy: vi.fn(async () => {}),
    };

    await deployer(session).deploy(request);

    expect(config.rules).toEqual([
      { type: "ESModule", globs: ["**/*.js", "**/*.mjs"] },
    ]);
    expect(config.name).toBe("morph-theme-sf-1");
    expect(config.main).toBe("index.js");
    expect(config.assets).toEqual({ directory: "../client" });
    // Reached through the service binding only: no public address of its own.
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.routes).toBeUndefined();
    expect(config.route).toBeUndefined();
  });

  it("gives the Worker its own assets binding when the plan names one", () => {
    expect(
      wranglerDeployConfig({ ...request.plan, assetsBinding: "ASSETS" }).assets,
    ).toEqual({ directory: "../client", binding: "ASSETS" });
    expect(wranglerDeployConfig(request.plan).assets).toEqual({
      directory: "../client",
    });
  });

  it("writes a native Start plan's kept settings, in full, and nothing for any other plan", () => {
    // No other plan gains a key: a platform or Astro deploy config is the
    // one it was before the Wrangler key contract.
    expect(Object.keys(wranglerDeployConfig(request.plan))).not.toEqual(
      expect.arrayContaining(["vars", "keep_vars", "observability"]),
    );
    const native = wranglerDeployConfig({
      ...request.plan,
      native: { vars: { STORE_LABEL: "probe" }, observabilityEnabled: true },
    });
    expect(native).toMatchObject({
      vars: { STORE_LABEL: "probe" },
      keep_vars: false,
      observability: { enabled: true },
      workers_dev: false,
      preview_urls: false,
    });
    // Nothing the contract keeps can switch the overrides back on.
    expect(native.routes).toBeUndefined();
    expect(native.account_id).toBeUndefined();
  });

  it("keeps a native plan's variable values out of failure output", async () => {
    const exec = vi.fn(async () => ({
      exitCode: 1,
      success: false,
      stdout: 'env.STORE_LABEL ("store-label-value")  Environment Variable',
      stderr: 'env.FEATURES ({"flag":true})',
    }));
    const { session } = sandboxStub(exec);
    const result = await deployer(session).deploy({
      ...request,
      plan: {
        ...request.plan,
        native: {
          vars: { STORE_LABEL: "store-label-value", FEATURES: { flag: true } },
          observabilityEnabled: false,
        },
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const surfaced = `${result.message}${result.diagnostics?.join("") ?? ""}`;
    expect(surfaced).not.toContain("store-label-value");
    expect(surfaced).not.toContain('{"flag":true}');
    expect(surfaced).toContain("env.FEATURES");
  });

  it("passes credentials only through the exec environment, never into the workspace", async () => {
    let execEnv: Record<string, string> = {};
    const exec = vi.fn(async (_command: string, options?: any) => {
      execEnv = options?.env ?? {};
      return { exitCode: 0, success: true, stdout: "", stderr: "" };
    });
    const written: string[] = [];
    const session = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (_path: string, content: any) => {
        written.push(typeof content === "string" ? content : "");
      }),
      readFile: vi.fn(),
      exec,
      destroy: vi.fn(async () => {}),
    };

    await deployer(session).deploy(request);

    expect(execEnv.CLOUDFLARE_API_TOKEN).toBe(TOKEN);
    expect(execEnv.CLOUDFLARE_ACCOUNT_ID).toBe(ACCOUNT);
    for (const content of written) {
      expect(content).not.toContain(TOKEN);
      expect(content).not.toContain(ACCOUNT);
    }
  });

  it("runs wrangler in its own directory, loading no .env, with the destination pinned", async () => {
    let execCommand = "";
    let execOptions: any = {};
    const exec = vi.fn(async (command: string, options?: any) => {
      execCommand = command;
      execOptions = options ?? {};
      return { exitCode: 0, success: true, stdout: "", stderr: "" };
    });
    const { session, writes } = sandboxStub(exec);

    await deployer(session).deploy(request);

    expect(execOptions.cwd).toBe("/workspace/deploy/run");
    expect(session.mkdir).toHaveBeenCalledWith("/workspace/deploy/run", {
      recursive: true,
    });
    // No artifact lands where wrangler runs and reads `.env` from.
    for (const { path } of writes) {
      expect(path.startsWith("/workspace/deploy/run/")).toBe(false);
    }
    expect(execCommand).toBe(
      "/opt/morph-platform/node_modules/.bin/wrangler deploy --config /workspace/deploy/server/wrangler.json --env-file /dev/null",
    );
    expect(execOptions.env).toMatchObject({
      CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
      WRANGLER_API_ENVIRONMENT: "production",
      CLOUDFLARE_COMPLIANCE_REGION: "public",
    });
  });

  it("scrubs credentials out of failure output", async () => {
    const exec = vi.fn(async () => ({
      exitCode: 1,
      success: false,
      stdout: "",
      stderr: `Authentication error using token ${TOKEN} for account ${ACCOUNT}`,
    }));
    const { session } = sandboxStub(exec);

    const result = await deployer(session).deploy(request);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).not.toContain(TOKEN);
    expect(result.message).not.toContain(ACCOUNT);
    expect(result.diagnostics?.join("")).not.toContain(TOKEN);
  });

  it("destroys the credential-bearing container even when deployment throws", async () => {
    const exec = vi.fn(async () => {
      throw new Error("container exploded");
    });
    const { session } = sandboxStub(exec);

    const result = await deployer(session).deploy(request);

    expect(result.success).toBe(false);
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it("refuses to deploy without credentials rather than partially proceeding", async () => {
    const { session } = sandboxStub(vi.fn());
    const result = await deployer(session, { credentials: {} }).deploy(request);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("CREDENTIALS_MISSING");
    expect(session.mkdir).not.toHaveBeenCalled();
  });

  it("fails closed when a planned artifact object is missing from R2", async () => {
    const exec = vi.fn();
    const { session } = sandboxStub(exec);
    const result = await deployer(session, {
      r2Bucket: { get: vi.fn(async () => null) } as any,
    }).deploy(request);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("ARTIFACT_UNREADABLE");
    expect(exec).not.toHaveBeenCalled();
  });

  it("writes the platform's _headers, isolating SVG, beside the client assets", async () => {
    const written = new Map<string, string>();
    const session = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, content: any) => {
        written.set(path, String(content));
      }),
      readFile: vi.fn(),
      exec: vi.fn(async () => ({
        exitCode: 0,
        success: true,
        stdout: "",
        stderr: "",
      })),
      destroy: vi.fn(async () => {}),
    };

    await deployer(session).deploy(request);

    const [path, content] =
      [...written].find(([key]) => key.endsWith("/client/_headers")) ?? [];
    expect(path).toBeDefined();
    expect(content).toContain("/*.svg");
    expect(content).toContain("sandbox");
    expect(content).toContain("X-Content-Type-Options: nosniff");
  });

  // An all-SSR Astro build plans no assets. The assets directory is still
  // configured: Astro's entry falls back to env.ASSETS for paths it does
  // not route, and the binding only exists with it. The directory then holds
  // only the platform `_headers`, which wrangler never uploads as an asset
  // (its default ignore list), so the manifest wrangler submits is `{}`.
  it("deploys a plan with no client assets: modules only, the assets binding kept", async () => {
    const written = new Map<string, string>();
    const session = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, content: any) => {
        written.set(path, String(content));
      }),
      readFile: vi.fn(),
      exec: vi.fn(async () => ({
        exitCode: 0,
        success: true,
        stdout: "",
        stderr: "",
      })),
      destroy: vi.fn(async () => {}),
    };
    const bucket = r2();

    const result = await deployer(session, { r2Bucket: bucket }).deploy({
      ...request,
      plan: { ...request.plan, assets: [], assetsBinding: "ASSETS" },
    });

    expect(result.success).toBe(true);
    // Only the two modules are read; nothing is asked of R2 for assets.
    expect(bucket.get.mock.calls.map(([key]: [string]) => key)).toEqual([
      "themes/th_1/builds/bld_1/runtime/server/index.js",
      "themes/th_1/builds/bld_1/runtime/server/assets/worker-entry.js",
    ]);
    expect(session.mkdir).toHaveBeenCalledWith("/workspace/deploy/client", {
      recursive: true,
    });
    const clientFiles = [...written.keys()].filter((path) =>
      path.startsWith("/workspace/deploy/client/"),
    );
    expect(clientFiles).toEqual(["/workspace/deploy/client/_headers"]);
    const config = JSON.parse(
      written.get("/workspace/deploy/server/wrangler.json") ?? "null",
    );
    expect(config.assets).toEqual({
      directory: "../client",
      binding: "ASSETS",
    });
    expect(config.main).toBe("index.js");
    expect(session.exec).toHaveBeenCalledOnce();
  });
});

/**
 * The release/Worker build match (theme-worker-build-match.ts). Off by
 * default: the deployment is what it was, byte for byte. On: Morph's module
 * becomes the Worker's main and the build id a var.
 */
describe("SandboxWranglerThemeWorkerDeployer with the release/Worker build match", () => {
  function recordingSession() {
    const written = new Map<string, string>();
    const session = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async (path: string, content: any) => {
        written.set(path, String(content));
      }),
      readFile: vi.fn(),
      exec: vi.fn(async () => ({
        exitCode: 0,
        success: true,
        stdout: "Current Version ID: 1a2b3c4d-5e6f",
        stderr: "",
      })),
      destroy: vi.fn(async () => {}),
    };
    return { session, written };
  }
  const configOf = (written: Map<string, string>) =>
    written.get("/workspace/deploy/server/wrangler.json");

  it("off (the default): writes no module and the same config as before", async () => {
    for (const overrides of [{}, { releaseWorkerMatch: false }]) {
      const { session, written } = recordingSession();
      const result = await deployer(session, overrides).deploy(request);
      expect(result).toEqual({
        success: true,
        scriptName: "morph-theme-sf-1",
        deploymentId: "1a2b3c4d-5e6f",
        durationMs: expect.any(Number),
      });
      expect(
        [...written.keys()].some((path) =>
          path.endsWith(THEME_BUILD_MATCH_MODULE),
        ),
      ).toBe(false);
      expect(configOf(written)).toBe(
        JSON.stringify(wranglerDeployConfig(request.plan), null, 2),
      );
    }
  });

  it("on: makes Morph's module the main over the build's entry, adds the build id var and routes requests through the Worker first", async () => {
    const { session, written } = recordingSession();
    const result = await deployer(session, { releaseWorkerMatch: true }).deploy(
      request,
    );
    expect(result).toEqual({
      success: true,
      scriptName: "morph-theme-sf-1",
      deploymentId: "1a2b3c4d-5e6f",
      durationMs: expect.any(Number),
    });
    expect(
      written.get(`/workspace/deploy/server/${THEME_BUILD_MATCH_MODULE}`),
    ).toBe(themeBuildMatchModuleSource("index.js"));
    // The build's own entry is still written, as before, for the module to import.
    expect(written.has("/workspace/deploy/server/index.js")).toBe(true);
    const config = JSON.parse(configOf(written) ?? "null");
    expect(config).toEqual({
      ...wranglerDeployConfig(request.plan),
      main: THEME_BUILD_MATCH_MODULE,
      assets: { directory: "../client", run_worker_first: true },
      vars: { [THEME_BUILD_ID_VAR]: "bld_1" },
      keep_vars: false,
    });
    // ESModule rules cover the module, so no_bundle can resolve it.
    expect(config.rules).toEqual([
      { type: "ESModule", globs: ["**/*.js", "**/*.mjs"] },
    ]);
  });

  it("on: refuses, before any container starts, a build that wrote the module's path", async () => {
    const { session } = recordingSession();
    const getSandbox = vi.fn(validatingGetSandbox(session));
    const result = await new SandboxWranglerThemeWorkerDeployer({
      sandboxProvider: { getSandbox },
      sandboxBinding: {},
      r2Bucket: r2(),
      credentials: { apiToken: TOKEN, accountId: ACCOUNT },
      releaseWorkerMatch: true,
    }).deploy({
      ...request,
      plan: {
        ...request.plan,
        modules: [
          ...request.plan.modules,
          {
            modulePath: THEME_BUILD_MATCH_MODULE,
            artifactPath: `runtime/server/${THEME_BUILD_MATCH_MODULE}`,
            contentType: "application/javascript",
          },
        ],
      },
    });
    expect(result).toMatchObject({ success: false, reason: "DEPLOY_ERROR" });
    expect(getSandbox).not.toHaveBeenCalled();
  });

  it("on: refuses a deployment that names no build id", async () => {
    const { session } = recordingSession();
    const result = await deployer(session, { releaseWorkerMatch: true }).deploy(
      {
        ...request,
        themeBuildId: " ",
      },
    );
    expect(result).toMatchObject({ success: false, reason: "DEPLOY_ERROR" });
    expect(session.exec).not.toHaveBeenCalled();
  });
});

describe("wranglerDeployConfig with the release/Worker build match", () => {
  it("is unchanged without it", () => {
    expect(wranglerDeployConfig(request.plan, undefined)).toEqual(
      wranglerDeployConfig(request.plan),
    );
  });

  it("adds the build id beside a native build's own vars and keeps its observability", () => {
    const plan = {
      ...request.plan,
      native: { vars: { STORE_LABEL: "probe" }, observabilityEnabled: true },
    };
    expect(
      wranglerDeployConfig(
        { ...plan, assetsBinding: "ASSETS" },
        { themeBuildId: "bld_9" },
      ),
    ).toEqual({
      ...wranglerDeployConfig({ ...plan, assetsBinding: "ASSETS" }),
      main: THEME_BUILD_MATCH_MODULE,
      assets: {
        directory: "../client",
        binding: "ASSETS",
        run_worker_first: true,
      },
      vars: { STORE_LABEL: "probe", [THEME_BUILD_ID_VAR]: "bld_9" },
    });
  });
});
