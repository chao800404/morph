// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { accessDenied, authRequired } from "@/lib/auth/auth-failure";
import {
  templateIdOfPendingContentKey,
  verifyEditorWriter,
} from "./editor-write-recovery";

const owner = "user-1";

function verify(overrides: {
  session?: () => Promise<{ user?: { id?: string } | null } | null>;
  theme?: () => Promise<{ success: boolean }>;
}) {
  const readTheme = vi.fn(overrides.theme ?? (async () => ({ success: true })));
  return {
    readTheme,
    result: verifyEditorWriter({
      ownerUserId: owner,
      readSession: overrides.session ?? (async () => ({ user: { id: owner } })),
      readTheme,
    }),
  };
}

describe("verifyEditorWriter", () => {
  it("verifies the same account that may still edit the Theme", async () => {
    await expect(verify({}).result).resolves.toBe("verified");
  });

  it("finds nobody signed in", async () => {
    const { result, readTheme } = verify({ session: async () => null });
    await expect(result).resolves.toBe("signed-out");
    expect(readTheme).not.toHaveBeenCalled();
  });

  it("refuses another account without asking about the Theme", async () => {
    const { result, readTheme } = verify({
      session: async () => ({ user: { id: "user-2" } }),
    });
    await expect(result).resolves.toBe("different-account");
    expect(readTheme).not.toHaveBeenCalled();
  });

  it("finds the account may no longer edit the Theme", async () => {
    await expect(
      verify({
        theme: async () => {
          throw accessDenied("Forbidden: Administrator access is required");
        },
      }).result,
    ).resolves.toBe("access-denied");
    await expect(
      verify({ theme: async () => ({ success: false }) }).result,
    ).resolves.toBe("access-denied");
  });

  it("reads a session that lapsed between the two questions as signed out", async () => {
    await expect(
      verify({
        theme: async () => {
          throw authRequired();
        },
      }).result,
    ).resolves.toBe("signed-out");
  });

  it("does not guess when a question fails", async () => {
    await expect(
      verify({
        session: async () => {
          throw new Error("network");
        },
      }).result,
    ).resolves.toBe("unanswered");
    await expect(
      verify({
        theme: async () => {
          throw new Error("network");
        },
      }).result,
    ).resolves.toBe("unanswered");
  });
});

describe("templateIdOfPendingContentKey", () => {
  it("keeps a template id that contains a colon", () => {
    expect(
      templateIdOfPendingContentKey("route-template:/about:hero-1", "hero-1"),
    ).toBe("route-template:/about");
    expect(templateIdOfPendingContentKey("tpl_1:hero-1", "hero-1")).toBe(
      "tpl_1",
    );
  });

  it("refuses a key that does not end in its section", () => {
    expect(templateIdOfPendingContentKey("tpl_1:hero-2", "hero-1")).toBeNull();
    expect(templateIdOfPendingContentKey(":hero-1", "hero-1")).toBeNull();
  });
});
