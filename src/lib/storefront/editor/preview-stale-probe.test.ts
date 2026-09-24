// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startPreviewStaleProbe,
  type PreviewProbeAnswer,
} from "./preview-stale-probe";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const answers = (...sequence: PreviewProbeAnswer[]) => {
  let index = 0;
  return vi.fn(async () => sequence[Math.min(index++, sequence.length - 1)]!);
};

describe("startPreviewStaleProbe", () => {
  it("checks a few seconds in, then keeps checking while it serves", async () => {
    const probe = answers("serving");
    const onStale = vi.fn();
    startPreviewStaleProbe({ probe, onStale });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("reports a stale address once, and stops asking", async () => {
    const probe = answers("serving", "stale");
    const onStale = vi.fn();
    startPreviewStaleProbe({ probe, onStale });

    await vi.advanceTimersByTimeAsync(5_000 + 4_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("brings the check forward on a hint", async () => {
    const probe = answers("stale");
    const onStale = vi.fn();
    const handle = startPreviewStaleProbe({ probe, onStale });

    await vi.advanceTimersByTimeAsync(1_200);
    handle.hint();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("shares one check between hints that arrive together", async () => {
    let resolve!: (answer: PreviewProbeAnswer) => void;
    const probe = vi.fn(
      () => new Promise<PreviewProbeAnswer>((done) => (resolve = done)),
    );
    const handle = startPreviewStaleProbe({ probe, onStale: vi.fn() });

    handle.hint();
    handle.hint();
    expect(probe).toHaveBeenCalledTimes(1);
    resolve("serving");
    await vi.advanceTimersByTimeAsync(0);
    // Too soon after the last check for another hint to ask again.
    handle.hint();
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    handle.hint();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does not act on an answer it cannot trust", async () => {
    const probe = vi
      .fn<() => Promise<PreviewProbeAnswer>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("unknown");
    const onStale = vi.fn();
    startPreviewStaleProbe({ probe, onStale });

    await vi.advanceTimersByTimeAsync(5_000 + 4_000 * 3);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("goes quiet when stopped, even with a check in flight", async () => {
    let resolve!: (answer: PreviewProbeAnswer) => void;
    const probe = vi.fn(
      () => new Promise<PreviewProbeAnswer>((done) => (resolve = done)),
    );
    const onStale = vi.fn();
    const handle = startPreviewStaleProbe({ probe, onStale });

    await vi.advanceTimersByTimeAsync(5_000);
    handle.stop();
    resolve("stale");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onStale).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
