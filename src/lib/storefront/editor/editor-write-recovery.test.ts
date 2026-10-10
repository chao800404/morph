// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  accessDenied,
  accountChanged,
  authRequired,
} from "@/lib/auth/auth-failure";
import {
  confirmLostSave,
  earlierRefusalStillApplies,
  settleHeldFile,
  templateIdOfPendingContentKey,
  verifyEditorWriter,
} from "./editor-write-recovery";

const owner = "user-1";

function verify(overrides: {
  session?: () => Promise<{ user?: { id?: string } | null } | null>;
  theme?: () => Promise<{ success: boolean; error?: string }>;
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
      verify({
        theme: async () => ({ success: false, error: "NOT_FOUND" }),
      }).result,
    ).resolves.toBe("access-denied");
  });

  // This used to expect any `success: false` to read as access-denied. A
  // server error answers `success: false` too, and says nothing about access:
  // taken for a refusal, it closed the Theme to an author who may edit it.
  it("does not take a server error for a refusal", async () => {
    await expect(
      verify({
        theme: async () => ({ success: false, error: "GET_FAILED" }),
      }).result,
    ).resolves.toBe("unanswered");
    await expect(
      verify({ theme: async () => ({ success: false }) }).result,
    ).resolves.toBe("unanswered");
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

describe("verifyEditorWriter and another account", () => {
  it("reads a Theme refused as another account's as a different account", async () => {
    await expect(
      verify({
        theme: async () => {
          throw accountChanged();
        },
      }).result,
    ).resolves.toBe("different-account");
  });
});

describe("settleHeldFile", () => {
  function held(initial: string) {
    const draft = { localContent: initial } as {
      localContent: string;
      conflict?: unknown;
    };
    return draft;
  }

  it("records a lost answer that had landed, and sends nothing", async () => {
    const draft = held("mine");
    const save = vi.fn(async () => {});
    const markLanded = vi.fn();
    await expect(
      settleHeldFile({
        readDraft: () => draft,
        readLatest: async () => ({ content: "mine", version: 2 }),
        markLanded,
        save,
      }),
    ).resolves.toBe("landed");
    expect(markLanded).toHaveBeenCalledWith({ content: "mine", version: 2 });
    expect(save).not.toHaveBeenCalled();
  });

  it("sends the draft as it is when sending, not as it was when asked", async () => {
    const draft = held("first");
    const save = vi.fn(async () => {});
    await settleHeldFile({
      readDraft: () => draft,
      readLatest: async () => {
        // The author keeps typing while the server is asked.
        draft.localContent = "first and more";
        return { content: "theirs" };
      },
      markLanded: vi.fn(),
      save,
    });
    expect(save).toHaveBeenCalledWith("first and more");
  });

  it("records only the matching version when the draft moved on meanwhile", async () => {
    const draft = held("first");
    const save = vi.fn(async () => {});
    const markLanded = vi.fn();
    await expect(
      settleHeldFile({
        readDraft: () => draft,
        readLatest: async () => {
          draft.localContent = "first and more";
          return { content: "first" };
        },
        markLanded,
        save,
      }),
    ).resolves.toBe("landed");
    // The newer content is left to markLanded's own comparison (the
    // workspace keeps it unsaved) and to the editor's next save.
    expect(markLanded).toHaveBeenCalledWith({ content: "first" });
    expect(save).not.toHaveBeenCalled();
  });

  it("leaves a file in conflict to its own resolution, and sends nothing when the server cannot answer", async () => {
    const conflicted = { localContent: "mine", conflict: { kind: "modified" } };
    const save = vi.fn(async () => {});
    await expect(
      settleHeldFile({
        readDraft: () => conflicted,
        readLatest: async () => ({ content: "x" }),
        markLanded: vi.fn(),
        save,
      }),
    ).resolves.toBe("skipped");
    await expect(
      settleHeldFile({
        readDraft: () => held("mine"),
        readLatest: async () => {
          throw new Error("network");
        },
        markLanded: vi.fn(),
        save,
      }),
    ).resolves.toBe("unanswered");
    // No answer is not "it did not land": nothing is sent on a guess.
    expect(save).not.toHaveBeenCalled();
  });
});

describe("confirmLostSave", () => {
  it("records a save that landed, and only that version", async () => {
    const markLanded = vi.fn();
    await expect(
      confirmLostSave({
        unconfirmedContent: "sent",
        readLatest: async () => ({ content: "sent", version: 3 }),
        markLanded,
      }),
    ).resolves.toBe("landed");
    expect(markLanded).toHaveBeenCalledWith({ content: "sent", version: 3 });
  });

  it("leaves to the ordinary save a file that holds something else, or nothing", async () => {
    const markLanded = vi.fn();
    await expect(
      confirmLostSave({
        unconfirmedContent: "sent",
        readLatest: async () => ({ content: "before", version: 2 }),
        markLanded,
      }),
    ).resolves.toBe("not-landed");
    await expect(
      confirmLostSave({
        unconfirmedContent: "sent",
        readLatest: async () => null,
        markLanded,
      }),
    ).resolves.toBe("not-landed");
    expect(markLanded).not.toHaveBeenCalled();
  });

  it("decides nothing when the server cannot be asked", async () => {
    const markLanded = vi.fn();
    await expect(
      confirmLostSave({
        unconfirmedContent: "sent",
        readLatest: async () => {
          throw new Error("network");
        },
        markLanded,
      }),
    ).rejects.toThrow("network");
    expect(markLanded).not.toHaveBeenCalled();
  });
});

describe("earlierRefusalStillApplies", () => {
  const sentAgainst = { serverFileId: "file-1", serverVersion: 3 };

  it("applies while the edit it carried is unsaved and the file has not moved", () => {
    expect(
      earlierRefusalStillApplies(sentAgainst, {
        serverFileId: "file-1",
        serverVersion: 3,
        dirty: true,
      }),
    ).toBe(true);
  });

  it("does not undo a newer save of the file that landed since", () => {
    // Sent, verified, a newer save landed, and only then the old refusal.
    expect(
      earlierRefusalStillApplies(sentAgainst, {
        serverFileId: "file-1",
        serverVersion: 4,
        dirty: false,
      }),
    ).toBe(false);
    // The newer save landed, and the author kept typing after it.
    expect(
      earlierRefusalStillApplies(sentAgainst, {
        serverFileId: "file-1",
        serverVersion: 4,
        dirty: true,
      }),
    ).toBe(false);
  });

  it("does not apply once the edit is discarded or the file is gone", () => {
    expect(
      earlierRefusalStillApplies(sentAgainst, {
        serverFileId: "file-1",
        serverVersion: 3,
        dirty: false,
      }),
    ).toBe(false);
    expect(earlierRefusalStillApplies(sentAgainst, undefined)).toBe(false);
  });
});
