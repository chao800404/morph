import { describe, expect, it, vi } from "vitest";
import { scheduleInspectorPreRender } from "./editor-inspector-pre-render";

describe("scheduleInspectorPreRender", () => {
  it("uses idle time to pre-render the inspector", () => {
    const callback = vi.fn();
    const cancelIdleCallback = vi.fn();
    let idleCallback: IdleRequestCallback | undefined;
    const cancel = scheduleInspectorPreRender(callback, {
      requestIdleCallback: (nextCallback, options) => {
        idleCallback = nextCallback;
        expect(options).toEqual({ timeout: 1_200 });
        return 42;
      },
      cancelIdleCallback,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });

    idleCallback?.({ didTimeout: false, timeRemaining: () => 50 });
    expect(callback).toHaveBeenCalledOnce();

    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
  });

  it("falls back to a short timer and prevents work after cancellation", () => {
    const callback = vi.fn();
    const clearTimeout = vi.fn();
    let timeoutCallback: (() => void) | undefined;
    const cancel = scheduleInspectorPreRender(callback, {
      setTimeout: ((nextCallback: TimerHandler, delay?: number) => {
        timeoutCallback = nextCallback as () => void;
        expect(delay).toBe(200);
        return 7;
      }) as Window["setTimeout"],
      clearTimeout,
    });

    cancel();
    timeoutCallback?.();

    expect(clearTimeout).toHaveBeenCalledWith(7);
    expect(callback).not.toHaveBeenCalled();
  });
});
