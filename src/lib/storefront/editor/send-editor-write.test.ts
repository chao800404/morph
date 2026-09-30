// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessDenied, authRequired } from "@/lib/auth/auth-failure";
import {
  editorWriteGateFor,
  useEditorWriteGateStore,
} from "../store/editor-write-gate-store";
import { isEditorWritePaused } from "./editor-write-gate";
import { reportEditorReadFailure, sendEditorWrite } from "./send-editor-write";

const themeA = { storefrontId: "store-1", themeId: "theme-a" };
const themeB = { storefrontId: "store-1", themeId: "theme-b" };
const gateOf = (scope: typeof themeA) =>
  editorWriteGateFor(useEditorWriteGateStore.getState().gates, scope);

beforeEach(() => useEditorWriteGateStore.setState({ gates: {} }));

describe("sendEditorWrite", () => {
  it("sends and returns the result while writes are open", async () => {
    await expect(
      sendEditorWrite(themeA, "theme", async () => ({ success: true })),
    ).resolves.toEqual({ success: true });
  });

  it("turns a server refusal into a pause, and sends nothing after it", async () => {
    await expect(
      sendEditorWrite(themeA, "theme", async () => {
        throw authRequired();
      }),
    ).rejects.toSatisfy(isEditorWritePaused);
    expect(gateOf(themeA).signedOut).toBe(true);

    const send = vi.fn(async () => ({ success: true }));
    await expect(sendEditorWrite(themeA, "theme", send)).rejects.toSatisfy(
      isEditorWritePaused,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("pauses once when many writes are refused together", async () => {
    const epochs = new Set<number>();
    const unsubscribe = useEditorWriteGateStore.subscribe((state) =>
      epochs.add(editorWriteGateFor(state.gates, themeA).epoch),
    );
    const refused = Array.from({ length: 5 }, () =>
      sendEditorWrite(themeA, "theme", async () => {
        await Promise.resolve();
        throw authRequired();
      }).catch((error) => error),
    );
    const errors = await Promise.all(refused);
    unsubscribe();
    expect(errors.every(isEditorWritePaused)).toBe(true);
    // One change of state, however many requests were refused.
    expect(epochs.size).toBe(1);
  });

  it("leaves ordinary failures to the caller", async () => {
    const failure = new Error("Unauthorized: looks like one, is not");
    await expect(
      sendEditorWrite(themeA, "theme", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(gateOf(themeA).signedOut).toBe(false);
  });

  it("pauses only the Theme that was refused", async () => {
    await sendEditorWrite(themeA, "theme", async () => {
      throw accessDenied("Forbidden: nope");
    }).catch(() => {});
    await expect(
      sendEditorWrite(themeB, "theme", async () => "sent"),
    ).resolves.toBe("sent");
  });

  it("reads a refusal from a result when the endpoint answers that way", async () => {
    await expect(
      sendEditorWrite(
        themeA,
        "theme",
        async () => ({ ok: false, status: 401, error: "UNAUTHORIZED" }),
        {
          refusalOfResult: (result) =>
            result.status === 401 ? "AUTH_REQUIRED" : null,
        },
      ),
    ).rejects.toSatisfy(isEditorWritePaused);
    expect(gateOf(themeA).signedOut).toBe(true);
  });
});

describe("reportEditorReadFailure", () => {
  it("pauses for a signed-out read but not for a refused one", () => {
    reportEditorReadFailure(themeA, accessDenied("Forbidden: media"));
    expect(gateOf(themeA).denied).toEqual([]);
    reportEditorReadFailure(themeA, authRequired());
    expect(gateOf(themeA).signedOut).toBe(true);
  });
});
