import { describe, expect, it } from "vitest";
import {
  initialLivePreviewLifecycleState,
  LIVE_PREVIEW_HEALTHY_EPISODE_MS,
  livePreviewLifecycleLabel,
  reduceLivePreviewLifecycle,
  type LivePreviewLifecycleEvent,
  type LivePreviewLifecycleState,
} from "./live-preview-lifecycle";

/** A preview that has spent its one automatic recovery and given up. */
function failedAfterOneRecovery() {
  const events: LivePreviewLifecycleEvent[] = [
    { type: "server-ready", key: "preview-1" },
    { type: "automatic-recovery", key: "preview-1", message: "Port expired", at: 0 },
    { type: "recovery-request-finished", recoveryId: 1 },
    { type: "server-ready", key: "preview-2" },
    { type: "automatic-recovery", key: "preview-2", message: "Gone again", at: 0 },
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
      at: 0,
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
        at: 0,
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
      at: 0,
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
      at: 0,
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

  it("reconnects an interrupted frame at once, and only once", () => {
    const frame = reduceLivePreviewLifecycle(initialLivePreviewLifecycleState, {
      type: "server-ready",
      key: "preview-1",
    });
    const reconnecting = reduceLivePreviewLifecycle(frame, {
      type: "frame-interrupted",
      key: "preview-1",
      message: "Interrupted",
      at: 0,
    });
    expect(reconnecting).toMatchObject({
      phase: "reconnecting",
      key: null,
      automaticRecoveryAttempts: 1,
      recoveryId: 1,
    });
    expect(livePreviewLifecycleLabel(reconnecting.phase)).toBe(
      "Reconnecting Live Preview…",
    );

    // The frame it replaced keeps reporting the same failure; that frame is
    // gone, and so is anything it says.
    expect(
      reduceLivePreviewLifecycle(reconnecting, {
        type: "frame-interrupted",
        key: "preview-1",
        message: "Interrupted",
        at: 0,
      }),
    ).toBe(reconnecting);

    const secondFrame = [
      { type: "recovery-request-finished", recoveryId: 1 },
      { type: "server-ready", key: "preview-2" },
    ].reduce(
      (state, event) =>
        reduceLivePreviewLifecycle(state, event as LivePreviewLifecycleEvent),
      reconnecting,
    );
    const failed = reduceLivePreviewLifecycle(secondFrame, {
      type: "frame-interrupted",
      key: "preview-2",
      message: "Interrupted again",
      at: 0,
    });
    expect(failed).toMatchObject({
      phase: "failed",
      message: "Interrupted again",
    });
  });

  it("does not let an interruption report revive a preview that gave up", () => {
    const failed = failedAfterOneRecovery();
    expect(
      reduceLivePreviewLifecycle(failed, {
        type: "frame-interrupted",
        key: "preview-2",
        message: "Interrupted",
        at: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(failed);
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
      at: 0,
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

  /** A preview that recovered once and has been healthy since `readyAt`. */
  function recoveredAndHealthySince(readyAt: number) {
    const events: LivePreviewLifecycleEvent[] = [
      { type: "server-ready", key: "preview-1" },
      { type: "automatic-recovery", key: "preview-1", message: "Slept", at: 0 },
      { type: "recovery-request-finished", recoveryId: 1 },
      { type: "server-ready", key: "preview-2" },
      { type: "frame-ready", key: "preview-2" },
      { type: "source-confirmed", key: "preview-2", at: readyAt },
    ];
    return events.reduce(
      reduceLivePreviewLifecycle,
      initialLivePreviewLifecycleState,
    );
  }

  it("reconnects again when the preview had been healthy for a while", () => {
    // The container sleeps after ten minutes idle, so an author who steps away
    // repeatedly meets this repeatedly. It is routine, and each occurrence
    // deserves the same automatic recovery as the first.
    const healthy = recoveredAndHealthySince(1_000);
    expect(healthy).toMatchObject({ phase: "ready", readySince: 1_000 });

    const recovering = reduceLivePreviewLifecycle(healthy, {
      type: "automatic-recovery",
      key: "preview-2",
      message: "Slept again",
      at: 1_000 + LIVE_PREVIEW_HEALTHY_EPISODE_MS,
    });

    expect(recovering).toMatchObject({
      phase: "reconnecting",
      automaticRecoveryAttempts: 1,
    });
  });

  it("gives up on a preview that keeps dying right after it comes up", () => {
    // Refilling the budget here would be a loop, and every turn of it wakes a
    // container.
    const flapping = recoveredAndHealthySince(1_000);

    expect(
      reduceLivePreviewLifecycle(flapping, {
        type: "automatic-recovery",
        key: "preview-2",
        message: "Died immediately",
        at: 1_000 + LIVE_PREVIEW_HEALTHY_EPISODE_MS - 1,
      }),
    ).toMatchObject({ phase: "failed", message: "Died immediately" });
  });

  it("dates the healthy period from becoming ready, not from the latest ack", () => {
    // Each acknowledged style revision confirms the source again. Restarting
    // the clock on every one would deny the budget to a preview that had in
    // fact been healthy for the whole ten minutes.
    const healthy = recoveredAndHealthySince(1_000);
    const acknowledgedAgain = reduceLivePreviewLifecycle(healthy, {
      type: "source-confirmed",
      key: "preview-2",
      at: 1_000 + LIVE_PREVIEW_HEALTHY_EPISODE_MS,
    });

    expect(acknowledgedAgain.readySince).toBe(1_000);
  });

  it("gives each waiting phase a user-facing label", () => {
    expect(livePreviewLifecycleLabel("starting-server")).toMatch(/Starting/);
    expect(livePreviewLifecycleLabel("loading-frame")).toMatch(/React/);
    expect(livePreviewLifecycleLabel("syncing-source")).toMatch(/Syncing/);
    expect(livePreviewLifecycleLabel("reconnecting")).toMatch(/Reconnecting/);
    expect(livePreviewLifecycleLabel("ready")).toBeNull();
    // Not a wait: the alert says why, and a spinner would say it is coming.
    expect(livePreviewLifecycleLabel("theme-error")).toBeNull();
  });
});

function run(
  events: readonly LivePreviewLifecycleEvent[],
  from: LivePreviewLifecycleState = initialLivePreviewLifecycleState,
) {
  return events.reduce(reduceLivePreviewLifecycle, from);
}

/** One preview in each phase a reconnect can be started from. */
function previewsInEveryPhase(): Record<string, LivePreviewLifecycleState> {
  const loading = run([{ type: "server-ready", key: "preview-1" }]);
  const syncing = run([{ type: "frame-ready", key: "preview-1" }], loading);
  const ready = run(
    [{ type: "source-confirmed", key: "preview-1", at: 0 }],
    syncing,
  );
  const themeError = run(
    [
      {
        type: "frame-compile-failed",
        key: "preview-1",
        failure: {
          files: ["src/routes/index.tsx"],
          source: { "src/routes/index.tsx": "broken" },
          paths: ["src/routes/index.tsx"],
        },
      },
    ],
    loading,
  );
  return {
    "starting-server": initialLivePreviewLifecycleState,
    "loading-frame": loading,
    "syncing-source": syncing,
    ready,
    failed: failedAfterOneRecovery(),
    "theme-error": themeError,
  };
}

/**
 * What the shell's server-state effect can still dispatch after a reconnect
 * was started but before React committed it: the answer it computed from the
 * phase it last rendered, for the frame the reconnect replaces.
 */
const STALE_SERVER_READY = { type: "server-ready", key: "preview-1" } as const;
const STALE_SERVER_FAILED = {
  type: "server-failed",
  message: "Live Preview server could not be started. Retry Preview.",
} as const;

describe("a reconnect in progress", () => {
  it("is not ended by a stale server-ready after a manual restart", () => {
    // retryLivePreview dispatches manual-recovery; the server-state effect,
    // still holding the phase it last rendered, dispatches server-ready for
    // the old frame in the same batch. Taking it would leave reconnecting
    // before any render committed it, so the restart request is never sent.
    for (const [phase, before] of Object.entries(previewsInEveryPhase())) {
      const reconnecting = run([{ type: "manual-recovery" }], before);
      expect(reconnecting.phase, phase).toBe("reconnecting");
      expect(
        reduceLivePreviewLifecycle(reconnecting, STALE_SERVER_READY),
        phase,
      ).toBe(reconnecting);
      // Nor by an answer under any other address: the reconnect's own request
      // has not finished, so no answer the shell holds is about the new frame.
      expect(
        reduceLivePreviewLifecycle(reconnecting, {
          type: "server-ready",
          key: "preview-9",
        }),
        phase,
      ).toBe(reconnecting);
    }
  });

  it("is not ended by a stale server-failed after a manual restart", () => {
    for (const [phase, before] of Object.entries(previewsInEveryPhase())) {
      const reconnecting = run([{ type: "manual-recovery" }], before);
      expect(
        reduceLivePreviewLifecycle(reconnecting, STALE_SERVER_FAILED),
        phase,
      ).toBe(reconnecting);
    }
  });

  const automaticallyReconnecting = () => {
    const reconnecting = run(
      [
        {
          type: "automatic-recovery",
          key: "preview-1",
          message: "Port expired",
          at: 0,
        },
      ],
      previewsInEveryPhase()["loading-frame"],
    );
    expect(reconnecting).toMatchObject({ phase: "reconnecting", recoveryId: 1 });
    return reconnecting;
  };

  it("is not ended by a stale server-ready after an automatic recovery", () => {
    const reconnecting = automaticallyReconnecting();
    expect(reduceLivePreviewLifecycle(reconnecting, STALE_SERVER_READY)).toBe(
      reconnecting,
    );
  });

  it("is not ended by a stale server-failed after an automatic recovery", () => {
    const reconnecting = automaticallyReconnecting();
    expect(reduceLivePreviewLifecycle(reconnecting, STALE_SERVER_FAILED)).toBe(
      reconnecting,
    );
  });

  const interruptedFrames = () =>
    (["loading-frame", "syncing-source", "ready", "theme-error"] as const).map(
      (phase) => {
        const reconnecting = run(
          [
            {
              type: "frame-interrupted",
              key: "preview-1",
              message: "Interrupted",
              at: 0,
            },
          ],
          previewsInEveryPhase()[phase],
        );
        expect(reconnecting.phase, phase).toBe("reconnecting");
        return [phase, reconnecting] as const;
      },
    );

  it("is not ended by a stale server-ready after an interrupted frame", () => {
    for (const [phase, reconnecting] of interruptedFrames()) {
      expect(
        reduceLivePreviewLifecycle(reconnecting, STALE_SERVER_READY),
        phase,
      ).toBe(reconnecting);
    }
  });

  it("is not ended by a stale server-failed after an interrupted frame", () => {
    for (const [phase, reconnecting] of interruptedFrames()) {
      expect(
        reduceLivePreviewLifecycle(reconnecting, STALE_SERVER_FAILED),
        phase,
      ).toBe(reconnecting);
    }
  });
});

/**
 * Counterexamples: what a reconnect must still do. None of these depends on
 * a reconnect ignoring stale answers, so they hold with or without that rule.
 */
describe("a reconnect still ends the way it should", () => {
  it("completes a restart once its own request has finished", () => {
    const ready = previewsInEveryPhase().ready;
    const reconnecting = run([{ type: "manual-recovery" }], ready);
    const restarted = run(
      [{ type: "recovery-request-finished", recoveryId: reconnecting.recoveryId }],
      reconnecting,
    );
    expect(restarted).toMatchObject({
      phase: "starting-server",
      key: null,
      message: null,
    });

    // The server's answer after the request is the real one, and is taken.
    const loading = run([{ type: "server-ready", key: "preview-2" }], restarted);
    expect(loading).toMatchObject({
      phase: "loading-frame",
      key: "preview-2",
      readySequence: 0,
    });
    const healthy = run(
      [
        { type: "frame-ready", key: "preview-2" },
        { type: "source-confirmed", key: "preview-2", at: 5 },
      ],
      loading,
    );
    expect(healthy).toMatchObject({
      phase: "ready",
      key: "preview-2",
      readySince: 5,
    });
  });

  it("lands in failed when the restart request did not bring a server up", () => {
    for (const reason of [
      // startThemePreviewServer threw: the query is in error.
      "Live Preview server could not be started. Retry Preview.",
      // startThemePreviewServer answered success: false.
      "Container did not start",
      // Nothing answered before the starting-server timer.
      "Live Preview server did not start in time. Retry Preview.",
    ]) {
      const reconnecting = run(
        [{ type: "manual-recovery" }],
        previewsInEveryPhase().ready,
      );
      const failed = run(
        [
          { type: "recovery-request-finished", recoveryId: reconnecting.recoveryId },
          { type: "server-failed", message: reason },
        ],
        reconnecting,
      );
      expect(failed, reason).toMatchObject({
        phase: "failed",
        key: null,
        message: reason,
      });
      // And the author can retry from there.
      expect(run([{ type: "manual-recovery" }], failed)).toMatchObject({
        phase: "reconnecting",
        recoveryId: reconnecting.recoveryId + 1,
      });
    }
  });

  it("lands in failed when an automatic recovery's request brought no server", () => {
    const reconnecting = run(
      [
        {
          type: "automatic-recovery",
          key: "preview-1",
          message: "Port expired",
          at: 0,
        },
      ],
      previewsInEveryPhase()["loading-frame"],
    );
    expect(
      run(
        [
          { type: "recovery-request-finished", recoveryId: reconnecting.recoveryId },
          { type: "server-failed", message: "Container did not start" },
        ],
        reconnecting,
      ),
    ).toMatchObject({ phase: "failed", message: "Container did not start" });
  });

  it("can be reset while it reconnects", () => {
    const reconnecting = run(
      [{ type: "manual-recovery" }],
      previewsInEveryPhase().ready,
    );
    const reset = run([{ type: "reset" }], reconnecting);
    expect(reset).toEqual({
      ...initialLivePreviewLifecycleState,
      recoveryId: reconnecting.recoveryId,
    });
    // The interrupted reconnect's request finishing later changes nothing.
    expect(
      run(
        [{ type: "recovery-request-finished", recoveryId: reconnecting.recoveryId }],
        reset,
      ),
    ).toBe(reset);
    // And the next server answer is taken as usual.
    expect(
      run([{ type: "server-ready", key: "preview-2" }], reset),
    ).toMatchObject({ phase: "loading-frame", key: "preview-2" });
  });

  it("is not ended by an older reconnect's request finishing", () => {
    const first = run([{ type: "manual-recovery" }], previewsInEveryPhase().ready);
    const second = run([{ type: "manual-recovery" }], first);
    expect(second.recoveryId).toBe(first.recoveryId + 1);
    expect(
      run(
        [{ type: "recovery-request-finished", recoveryId: first.recoveryId }],
        second,
      ),
    ).toBe(second);
    expect(
      run(
        [{ type: "recovery-request-finished", recoveryId: second.recoveryId }],
        second,
      ).phase,
    ).toBe("starting-server");
  });
});

describe("server answers outside a reconnect", () => {
  // The same table as before reconnects ignored stale answers.
  const holdsTheSameFrame = new Set([
    "loading-frame",
    "syncing-source",
    "ready",
    "failed",
    "theme-error",
  ]);

  it("server-ready: repeats for the frame shown are ignored, anything else loads it", () => {
    for (const [phase, state] of Object.entries(previewsInEveryPhase())) {
      const sameKey = { type: "server-ready", key: state.key ?? "preview-1" } as const;
      if (state.key !== null && holdsTheSameFrame.has(phase)) {
        expect(reduceLivePreviewLifecycle(state, sameKey), phase).toBe(state);
      } else {
        expect(reduceLivePreviewLifecycle(state, sameKey), phase).toEqual({
          ...state,
          phase: "loading-frame",
          key: sameKey.key,
          readySequence: 0,
          message: null,
          compileFailure: null,
        });
      }
      expect(
        reduceLivePreviewLifecycle(state, { type: "server-ready", key: "preview-7" }),
        phase,
      ).toEqual({
        ...state,
        phase: "loading-frame",
        key: "preview-7",
        readySequence: 0,
        message: null,
        compileFailure: null,
      });
    }
  });

  it("server-failed: fails the preview, unless it already failed for that reason", () => {
    for (const [phase, state] of Object.entries(previewsInEveryPhase())) {
      expect(
        reduceLivePreviewLifecycle(state, {
          type: "server-failed",
          message: "Down",
        }),
        phase,
      ).toEqual({
        ...state,
        phase: "failed",
        key: null,
        message: "Down",
        readySince: null,
        compileFailure: null,
      });
    }
    const failed = reduceLivePreviewLifecycle(initialLivePreviewLifecycleState, {
      type: "server-failed",
      message: "Down",
    });
    expect(
      reduceLivePreviewLifecycle(failed, { type: "server-failed", message: "Down" }),
    ).toBe(failed);
    expect(
      reduceLivePreviewLifecycle(failed, {
        type: "server-failed",
        message: "Down again",
      }),
    ).toMatchObject({ phase: "failed", message: "Down again" });
  });
});

describe("a Theme that does not compile", () => {
  const failure = {
    files: ["src/routes/error-recovery.tsx"],
    source: { "src/routes/error-recovery.tsx": "broken" },
    paths: ["src/routes/error-recovery.tsx"],
  };
  const loading = () =>
    reduceLivePreviewLifecycle(initialLivePreviewLifecycleState, {
      type: "server-ready",
      key: "preview-1",
    });
  const themeError = () =>
    reduceLivePreviewLifecycle(loading(), {
      type: "frame-compile-failed",
      key: "preview-1",
      failure,
    });

  it("is told apart from a preview that failed, and spends no recovery", () => {
    expect(themeError()).toMatchObject({
      phase: "theme-error",
      key: "preview-1",
      compileFailure: failure,
      automaticRecoveryAttempts: 0,
      message: null,
    });
  });

  it("is accepted whatever the frame's bridge said first", () => {
    // The bridge is a module graph of its own and can come up, and even
    // confirm the source, beside a Theme whose entry did not load.
    const ready = [
      { type: "frame-ready", key: "preview-1" },
      { type: "source-confirmed", key: "preview-1", at: 0 },
    ] satisfies LivePreviewLifecycleEvent[];
    const afterReady = ready.reduce(reduceLivePreviewLifecycle, loading());
    expect(afterReady.phase).toBe("ready");
    expect(
      reduceLivePreviewLifecycle(afterReady, {
        type: "frame-compile-failed",
        key: "preview-1",
        failure,
      }).phase,
    ).toBe("theme-error");
  });

  it("is held against that frame's bridge, which says nothing about the Theme", () => {
    const events = [
      { type: "frame-signal", key: "preview-1" },
      { type: "frame-ready", key: "preview-1" },
      { type: "source-confirmed", key: "preview-1", at: 0 },
      { type: "source-failed", key: "preview-1", message: "HMR failed" },
    ] satisfies LivePreviewLifecycleEvent[];
    const state = themeError();
    for (const event of events) {
      expect(reduceLivePreviewLifecycle(state, event)).toBe(state);
    }
  });

  it("ignores a report from a frame that was already replaced", () => {
    const state = reduceLivePreviewLifecycle(loading(), {
      type: "frame-compile-failed",
      key: "preview-0",
      failure,
    });
    expect(state.phase).toBe("loading-frame");
    expect(state.compileFailure).toBeNull();
  });

  it("takes a report again only when its files or their source changed", () => {
    const state = themeError();
    expect(
      reduceLivePreviewLifecycle(state, {
        type: "frame-compile-failed",
        key: "preview-1",
        failure: { ...failure, files: [...failure.files] },
      }),
    ).toBe(state);
    const otherFile = {
      files: ["src/components/Card.tsx"],
      source: { "src/components/Card.tsx": "broken" },
      paths: ["src/components/Card.tsx"],
    };
    expect(
      reduceLivePreviewLifecycle(state, {
        type: "frame-compile-failed",
        key: "preview-1",
        failure: otherFile,
      }).compileFailure,
    ).toEqual(otherFile);
    const otherSource = {
      ...failure,
      source: { "src/routes/error-recovery.tsx": "broken differently" },
    };
    expect(
      reduceLivePreviewLifecycle(state, {
        type: "frame-compile-failed",
        key: "preview-1",
        failure: otherSource,
      }).compileFailure,
    ).toEqual(otherSource);
  });

  it("ends with a new frame, and forgets the files with it", () => {
    const next = reduceLivePreviewLifecycle(themeError(), {
      type: "server-ready",
      key: "preview-2",
    });
    expect(next).toMatchObject({
      phase: "loading-frame",
      key: "preview-2",
      compileFailure: null,
    });
  });

  it("keeps waiting for a fix while the server query repeats itself", () => {
    const state = themeError();
    expect(
      reduceLivePreviewLifecycle(state, {
        type: "server-ready",
        key: "preview-1",
      }),
    ).toBe(state);
  });

  it("can still be refreshed, or reconnected after an interruption", () => {
    expect(
      reduceLivePreviewLifecycle(themeError(), { type: "manual-recovery" }),
    ).toMatchObject({ phase: "reconnecting", compileFailure: null });
    expect(
      reduceLivePreviewLifecycle(themeError(), {
        type: "frame-interrupted",
        key: "preview-1",
        message: "Interrupted",
        at: 0,
      }),
    ).toMatchObject({
      phase: "reconnecting",
      automaticRecoveryAttempts: 1,
      compileFailure: null,
    });
  });

  it("is not entered while there is no frame to have failed", () => {
    for (const phase of ["starting-server", "reconnecting"] as const) {
      const state = { ...loading(), phase };
      expect(
        reduceLivePreviewLifecycle(state, {
          type: "frame-compile-failed",
          key: "preview-1",
          failure,
        }),
      ).toBe(state);
    }
  });
});
