// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  revokeGrants: vi.fn(),
  closePreviewGrants: vi.fn(),
  getSandbox: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { PreviewSandbox: {} } }));
vi.mock("@cloudflare/sandbox", () => ({ getSandbox: calls.getSandbox }));
vi.mock("@/lib/storefront/dal/storefront-preview-access.dal", () => ({
  storefrontPreviewAccessDal: { revokeGrants: calls.revokeGrants },
}));

const hooks = await import("./preview-access-revocation-hooks");

describe("the auth hooks that end Live Preview access (#214 P2d)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.getSandbox.mockImplementation(() => ({
      closePreviewGrants: calls.closePreviewGrants,
    }));
    calls.closePreviewGrants.mockResolvedValue(1);
    calls.revokeGrants.mockResolvedValue([
      { id: "g1", previewId: "p1", sessionId: "s1" },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("a deleted session revokes its grants, then closes their sockets on that preview", async () => {
    await hooks.previewAccessAfterSessionDeleted({ id: "s1" });
    expect(calls.revokeGrants).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1" }),
    );
    expect(calls.getSandbox).toHaveBeenCalledWith(expect.anything(), "p1", {
      normalizeId: true,
    });
    expect(calls.closePreviewGrants).toHaveBeenCalledWith(["g1"]);
  });

  it("a ban or demotion revokes the user's grants; an update that keeps access does nothing", async () => {
    await hooks.previewAccessAfterUserUpdated({
      id: "u1",
      role: "admin",
      banned: false,
    });
    expect(calls.revokeGrants).not.toHaveBeenCalled();
    await hooks.previewAccessAfterUserUpdated({
      id: "u1",
      role: "admin",
      banned: true,
    });
    expect(calls.revokeGrants).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
    );
    calls.revokeGrants.mockClear();
    await hooks.previewAccessAfterUserUpdated({
      id: "u2",
      role: "user",
      banned: false,
    });
    expect(calls.revokeGrants).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u2" }),
    );
  });

  it("a deleted user revokes the user's grants", async () => {
    await hooks.previewAccessAfterUserDeleted({ id: "u1" });
    expect(calls.revokeGrants).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
    );
  });

  it("never throws: not on a D1 error, a failed push, or a push that never answers", async () => {
    vi.useFakeTimers();
    try {
      calls.revokeGrants.mockRejectedValueOnce(new Error("D1"));
      await expect(
        hooks.previewAccessAfterSessionDeleted({ id: "s1" }),
      ).resolves.toBeUndefined();

      calls.closePreviewGrants.mockRejectedValueOnce(new Error("RPC"));
      await expect(
        hooks.previewAccessAfterSessionDeleted({ id: "s1" }),
      ).resolves.toBeUndefined();

      calls.getSandbox.mockImplementationOnce(() => {
        throw new Error("no binding");
      });
      await expect(
        hooks.previewAccessAfterSessionDeleted({ id: "s1" }),
      ).resolves.toBeUndefined();

      calls.closePreviewGrants.mockReturnValueOnce(new Promise(() => {}));
      const hung = hooks.previewAccessAfterSessionDeleted({ id: "s1" });
      await vi.advanceTimersByTimeAsync(hooks.PREVIEW_CLOSE_PUSH_TIMEOUT_MS);
      await expect(hung).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Better Auth configuration", () => {
  it("registers the three after-hooks, and they swallow failures", async () => {
    const { createAuth } = await import("@/auth");
    const options = createAuth().options as {
      databaseHooks?: {
        session?: { delete?: { after?: (s: unknown) => Promise<void> } };
        user?: {
          update?: { after?: (u: unknown) => Promise<void> };
          delete?: { after?: (u: unknown) => Promise<void> };
        };
      };
    };
    const after = {
      sessionDelete: options.databaseHooks?.session?.delete?.after,
      userUpdate: options.databaseHooks?.user?.update?.after,
      userDelete: options.databaseHooks?.user?.delete?.after,
    };
    for (const hook of Object.values(after))
      expect(hook).toBeTypeOf("function");

    calls.revokeGrants.mockRejectedValue(new Error("D1"));
    await expect(after.sessionDelete!({ id: "s1" })).resolves.toBeUndefined();
    await expect(
      after.userUpdate!({ id: "u1", role: "guest" }),
    ).resolves.toBeUndefined();
    await expect(after.userDelete!({ id: "u1" })).resolves.toBeUndefined();
    expect(calls.revokeGrants).toHaveBeenCalledTimes(3);
  });
});
