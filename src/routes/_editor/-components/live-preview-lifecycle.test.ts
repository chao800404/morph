import { describe, expect, it } from "vitest";
import {
  initialLivePreviewLifecycleState,
  livePreviewLifecycleLabel,
  reduceLivePreviewLifecycle,
  type LivePreviewLifecycleEvent,
} from "./live-preview-lifecycle";

/** A preview that has spent its one automatic recovery and given up. */
function failedAfterOneRecovery() {
  const events: LivePreviewLifecycleEvent[] = [
    { type: "server-ready", key: "preview-1" },
    { type: "automatic-recovery", key: "preview-1", message: "Port expired" },
    { type: "recovery-request-finished", recoveryId: 1 },
    { type: "server-ready", key: "preview-2" },
    { type: "automatic-recovery", key: "preview-2", message: "Gone again" },
  ];
  return events.reduce(
    reduceLivePreviewLifecycle,
    initialLivePreviewLifecycleState,
  );
}

describe("Live Preview lifecycle", () => {
  it("moves through server, frame, source and ready in one state machine", () => {
    const frame = reduceLivePreviewLifecycle(initialLivePreviewLifecycleState, {
      type: "server-ready",
      key: "preview-1",
    });
    const source = reduceLivePreviewLifecycle(frame, {
      type: "frame-ready",
      key: "preview-1",
    });
    const ready = reduceLivePreviewLifecycle(source, {
      type: "source-confirmed",
      key: "preview-1",
    });

    expect(frame.phase).toBe("loading-frame");
    expect(source).toMatchObject({
      phase: "syncing-source",
      readySequence: 1,
    });
    expect(ready.phase).toBe("ready");
  });

  it("ignores a late answer from a replaced frame", () => {
    const current = reduceLivePreviewLifecycle(
      initialLivePreviewLifecycleState,
      { type: "server-ready", key: "preview-2" },
    );

    expect(
      reduceLivePreviewLifecycle(current, {
        type: "source-confirmed",
        key: "preview-1",
      }),
    ).toBe(current);
  });

  it("automatically reconnects once and then reports an honest failure", () => {
    const frame = reduceLivePreviewLifecycle(initialLivePreviewLifecycleState, {
      type: "server-ready",
      key: "preview-1",
    });
    const reconnecting = reduceLivePreviewLifecycle(frame, {
      type: "automatic-recovery",
      key: "preview-1",
      message: "Port expired",
    });
    const restarted = reduceLivePreviewLifecycle(reconnecting, {
      type: "recovery-request-finished",
      recoveryId: reconnecting.recoveryId,
    });
    const secondFrame = reduceLivePreviewLifecycle(restarted, {
      type: "server-ready",
      key: "preview-2",
    });
    const failed = reduceLivePreviewLifecycle(secondFrame, {
      type: "automatic-recovery",
      key: "preview-2",
      message: "Port expired again",
    });

    expect(reconnecting).toMatchObject({
      phase: "reconnecting",
      automaticRecoveryAttempts: 1,
      recoveryId: 1,
    });
    expect(restarted.phase).toBe("starting-server");
    expect(failed).toMatchObject({
      phase: "failed",
      message: "Port expired again",
    });
  });

  it("keeps a spent preview failed when the server repeats its last answer", () => {
    // The preview server query holds its successful result for as long as the
    // editor is open, so "the server is ready" arrives again on every render
    // after a frame has given up. Acting on it would loop the author between
    // loading and failing, and the retry would never stay on screen.
    const failed = failedAfterOneRecovery();
    expect(failed).toMatchObject({ phase: "failed", message: "Gone again" });

    const repeated = reduceLivePreviewLifecycle(failed, {
      type: "server-ready",
      key: "preview-2",
    });

    expect(repeated).toBe(failed);
  });

  it("still starts a frame the server reports under a new address", () => {
    // Only the answer that has not changed is ignored. A genuinely new
    // preview must still take over, or a retry could never recover.
    const failed = failedAfterOneRecovery();

    expect(
      reduceLivePreviewLifecycle(failed, {
        type: "server-ready",
        key: "preview-3",
      }),
    ).toMatchObject({ phase: "loading-frame", key: "preview-3", message: null });
  });

  it("ignores completion from an older recovery request", () => {
    const frame = reduceLivePreviewLifecycle(initialLivePreviewLifecycleState, {
      type: "server-ready",
      key: "preview-1",
    });
    const reconnecting = reduceLivePreviewLifecycle(frame, {
      type: "automatic-recovery",
      key: "preview-1",
      message: "Port expired",
    });

    expect(
      reduceLivePreviewLifecycle(reconnecting, {
        type: "recovery-request-finished",
        recoveryId: reconnecting.recoveryId - 1,
      }),
    ).toBe(reconnecting);
  });

  it("lets a manual retry start a fresh automatic recovery budget", () => {
    const failed = {
      ...initialLivePreviewLifecycleState,
      phase: "failed" as const,
      automaticRecoveryAttempts: 1,
      message: "Failed",
    };

    expect(
      reduceLivePreviewLifecycle(failed, { type: "manual-recovery" }),
    ).toMatchObject({
      phase: "reconnecting",
      automaticRecoveryAttempts: 0,
      recoveryId: 1,
      message: null,
    });
  });

  it("gives each waiting phase a user-facing label", () => {
    expect(livePreviewLifecycleLabel("starting-server")).toMatch(/Starting/);
    expect(livePreviewLifecycleLabel("loading-frame")).toMatch(/React/);
    expect(livePreviewLifecycleLabel("syncing-source")).toMatch(/Syncing/);
    expect(livePreviewLifecycleLabel("reconnecting")).toMatch(/Reconnecting/);
    expect(livePreviewLifecycleLabel("ready")).toBeNull();
  });
});
