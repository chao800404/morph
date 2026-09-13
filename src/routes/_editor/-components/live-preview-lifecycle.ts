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
}>;

export type LivePreviewLifecycleEvent =
  | Readonly<{ type: "reset" }>
  | Readonly<{ type: "server-ready"; key: string }>
  | Readonly<{ type: "server-failed"; message: string }>
  | Readonly<{ type: "frame-signal"; key: string }>
  | Readonly<{ type: "frame-ready"; key: string }>
  | Readonly<{ type: "source-confirmed"; key: string }>
  | Readonly<{ type: "source-failed"; key: string; message: string }>
  | Readonly<{ type: "automatic-recovery"; key: string; message: string }>
  | Readonly<{ type: "recovery-request-finished"; recoveryId: number }>
  | Readonly<{ type: "manual-recovery" }>;

export const initialLivePreviewLifecycleState: LivePreviewLifecycleState = {
  phase: "starting-server",
  key: null,
  readySequence: 0,
  automaticRecoveryAttempts: 0,
  recoveryId: 0,
  message: null,
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
      if (
        state.key === event.key &&
        (state.phase === "loading-frame" ||
          state.phase === "syncing-source" ||
          state.phase === "ready")
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
      };
    case "frame-ready":
      if (state.key !== event.key) return state;
      return {
        ...state,
        phase: "syncing-source",
        readySequence: state.readySequence + 1,
        message: null,
      };
    case "source-confirmed":
      if (state.key !== event.key) return state;
      return { ...state, phase: "ready", message: null };
    case "source-failed":
      if (state.key !== event.key) return state;
      if (state.phase === "failed" && state.message === event.message) {
        return state;
      }
      return { ...state, phase: "failed", message: event.message };
    case "automatic-recovery":
      if (state.key !== event.key) return state;
      if (state.automaticRecoveryAttempts >= 1) {
        return { ...state, phase: "failed", message: event.message };
      }
      return {
        ...state,
        phase: "reconnecting",
        key: null,
        readySequence: 0,
        automaticRecoveryAttempts: state.automaticRecoveryAttempts + 1,
        recoveryId: state.recoveryId + 1,
        message: event.message,
      };
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
