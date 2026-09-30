// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewFrameLoadWatchdog,
  PREVIEW_FRAME_LOAD_LIMIT_MS,
  PREVIEW_FRAME_NO_PROGRESS_MS,
  type PreviewFrameLoadExpiry,
} from "./preview-frame-load-watchdog";

function fakeVisibility() {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    visibility: {
      isHidden: () => hidden,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    set(next: boolean) {
      hidden = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function start() {
  const expired: PreviewFrameLoadExpiry[] = [];
  const tab = fakeVisibility();
  const watchdog = createPreviewFrameLoadWatchdog({
    visibility: tab.visibility,
    onExpire: (reason) => expired.push(reason),
  });
  let resources = 0;
  const reached: string[] = ["script"];
  return {
    expired,
    tab,
    watchdog,
    /** The page's heartbeat, with `finished` more resources since the last. */
    report: (finished = 0, milestone?: string) => {
      resources += finished;
      if (milestone) reached.push(milestone);
      watchdog.progress({ reached: [...reached], resources });
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the preview frame load watchdog", () => {
  it("gives up on a frame that never says anything, at the no-progress window", () => {
    const frame = start();
    vi.advanceTimersByTime(PREVIEW_FRAME_NO_PROGRESS_MS - 1);
    expect(frame.expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(frame.expired).toEqual(["unreachable"]);
  });

  it("keeps waiting well past the window for a frame that keeps making progress", () => {
    // The stall this replaces: a cold page still fetching modules at 45s.
    const frame = start();
    frame.report();
    for (let second = 5; second <= 120; second += 5) {
      vi.advanceTimersByTime(5_000);
      frame.report(3);
    }
    expect(frame.expired).toEqual([]);
  });

  it("counts a new milestone as progress even when no resource finished", () => {
    const frame = start();
    frame.report();
    vi.advanceTimersByTime(40_000);
    frame.report(0, "bridge");
    vi.advanceTimersByTime(40_000);
    expect(frame.expired).toEqual([]);
  });

  it("does not count a heartbeat that reports nothing new", () => {
    const frame = start();
    frame.report(1);
    for (let second = 5; second < 45; second += 5) {
      vi.advanceTimersByTime(5_000);
      frame.report(0);
    }
    vi.advanceTimersByTime(5_000);
    expect(frame.expired).toEqual(["stalled"]);
  });

  it("gives up once progress stops, a window after the last of it", () => {
    const frame = start();
    frame.report();
    vi.advanceTimersByTime(30_000);
    frame.report(5);
    vi.advanceTimersByTime(PREVIEW_FRAME_NO_PROGRESS_MS - 1);
    expect(frame.expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(frame.expired).toEqual(["stalled"]);
  });

  it("gives up at the overall limit on a frame that never stops trickling", () => {
    const frame = start();
    frame.report();
    for (let elapsed = 0; elapsed < PREVIEW_FRAME_LOAD_LIMIT_MS; ) {
      vi.advanceTimersByTime(10_000);
      elapsed += 10_000;
      if (frame.expired.length === 0) frame.report(1);
    }
    expect(frame.expired).toEqual(["too-slow"]);
  });

  it("expires once, and not at all after it is disposed", () => {
    const frame = start();
    vi.advanceTimersByTime(PREVIEW_FRAME_LOAD_LIMIT_MS * 2);
    expect(frame.expired).toEqual(["unreachable"]);

    const disposed = start();
    disposed.watchdog.dispose();
    vi.advanceTimersByTime(PREVIEW_FRAME_LOAD_LIMIT_MS * 2);
    expect(disposed.expired).toEqual([]);
    expect(disposed.tab.listenerCount()).toBe(0);
  });

  it("ignores reports after it has expired", () => {
    const frame = start();
    vi.advanceTimersByTime(PREVIEW_FRAME_NO_PROGRESS_MS);
    frame.report(10, "bridge");
    vi.advanceTimersByTime(PREVIEW_FRAME_LOAD_LIMIT_MS);
    expect(frame.expired).toEqual(["unreachable"]);
  });

  describe("in a background tab", () => {
    it("does not count hidden time, however long, against the frame", () => {
      const frame = start();
      frame.report();
      vi.advanceTimersByTime(40_000);
      frame.tab.set(true);
      // Throttled timers: the page's heartbeat may not arrive at all.
      vi.advanceTimersByTime(10 * 60_000);
      expect(frame.expired).toEqual([]);
    });

    it("starts the no-progress window over on returning", () => {
      const frame = start();
      frame.report();
      vi.advanceTimersByTime(40_000);
      frame.tab.set(true);
      vi.advanceTimersByTime(60_000);
      frame.tab.set(false);
      vi.advanceTimersByTime(PREVIEW_FRAME_NO_PROGRESS_MS - 1);
      expect(frame.expired).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(frame.expired).toEqual(["stalled"]);
    });

    it("counts only visible time toward the overall limit", () => {
      const frame = start();
      frame.report();
      const half = PREVIEW_FRAME_LOAD_LIMIT_MS / 2;
      for (let elapsed = 0; elapsed < half; elapsed += 10_000) {
        vi.advanceTimersByTime(10_000);
        frame.report(1);
      }
      frame.tab.set(true);
      vi.advanceTimersByTime(PREVIEW_FRAME_LOAD_LIMIT_MS);
      frame.tab.set(false);
      for (let elapsed = 0; elapsed < half - 10_000; elapsed += 10_000) {
        vi.advanceTimersByTime(10_000);
        frame.report(1);
      }
      expect(frame.expired).toEqual([]);
      vi.advanceTimersByTime(10_000);
      expect(frame.expired).toEqual(["too-slow"]);
    });

    it("waits for the tab to be seen when it starts hidden", () => {
      const tab = fakeVisibility();
      tab.set(true);
      const expired: PreviewFrameLoadExpiry[] = [];
      createPreviewFrameLoadWatchdog({
        visibility: tab.visibility,
        onExpire: (reason) => expired.push(reason),
      });
      vi.advanceTimersByTime(10 * 60_000);
      expect(expired).toEqual([]);
      tab.set(false);
      vi.advanceTimersByTime(PREVIEW_FRAME_NO_PROGRESS_MS);
      expect(expired).toEqual(["unreachable"]);
    });
  });
});
