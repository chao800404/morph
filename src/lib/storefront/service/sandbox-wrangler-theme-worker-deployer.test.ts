import { describe, expect, it, vi } from "vitest";
import {
  SandboxWranglerThemeWorkerDeployer,
  deploymentSandboxSessionId,
  scrubDeploymentSecrets,
} from "./sandbox-wrangler-theme-worker-deployer";
import type { ThemeWorkerDeploymentRequest } from "./theme-worker-deployer.types";

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
    sandboxProvider: { getSandbox: async () => session },
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
  it("never collides with a build session id", () => {
    const id = deploymentSandboxSessionId("sf_1", "rel_1");
    expect(id).toBe("deploy-sf_1-rel_1");
    expect(id).not.toBe("bld_1");
    expect(id.startsWith("deploy-")).toBe(true);
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
      "/opt/morph-toolchain/node_modules/.bin/wrangler deploy",
    );
  });

  it("writes module rules so no_bundle chunks resolve at runtime", async () => {
    let config: any = null;
    const exec = vi.fn(async () => ({ exitCode: 0, success: true, stdout: "", stderr: "" }));
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
});
