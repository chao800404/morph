import { describe, expect, it, vi } from "vitest";
import { deployWithRecovery } from "./storefront-release-reconciler";
describe("deployment compensation shared by publish and activation", () => {
  it.each([false, true])(
    "restores the previous activation after failure (throws=%s)",
    async (throws) => {
      let active: string | null = "new";
      const result = await deployWithRecovery({
        deploy: async () => {
          if (throws) throw new Error("network");
          return { success: false, message: "rejected" };
        },
        restore: async () => {
          active = null;
        },
      });
      expect(result).toMatchObject({ success: false, deploymentDrift: false });
      expect(active).toBeNull();
    },
  );
  it("reports drift when the CAS restoration fails", async () => {
    expect(
      await deployWithRecovery({
        deploy: async () => ({ success: false }),
        restore: async () => {
          throw new Error("CAS");
        },
      }),
    ).toMatchObject({ success: false, deploymentDrift: true });
  });
  it("never restores a successful deployment", async () => {
    const restore = vi.fn();
    expect(
      await deployWithRecovery({
        deploy: async () => ({ success: true }),
        restore,
      }),
    ).toEqual({ success: true });
    expect(restore).not.toHaveBeenCalled();
  });
});
