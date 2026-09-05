import { describe, expect, it, vi } from "vitest";
import {
  activateReleaseWithDeployment,
  deployReleaseArtifact,
} from "./storefront-release-reconciler";
import { UnavailableThemeWorkerDeployer } from "./theme-worker-deployer.types";
import type { ReleaseReconcilerPorts } from "./storefront-release-reconciler";

const WORKER_CONFIG = {
  name: "morph-theme-bld-1",
  main: "index.js",
  compatibility_date: "2025-09-02",
  compatibility_flags: ["nodejs_compat"],
  no_bundle: true,
};

const manifest = {
  artifactEntry: "preview/index.html",
  runtime: {
    kind: "cloudflare-worker",
    workerEntry: "runtime/server/index.js",
    clientAssetsDirectory: "runtime/client",
  },
  files: [
    { path: "runtime/server/index.js", contentType: "application/javascript", sizeBytes: 195, sha256: "0" },
    { path: "runtime/server/wrangler.json", contentType: "application/json", sizeBytes: 100, sha256: "0" },
    { path: "runtime/client/assets/app.js", contentType: "application/javascript", sizeBytes: 10, sha256: "0" },
  ],
};

function ports(overrides: Partial<ReleaseReconcilerPorts> = {}): ReleaseReconcilerPorts {
  return {
    getRelease: async () => ({
      id: "rel_1",
      storefrontId: "sf_1",
      themeId: "th_1",
      themeBuildId: "bld_1",
    }),
    getBuild: async () => ({
      id: "bld_1",
      storefrontId: "sf_1",
      status: "succeeded",
      artifactPrefix: "themes/th_1/builds/bld_1",
      manifestJson: manifest,
    }),
    activateRelease: async () => ({}),
    ...overrides,
  };
}

function r2(config: unknown = WORKER_CONFIG) {
  return {
    get: vi.fn(async () =>
      config === null
        ? null
        : { text: async () => JSON.stringify(config) },
    ),
  } as any;
}

function okDeployer() {
  return {
    kind: "sandbox-wrangler" as const,
    deploy: vi.fn(async () => ({
      success: true as const,
      scriptName: "morph-theme-sf-1",
      deploymentId: "dep_1",
      durationMs: 10,
    })),
  };
}

