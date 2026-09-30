/**
 * Decides when a Live Preview frame that has not yet announced itself should
 * be given up on.
 *
 * A fixed deadline cannot tell a dead frame from a slow one. A cold dev
 * server can take longer than any sensible deadline to serve a page's module
 * graph while making steady progress, and a deadline long enough for that
 * leaves the author staring at a frame that was never going to answer. So the
 * wait is measured from the last sign of progress the page itself reported,
 * with an overall limit behind it:
 *
 * - never heard from at all: unreachable, after the no-progress window;
 * - heard from, then nothing new for the window: stalled;
 * - still moving at the overall limit: too slow.
 *
 * Progress is a new milestone or more finished resources — not merely another
 * message, which only proves the page's first script is still running. The
 * reports come from a frame that runs Theme JavaScript, so they are trusted
 * only to make this wait, and only up to the overall limit.
 *
 * Time spent hidden does not count. A background tab's timers are throttled,
 * the page's heartbeat with them, so silence there says nothing about the
 * frame; on returning, the no-progress window starts over.
 */
export const PREVIEW_FRAME_NO_PROGRESS_MS = 45_000;
/**
 * A backstop, not a performance target: long enough that a page still
 * visibly loading is never cut off in normal use.
 */
export const PREVIEW_FRAME_LOAD_LIMIT_MS = 180_000;

export type PreviewFrameLoadProgress = Readonly<{
  reached: readonly string[];
  resources: number;
}>;

export type PreviewFrameLoadExpiry = "unreachable" | "stalled" | "too-slow";

export type PreviewFrameVisibility = Readonly<{
  isHidden: () => boolean;
  /** Calls the listener on every change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}>;

export type PreviewFrameLoadWatchdog = Readonly<{
  progress: (report: PreviewFrameLoadProgress) => void;
  dispose: () => void;
}>;

export function documentVisibility(): PreviewFrameVisibility {
  return {
    isHidden: () => document.visibilityState === "hidden",
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export function createPreviewFrameLoadWatchdog(options: {
  onExpire: (reason: PreviewFrameLoadExpiry) => void;
  visibility: PreviewFrameVisibility;
  noProgressMs?: number;
  limitMs?: number;
  now?: () => number;
}): PreviewFrameLoadWatchdog {
  const noProgressMs = options.noProgressMs ?? PREVIEW_FRAME_NO_PROGRESS_MS;
  const limitMs = options.limitMs ?? PREVIEW_FRAME_LOAD_LIMIT_MS;
  const now = options.now ?? Date.now;
  const { visibility } = options;

  // All in visible time: what has elapsed while the editor could be seen.
  let visibleBefore = 0;
  let visibleSince: number | null = visibility.isHidden() ? null : now();
  let lastProgressAt = 0;
  let heard = false;
  let reachedCount = 0;
  let resources = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;

  const visibleNow = () =>
    visibleBefore + (visibleSince === null ? 0 : now() - visibleSince);

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const expire = (reason: PreviewFrameLoadExpiry) => {
    stop();
    options.onExpire(reason);
  };

  const check = () => {
    timer = null;
    if (done || visibleSince === null) return;
    const elapsed = visibleNow();
    if (elapsed >= limitMs) {
      expire("too-slow");
      return;
    }
    if (elapsed - lastProgressAt >= noProgressMs) {
      expire(heard ? "stalled" : "unreachable");
      return;
    }
    schedule();
  };

  const schedule = () => {
    clearTimer();
    if (done || visibleSince === null) return;
    const elapsed = visibleNow();
    const due = Math.min(lastProgressAt + noProgressMs, limitMs);
    timer = setTimeout(check, Math.max(0, due - elapsed));
  };

  const onVisibilityChange = () => {
    if (done) return;
    if (visibility.isHidden()) {
      if (visibleSince !== null) {
        visibleBefore += now() - visibleSince;
        visibleSince = null;
      }
      clearTimer();
      return;
    }
    if (visibleSince !== null) return;
    visibleSince = now();
    lastProgressAt = visibleNow();
    schedule();
  };

  const unsubscribe = visibility.subscribe(onVisibilityChange);

  function stop() {
    if (done) return;
    done = true;
    clearTimer();
    unsubscribe();
  }

  schedule();

  return {
    progress: (report) => {
      if (done) return;
      const advanced =
        !heard ||
        report.reached.length > reachedCount ||
        report.resources > resources;
      heard = true;
      reachedCount = Math.max(reachedCount, report.reached.length);
      resources = Math.max(resources, report.resources);
      if (!advanced) return;
      lastProgressAt = visibleNow();
      schedule();
    },
    dispose: stop,
  };
}
