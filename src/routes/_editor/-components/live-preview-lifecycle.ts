export type LivePreviewLifecyclePhase =
  | "starting-server"
  | "loading-frame"
  | "syncing-source"
  | "ready"
  | "reconnecting"
  | "failed";

export type LivePreviewLifecycleState = Readonly<{
  phase: LivePreviewLifecyclePhase;
  key: string | null;
  readySequence: number;
  automaticRecoveryAttempts: number;
  recoveryId: number;
  message: string | null;
  /** When the current uninterrupted healthy period began, if there is one. */
  readySince: number | null;
}>;

/**
 * How long a preview must have been healthy for its next failure to count as
 * a new episode rather than a continuing one.
 *
 * The container sleeps after ten minutes idle, so an author who steps away
 * comes back to a preview that has to be reconnected — routine, not a fault,
 * and not something to spend a one-per-session budget on. A preview that dies
 * seconds after coming up is the opposite: reconnecting it again would be a
 * loop, and each turn of that loop wakes a container.
 *
 * A minute sits between the two by orders of magnitude, which is the only
 * property this threshold needs.
 */
export const LIVE_PREVIEW_HEALTHY_EPISODE_MS = 60_000;

export type LivePreviewLifecycleEvent =
  | Readonly<{ type: "reset" }>
  | Readonly<{ type: "server-ready"; key: string }>
  | Readonly<{ type: "server-failed"; message: string }>
  | Readonly<{ type: "frame-signal"; key: string }>
  | Readonly<{ type: "frame-ready"; key: string }>
  | Readonly<{ type: "source-confirmed"; key: string; at: number }>
  | Readonly<{ type: "source-failed"; key: string; message: string }>
  | Readonly<{
      type: "automatic-recovery";
      key: string;
      message: string;
      at: number;
    }>
  | Readonly<{ type: "recovery-request-finished"; recoveryId: number }>
  | Readonly<{ type: "manual-recovery" }>;

export const initialLivePreviewLifecycleState: LivePreviewLifecycleState = {
  phase: "starting-server",
  key: null,
  readySequence: 0,
  automaticRecoveryAttempts: 0,
  recoveryId: 0,
  message: null,
  readySince: null,
};

/**
 * One owner for the Live Preview lifecycle.
 *
 * Events carrying a key are ignored when they belong to an iframe that has
 * already been replaced. This is the same stale-answer rule used by source
 * revision acknowledgements, applied to readiness and failures as well.
 */
export function reduceLivePreviewLifecycle(
  state: LivePreviewLifecycleState,
  event: LivePreviewLifecycleEvent,
): LivePreviewLifecycleState {
  switch (event.type) {
    case "reset":
      return {
        ...initialLivePreviewLifecycleState,
        recoveryId: state.recoveryId,
      };
    case "server-ready":
      // A preview that already failed stays failed until something actually
      // changes for it. The server query keeps holding its last successful
      // answer, so this event arrives again on every render; treating it as
      // news would restart the very frame that just gave up, clear the
      // message explaining why, and take the retry away from the author
      // before they could reach it.
      if (
        state.key === event.key &&
        (state.phase === "loading-frame" ||
          state.phase === "syncing-source" ||
          state.phase === "ready" ||
          state.phase === "failed")
      ) {
        return state;
      }
      return {
        ...state,
        phase: "loading-frame",
        key: event.key,
        readySequence: 0,
        message: null,
      };
    case "server-failed":
      if (
        state.phase === "failed" &&
        state.key === null &&
        state.message === event.message
      ) {
        return state;
      }
      return {
        ...state,
        phase: "failed",
        key: null,
        message: event.message,
        readySince: null,
      };
    case "frame-signal":
      if (state.key !== event.key || state.phase !== "loading-frame") {
        return state;
      }
      return {
        ...state,
        phase: "syncing-source",
        readySequence: 1,
        message: null,
        readySince: null,
      };
    case "frame-ready":
      if (state.key !== event.key) return state;
      return {
        ...state,
        phase: "syncing-source",
        readySequence: state.readySequence + 1,
        message: null,
        readySince: null,
      };
    case "source-confirmed":
      if (state.key !== event.key) return state;
      return {
        ...state,
        phase: "ready",
        message: null,
        // Every acknowledged source revision confirms again, so the period is
        // dated from becoming healthy, not from the latest proof of it.
        readySince: state.phase === "ready" ? state.readySince : event.at,
      };
    case "source-failed":
      if (state.key !== event.key) return state;
      if (state.phase === "failed" && state.message === event.message) {
        return state;
      }
      return {
        ...state,
        phase: "failed",
        message: event.message,
        readySince: null,
      };
    case "automatic-recovery": {
      if (state.key !== event.key) return state;
      // Judged now rather than on the way in, because how long the preview
      // stayed healthy is only known once it stops being healthy.
      const wasHealthyLongEnough =
        state.readySince !== null &&
        event.at - state.readySince >= LIVE_PREVIEW_HEALTHY_EPISODE_MS;
      if (state.automaticRecoveryAttempts >= 1 && !wasHealthyLongEnough) {
        return {
          ...state,
          phase: "failed",
          message: event.message,
          readySince: null,
        };
      }
      return {
        ...state,
        phase: "reconnecting",
        key: null,
        readySequence: 0,
        readySince: null,
        automaticRecoveryAttempts: wasHealthyLongEnough
          ? 1
          : state.automaticRecoveryAttempts + 1,
        recoveryId: state.recoveryId + 1,
        message: event.message,
      };
    }
    case "recovery-request-finished":
      if (
        state.phase !== "reconnecting" ||
        state.recoveryId !== event.recoveryId
      ) {
        return state;
      }
      return {
        ...state,
        phase: "starting-server",
        message: null,
      };
    case "manual-recovery":
      return {
        ...state,
        phase: "reconnecting",
        key: null,
        readySequence: 0,
        readySince: null,
        automaticRecoveryAttempts: 0,
        recoveryId: state.recoveryId + 1,
        message: null,
      };
  }
}

export function livePreviewLifecycleLabel(
  phase: LivePreviewLifecyclePhase,
): string | null {
  switch (phase) {
    case "starting-server":
      return "Starting Live Preview…";
    case "loading-frame":
      return "Loading React preview…";
    case "syncing-source":
      return "Syncing Theme source…";
    case "reconnecting":
      return "Reconnecting Live Preview…";
    case "ready":
    case "failed":
      return null;
  }
}