describe("activateReleaseWithDeployment", () => {
  it("claims the active release before deploying, so two activations cannot race", async () => {
    const order: string[] = [];
    const deployer = {
      kind: "sandbox-wrangler" as const,
      deploy: vi.fn(async () => {
        order.push("deploy");
        return {
          success: true as const,
          scriptName: "morph-theme-sf-1",
          deploymentId: "dep_1",
          durationMs: 10,
        };
      }),
    };

    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer,
      r2Bucket: r2(),
      ports: ports({
        activateRelease: async () => {
          order.push("claim");
          return {};
        },
      }),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.scriptName).toBe("morph-theme-sf-1");
    // The CAS is the lock: claiming must happen before the script is touched.
    expect(order).toEqual(["claim", "deploy"]);
  });

  it("never deploys when the claim is lost to a concurrent activation", async () => {
    const deployer = okDeployer();
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: "rel_OLD",
      deployer,
      r2Bucket: r2(),
      ports: ports({
        activateRelease: async () => {
          throw new Error("RELEASE_ACTIVATION_CONFLICT");
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("ACTIVATION_CONFLICT");
    // The loser must leave the deployed script completely untouched.
    expect(deployer.deploy).not.toHaveBeenCalled();
    expect(result.deploymentDrift).toBeUndefined();
  });

  it("releases the claim when deployment fails, so D1 stops naming an undeployed release", async () => {
    const calls: Array<{ releaseId: string; expected: string | null }> = [];
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: "rel_OLD",
      deployer: new UnavailableThemeWorkerDeployer(),
      r2Bucket: r2(),
      ports: ports({
        activateRelease: async (args: any) => {
          calls.push({
            releaseId: args.releaseId,
            expected: args.expectedActiveReleaseId,
          });
          return {};
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("DEPLOY_FAILED");
    expect(result.deploymentDrift).toBeUndefined();
    expect(calls).toEqual([
      { releaseId: "rel_1", expected: "rel_OLD" },
      { releaseId: "rel_OLD", expected: "rel_1" },
    ]);
  });

  it("reports drift when the claim cannot be released after a failed deployment", async () => {
    let call = 0;
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: "rel_OLD",
      deployer: new UnavailableThemeWorkerDeployer(),
      r2Bucket: r2(),
      ports: ports({
        activateRelease: async () => {
          call += 1;
          if (call === 2) throw new Error("RELEASE_ACTIVATION_CONFLICT");
          return {};
        },
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("DEPLOY_FAILED");
    expect(result.deploymentDrift).toBe(true);
  });

  it("reports drift when a first-ever activation fails to deploy", async () => {
    // Reverting to "no active release" is not expressible through the CAS, so
    // this case must be surfaced rather than silently left inconsistent.
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer: new UnavailableThemeWorkerDeployer(),
      r2Bucket: r2(),
      ports: ports(),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("DEPLOY_FAILED");
    expect(result.deploymentDrift).toBe(true);
  });

  it("refuses to deploy a release whose build did not succeed", async () => {
    const deployer = okDeployer();
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer,
      r2Bucket: r2(),
      ports: ports({
        getBuild: async () => ({
          id: "bld_1",
          storefrontId: "sf_1",
          status: "failed",
          artifactPrefix: null,
          manifestJson: null,
        }),
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("BUILD_NOT_DEPLOYABLE");
    expect(deployer.deploy).not.toHaveBeenCalled();
  });

  it("refuses a release whose build belongs to another storefront", async () => {
    const deployer = okDeployer();
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer,
      r2Bucket: r2(),
      ports: ports({
        getBuild: async () => ({
          id: "bld_1",
          storefrontId: "sf_OTHER",
          status: "succeeded",
          artifactPrefix: "themes/th_1/builds/bld_1",
          manifestJson: manifest,
        }),
      }),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("BUILD_NOT_DEPLOYABLE");
    expect(deployer.deploy).not.toHaveBeenCalled();
  });

  it("refuses when the artifact has no readable generated Worker config", async () => {
    const deployer = okDeployer();
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer,
      r2Bucket: r2(null),
      ports: ports(),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("WORKER_CONFIG_UNREADABLE");
    expect(deployer.deploy).not.toHaveBeenCalled();
  });

  it("refuses when the plan rejects the artifact", async () => {
    const deployer = okDeployer();
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer,
      r2Bucket: r2({ ...WORKER_CONFIG, d1_databases: [{ binding: "DB" }] }),
      ports: ports(),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("PLAN_REJECTED");
    expect(result.message).toContain("d1_databases");
    expect(deployer.deploy).not.toHaveBeenCalled();
  });

  it("reads the Worker config from the immutable artifact, not the workspace", async () => {
    const bucket = r2();
    await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer: okDeployer(),
      r2Bucket: bucket,
      ports: ports(),
    });

    expect(bucket.get).toHaveBeenCalledWith(
      "themes/th_1/builds/bld_1/runtime/server/wrangler.json",
    );
  });
});

describe("deployReleaseArtifact", () => {
  const basePorts = ports();

  it("deploys the release artifact without touching activation state", async () => {
    const activateRelease = vi.fn(async () => ({}));
    const deployer = okDeployer();

    const result = await deployReleaseArtifact({
      releaseId: "rel_1",
      deployer,
      r2Bucket: r2(),
      ports: { getRelease: basePorts.getRelease, getBuild: basePorts.getBuild },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.scriptName).toBe("morph-theme-sf-1");
    expect(deployer.deploy).toHaveBeenCalledOnce();
    // The publish path already wrote activation atomically; this must not
    // re-enter the CAS.
    expect(activateRelease).not.toHaveBeenCalled();
  });

  it("reports a failed deployment rather than reporting success", async () => {
    const result = await deployReleaseArtifact({
      releaseId: "rel_1",
      deployer: new UnavailableThemeWorkerDeployer(),
      r2Bucket: r2(),
      ports: { getRelease: basePorts.getRelease, getBuild: basePorts.getBuild },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("DEPLOY_FAILED");
  });

  it("refuses a build outside the release's storefront", async () => {
    const deployer = okDeployer();
    const result = await deployReleaseArtifact({
      releaseId: "rel_1",
      deployer,
      r2Bucket: r2(),
      ports: {
        getRelease: basePorts.getRelease,
        getBuild: async () => ({
          id: "bld_1",
          storefrontId: "sf_OTHER",
          status: "succeeded",
          artifactPrefix: "themes/th_1/builds/bld_1",
          manifestJson: manifest,
        }),
      },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("BUILD_NOT_DEPLOYABLE");
    expect(deployer.deploy).not.toHaveBeenCalled();
  });
});

describe("recording what the Theme Worker runs", () => {
  it("records the deployed build only after the deployment succeeded", async () => {
    const recordDeployedThemeBuild = vi.fn(async () => ({}));

    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer: okDeployer(),
      r2Bucket: r2(),
      ports: ports({ recordDeployedThemeBuild }),
    });

    expect(result.success).toBe(true);
    expect(recordDeployedThemeBuild).toHaveBeenCalledWith({
      storefrontId: "sf_1",
      releaseId: "rel_1",
      themeBuildId: "bld_1",
    });
  });

  it("records nothing when the deployment failed", async () => {
    // A recorded build that never reached the Worker is worse than no record:
    // the next content-only publish would skip a deployment that is still
    // needed, and the storefront would keep serving the previous build with no
    // error anywhere.
    const recordDeployedThemeBuild = vi.fn(async () => ({}));

    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer: {
        kind: "sandbox-wrangler" as const,
        deploy: vi.fn(async () => ({
          success: false as const,
          reason: "DEPLOY_ERROR" as const,
          message: "wrangler exited 1",
        })),
      },
      r2Bucket: r2(),
      ports: ports({ recordDeployedThemeBuild }),
    });

    expect(result.success).toBe(false);
    expect(recordDeployedThemeBuild).not.toHaveBeenCalled();
  });

  it("records nothing when another activation claimed the slot first", async () => {
    const recordDeployedThemeBuild = vi.fn(async () => ({}));

    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: "rel_0",
      deployer: okDeployer(),
      r2Bucket: r2(),
      ports: ports({
        activateRelease: async () => {
          throw new Error("Another release was activated first.");
        },
        recordDeployedThemeBuild,
      }),
    });

    expect(result.success).toBe(false);
    expect(recordDeployedThemeBuild).not.toHaveBeenCalled();
  });

  it("still succeeds when the caller does not implement the port", async () => {
    // A smoke harness or a test that never skips deployments should not be
    // forced to implement it.
    const result = await activateReleaseWithDeployment({
      releaseId: "rel_1",
      expectedActiveReleaseId: null,
      deployer: okDeployer(),
      r2Bucket: r2(),
      ports: ports(),
    });

    expect(result.success).toBe(true);
  });
});

describe("concurrent activation (REL-01)", () => {
  /** Shared active pointer plus the lease, as one storefront's D1 row. */
  function storefront() {
    let active: string | null = "rel_old";
    let leaseOwner: string | null = null;
    let leaseExpires = 0;
    const deployed: string[] = [];

    return {
      deployed,
      activeReleaseId: () => active,
      portsFor(releaseId: string) {
        return ports({
          getRelease: async () => ({
            id: releaseId,
            storefrontId: "sf_1",
            themeId: "th_1",
            themeBuildId: "bld_1",
          }),
          // The CAS the reconciler already had: it only guards this write.
          activateRelease: async (args) => {
            if (active !== args.expectedActiveReleaseId) {
              throw new Error("Another release was activated first.");
            }
            active = args.releaseId;
            return {};
          },
          deploymentLease: {
            acquire: async ({ owner, expiresAt, now }) => {
              if (leaseOwner !== null && leaseExpires > now) return false;
              leaseOwner = owner;
              leaseExpires = expiresAt;
              return true;
            },
            release: async ({ owner }) => {
              if (leaseOwner === owner) {
                leaseOwner = null;
                leaseExpires = 0;
              }
            },
          },
        });
      },
      expected: () => active,
    };
  }

  const slowDeployer = (deployed: string[], gate: Promise<void>) => ({
    kind: "sandbox-wrangler" as const,
    deploy: vi.fn(async (input: { releaseId: string }) => {
      await gate;
      deployed.push(input.releaseId);
      return {
        success: true as const,
        scriptName: "morph-theme-sf-1",
        deploymentId: "dep",
        durationMs: 1,
      };
    }),
  });

  // Reproduces the reported drift: A claims the pointer and stalls uploading,
  // B reads the value A just wrote, passes its own CAS and deploys. Without
  // the lease both succeed and the pointer ends up naming a release the Worker
  // is not running.
  it("refuses a second activation while the first is still deploying", async () => {
    const store = storefront();
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const first = activateReleaseWithDeployment({
      releaseId: "rel_first",
      expectedActiveReleaseId: "rel_old",
      deployer: slowDeployer(store.deployed, gate),
      ports: store.portsFor("rel_first"),
      r2Bucket: r2(),
    });

    // Give the first activation time to claim the lease and the pointer.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await activateReleaseWithDeployment({
      releaseId: "rel_second",
      expectedActiveReleaseId: store.expected(),
      deployer: slowDeployer(store.deployed, Promise.resolve()),
      ports: store.portsFor("rel_second"),
      r2Bucket: r2(),
    });

    expect(second.success).toBe(false);
    expect(second).toMatchObject({ reason: "ACTIVATION_CONFLICT" });

    openGate();
    const firstResult = await first;

    expect(firstResult.success).toBe(true);
    // The one that deployed is the one the pointer names — no drift.
    expect(store.deployed).toEqual(["rel_first"]);
    expect(store.activeReleaseId()).toBe("rel_first");
  });

  it("lets the next activation proceed once the first has finished", async () => {
    const store = storefront();

    const first = await activateReleaseWithDeployment({
      releaseId: "rel_first",
      expectedActiveReleaseId: "rel_old",
      deployer: slowDeployer(store.deployed, Promise.resolve()),
      ports: store.portsFor("rel_first"),
      r2Bucket: r2(),
    });
    expect(first.success).toBe(true);

    const second = await activateReleaseWithDeployment({
      releaseId: "rel_second",
      expectedActiveReleaseId: store.expected(),
      deployer: slowDeployer(store.deployed, Promise.resolve()),
      ports: store.portsFor("rel_second"),
      r2Bucket: r2(),
    });

    expect(second.success).toBe(true);
    expect(store.deployed).toEqual(["rel_first", "rel_second"]);
    expect(store.activeReleaseId()).toBe("rel_second");
  });
});
