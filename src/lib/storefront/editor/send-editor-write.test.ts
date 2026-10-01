// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accessDenied,
  accountChanged,
  authRequired,
} from "@/lib/auth/auth-failure";
import {
  editorWriteGateFor,
  useEditorWriteGateStore,
} from "../store/editor-write-gate-store";
import {
  isEditorWritePaused,
  isEditorWriteRefusedEarlier,
} from "./editor-write-gate";
import { stampRequestError } from "./editor-request-sequence";
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

/**
 * A request sent while signed out, whose refusal arrives only after the
 * author signed in again and that was verified. Each step is released by
 * hand, so the order is fixed rather than left to timing.
 */
describe("a refusal that arrives after a later verification", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /** Paused by another refusal while `held` is still in flight. */
  async function sendThenPause() {
    const held = deferred<{ success: boolean }>();
    const write = sendEditorWrite(themeA, "theme", () => held.promise).catch(
      (error: unknown) => error,
    );
    await Promise.resolve();
    useEditorWriteGateStore.getState().pause(themeA, "AUTH_REQUIRED", "theme");
    return { held, write };
  }

  function verify() {
    const store = useEditorWriteGateStore.getState();
    const epoch = store.beginVerification(themeA)!;
    store.finishVerification(themeA, epoch, "verified");
    return gateOf(themeA);
  }

  it("leaves the verification standing, and the write held for the author to confirm", async () => {
    const { held, write } = await sendThenPause();
    const verified = verify();
    expect(verified.recovery).toBe("verified");

    held.reject(authRequired());
    const error = await write;

    expect(gateOf(themeA)).toBe(verified);
    // Not saved, and not sent again: held like any other paused write.
    expect(isEditorWritePaused(error)).toBe(true);
    expect((error as { reason?: string }).reason).toBe("AWAITING_CONFIRMATION");
  });

  it("reports the write as failed once writes are open again, and keeps them open", async () => {
    const { held, write } = await sendThenPause();
    const verified = verify();
    useEditorWriteGateStore.getState().confirmResume(themeA, verified.epoch);
    const open = gateOf(themeA);

    held.reject(authRequired());
    const error = await write;

    expect(gateOf(themeA)).toBe(open);
    expect(isEditorWriteRefusedEarlier(error)).toBe(true);
    expect((error as Error).message).toContain("Your changes are kept");
  });

  it("still undoes the verification when the refused request was sent after it began", async () => {
    await sendThenPause();
    const store = useEditorWriteGateStore.getState();
    const epoch = store.beginVerification(themeA)!;
    const error = await sendEditorWrite(themeA, "theme", async () => {
      throw authRequired();
    }).catch((caught: unknown) => caught);
    // Paused writes are not sent at all; the refusal here is the read the
    // verification itself might make, stamped after it began.
    expect(isEditorWritePaused(error)).toBe(true);
    const late = authRequired();
    stampRequestError(late, gateOf(themeA).verificationStamp);
    reportEditorReadFailure(themeA, late);
    expect(gateOf(themeA).recovery).toBe("still-signed-out");
    expect(store.finishVerification(themeA, epoch, "verified").recovery).toBe(
      "still-signed-out",
    );
  });

  it("ignores a read refused for an earlier sign-in, but not one sent after", async () => {
    await sendThenPause();
    const before = authRequired();
    stampRequestError(before, gateOf(themeA).verificationStamp);
    const verified = verify();

    reportEditorReadFailure(themeA, before);
    expect(gateOf(themeA)).toBe(verified);

    const after = authRequired();
    stampRequestError(after, gateOf(themeA).verificationStamp);
    reportEditorReadFailure(themeA, after);
    expect(gateOf(themeA).recovery).toBe("still-signed-out");
  });

  it("keeps another account's refusal however old the request", async () => {
    const { held, write } = await sendThenPause();
    verify();
    held.reject(accountChanged());
    await write;
    expect(gateOf(themeA).recovery).toBe("different-account");
  });
});
