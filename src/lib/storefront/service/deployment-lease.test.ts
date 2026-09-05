import { describe, expect, it } from "vitest";
import {
  withDeploymentLease,
  type DeploymentLeasePorts,
} from "./deployment-lease";

/** In-memory stand-in for the single conditional UPDATE the DAL runs. */
function createLease(): DeploymentLeasePorts & { held: () => string | null } {
  let owner: string | null = null;
  let expiresAt = 0;

  return {
    async acquire({ owner: next, expiresAt: until, now }) {
      if (owner !== null && expiresAt > now) return false;
      owner = next;
      expiresAt = until;
      return true;
    },
    async release({ owner: candidate }) {
      if (owner === candidate) {
        owner = null;
        expiresAt = 0;
      }
    },
    held: () => owner,
  };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("withDeploymentLease", () => {
  it("runs the operation and hands the lease back", async () => {
    const lease = createLease();

    const result = await withDeploymentLease({
      storefrontId: "s1",
      owner: "a",
      ports: lease,
      operation: async () => "deployed",
    });

    expect(result).toEqual({ acquired: true, value: "deployed" });
    expect(lease.held()).toBeNull();
  });

  // The drift this exists to prevent: A claims the pointer and stalls
  // uploading, B passes its own CAS on the value A just wrote and deploys, then
  // A's upload lands. The pointer names B's release, the Worker runs A's.
  it("keeps a second deployment out while the first is still uploading", async () => {
    const lease = createLease();
    const uploading = deferred();
    const deployed: string[] = [];

    const first = withDeploymentLease({
      storefrontId: "s1",
      owner: "a",
      ports: lease,
      operation: async () => {
        await uploading.promise;
        deployed.push("first");
        return "first";
      },
    });

    // B arrives while A is mid-deploy.
    const second = await withDeploymentLease({
      storefrontId: "s1",
      owner: "b",
      ports: lease,
      operation: async () => {
        deployed.push("second");
        return "second";
      },
    });

    expect(second).toEqual({ acquired: false });

    uploading.resolve();
    await first;
    expect(deployed).toEqual(["first"]);
  });

  it("lets the next deployment through once the first finishes", async () => {
    const lease = createLease();

    await withDeploymentLease({
      storefrontId: "s1",
      owner: "a",
      ports: lease,
      operation: async () => "first",
    });
    const second = await withDeploymentLease({
      storefrontId: "s1",
      owner: "b",
      ports: lease,
      operation: async () => "second",
    });

    expect(second).toEqual({ acquired: true, value: "second" });
  });

  // A crashed holder must not wedge the storefront until someone intervenes.
  it("lets an expired lease be taken over", async () => {
    const lease = createLease();
    await lease.acquire({
      storefrontId: "s1",
      owner: "crashed",
      expiresAt: 1_000,
      now: 0,
    });

    const result = await withDeploymentLease({
      storefrontId: "s1",
      owner: "b",
      ports: lease,
      now: 2_000,
      operation: async () => "second",
    });

    expect(result).toEqual({ acquired: true, value: "second" });
  });

  it("releases the lease when the deployment throws", async () => {
    const lease = createLease();

    await expect(
      withDeploymentLease({
        storefrontId: "s1",
        owner: "a",
        ports: lease,
        operation: async () => {
          throw new Error("upload failed");
        },
      }),
    ).rejects.toThrow("upload failed");

    // A failed deployment still has to hand the storefront back, or one crash
    // would block publishing for the whole TTL.
    expect(lease.held()).toBeNull();
  });

  it("does not release a lease it no longer holds", async () => {
    const lease = createLease();
    await lease.acquire({
      storefrontId: "s1",
      owner: "other",
      expiresAt: 10_000,
      now: 0,
    });

    await lease.release({ storefrontId: "s1", owner: "a" });
    expect(lease.held()).toBe("other");
  });
});
