import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SELECTION_OVERLAY_SETTLE_MS,
  createSelectionOverlaySettler,
} from "./selection-overlay-settler";

describe("createSelectionOverlaySettler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps geometry frozen until rapid preview mutations settle", () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    const settler = createSelectionOverlaySettler(onSettled);

    settler.freezeUntilSettled();
    vi.advanceTimersByTime(SELECTION_OVERLAY_SETTLE_MS - 20);
    settler.freezeUntilSettled();
    vi.advanceTimersByTime(SELECTION_OVERLAY_SETTLE_MS - 1);

    expect(settler.isFrozen()).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(settler.isFrozen()).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending geometry refresh during cleanup", () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    const settler = createSelectionOverlaySettler(onSettled);

    settler.freezeUntilSettled();
    settler.cancel();
    vi.runAllTimers();

    expect(settler.isFrozen()).toBe(false);
    expect(onSettled).not.toHaveBeenCalled();
  });
});
