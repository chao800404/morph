import {
  samePreviewCompileFailure,
  type PreviewCompileFailure,
} from "@/lib/storefront/editor/preview-compile-failure";

export type LivePreviewLifecyclePhase =
  | "starting-server"
  | "loading-frame"
  | "syncing-source"
  | "ready"
  | "reconnecting"
  | "failed"
  /**
   * The runtime is serving, but the Theme does not compile: the frame's page
   * could not load its own modules. Not a failure of the preview, so nothing
   * here reconnects or times out — reconnecting would compile the same source
   * and fail the same way.
   *
   * Held for the frame that reported it. The preview bridge is a module graph
   * of its own and can come up beside a Theme that did not, so its signals
   * from that frame say nothing about the Theme and are ignored. What ends
   * the phase is a new frame: the editor loads one once newer source has been
   * written into the preview, or when the author refreshes.
   */
  | "theme-error";

export type LivePreviewLifecycleState = Readonly<{
  phase: LivePreviewLifecyclePhase;
  key: string | null;
  readySequence: number;
  automaticRecoveryAttempts: number;
  recoveryId: number;
  message: string | null;
  /** Which Theme files would not compile, while the phase is `theme-error`. */
  compileFailure: PreviewCompileFailure | null;
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
  /**
   * The frame's document cannot come up: a module it needed was refused by
   * an interruption of the preview runtime. Same bounded recovery as any
   * other failure, but only for a frame still on its way or showing — a
   * preview that already failed or is reconnecting has nothing to reload.
   */
  | Readonly<{
      type: "frame-interrupted";
      key: string;
      message: string;
      at: number;
    }>
  /**
   * The frame's document cannot come up because Vite would not compile one of
   * the Theme's files. Accepted for the current frame whatever it has said
   * before: its bridge can report ready beside a Theme that failed, and Vite
   * reloads a page in place when an update breaks it.
   */
  | Readonly<{
      type: "frame-compile-failed";
      key: string;
      failure: PreviewCompileFailure;
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
  compileFailure: null,
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
  const next = reduce(state, event);
  // The failed files describe the phase that names them, and no other.
  return next.phase !== "theme-error" && next.compileFailure !== null
    ? { ...next, compileFailure: null }
    : next;
}

function reduce(
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
          state.phase === "failed" ||
          state.phase === "theme-error")
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
      if (state.key !== event.key || state.phase === "theme-error") {
        return state;
      }
      return {
        ...state,
        phase: "syncing-source",
        readySequence: state.readySequence + 1,
        message: null,
        readySince: null,
      };
    case "source-confirmed":
      if (state.key !== event.key || state.phase === "theme-error") {
        return state;
      }
      return {
        ...state,
        phase: "ready",
        message: null,
        // Every acknowledged source revision confirms again, so the period is
        // dated from becoming healthy, not from the latest proof of it.
        readySince: state.phase === "ready" ? state.readySince : event.at,
      };
    case "source-failed":
      // A Theme that does not compile cannot take an update either; the
      // compile error is the more specific of the two answers.
      if (state.key !== event.key || state.phase === "theme-error") {
        return state;
      }
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
    case "frame-interrupted":
      if (
        state.phase !== "loading-frame" &&
        state.phase !== "syncing-source" &&
        state.phase !== "ready" &&
        // A page that reloaded itself after a compile error loads its
        // modules again, and an interruption can break that load as well.
        state.phase !== "theme-error"
      ) {
        return state;
      }
      return reduceLivePreviewLifecycle(state, {
        type: "automatic-recovery",
        key: event.key,
        message: event.message,
        at: event.at,
      });
    case "frame-compile-failed":
      if (
        state.key !== event.key ||
        state.phase === "starting-server" ||
        state.phase === "reconnecting"
      ) {
        return state;
      }
      if (
        state.phase === "theme-error" &&
        state.compileFailure &&
        samePreviewCompileFailure(state.compileFailure, event.failure)
      ) {
        return state;
      }
      return {
        ...state,
        phase: "theme-error",
        message: null,
        compileFailure: event.failure,
        readySince: null,
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
    case "theme-error":
      return null;
  }
}
