import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_SCROLL_COMMIT_DELAY_MS,
  CANVAS_VERTICAL_OVERSCROLL,
  clampCanvasTransform,
  initialCanvasTransform,
  type CanvasTransform,
} from "./editor-canvas-geometry";
import { useEditorCanvasTransform } from "./use-editor-canvas-transform";

/**
 * The canvas measures its own viewport.
 *
 * The height used to be observed by the shell while the ref was owned here, so
 * the measurement and the clamp that consumes it lived in two components. This
 * pins the half that moved: a reported height reaches the ref, and a transform
 * scheduled afterwards is clamped by it rather than left where it was asked to
 * go. jsdom has no layout, so without an observer that reports — the setup
 * file's is silent — the height stays 0 and no clamp is applied at all, which
 * is exactly the difference being asserted.
 */

/**
 * What a canvas pan must not cost.
 *
 * The height tests below pin a measurement. These pin the gesture, and they are
 * the ones with no other witness: panning calls `schedule` on every pointer
 * event, and the difference between a drag that repaints a CSS variable and a
 * drag that re-renders the editor shell is invisible in the result. It is the
 * defect the eleventh round found in the panel resize — `use-panel-resize`
 * grew exactly these three assertions afterwards, and this hook, which carries
 * the most-used gesture in the editor, had none of them.
 *
 * Frames and timers are driven by hand: a real `requestAnimationFrame` would
 * make "one frame per burst of moves" a race rather than a statement.
 */

let renderCount = 0;
let frames: Array<() => void> = [];

function flushFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

function GestureHarness() {
  renderCount += 1;
  const previewWidthRef = useRef(1440);
  const previewFrameHeightRef = useRef(FRAME_HEIGHT);
  const { transform, viewportRef, schedule } = useEditorCanvasTransform({
    previewWidthRef,
    previewFrameHeightRef,
  });
  scheduleFromTest = schedule;
  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      data-x={transform.x}
      data-y={transform.y}
    />
  );
}

let scheduleFromTest: ((next: CanvasTransform) => void) | null = null;

const VIEWPORT_HEIGHT = 900;
const FRAME_HEIGHT = 4_000;

class ReportingResizeObserver {
  private readonly reported = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    if (this.reported.has(target)) return;
    this.reported.add(target);
    queueMicrotask(() => {
      this.callback(
        [
          {
            target,
            contentRect: { height: VIEWPORT_HEIGHT },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    });
  }

  unobserve() {}

  disconnect() {}
}

type CanvasApi = ReturnType<typeof useEditorCanvasTransform>;

function Harness({ api }: { api: { current: CanvasApi | null } }) {
  const previewWidthRef = useRef(1_440);
  const previewFrameHeightRef = useRef(FRAME_HEIGHT);
  const canvas = useEditorCanvasTransform({
    previewWidthRef,
    previewFrameHeightRef,
  });
  api.current = canvas;
  return <div ref={canvas.viewportRef} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the canvas viewport measurement", () => {
  it("records the height its own observer reports", async () => {
    vi.stubGlobal("ResizeObserver", ReportingResizeObserver);
    const api: { current: CanvasApi | null } = { current: null };
    render(<Harness api={api} />);

    // The observer answers asynchronously, as a real one does.
    await act(async () => {});

    expect(api.current?.viewportHeightRef.current).toBe(VIEWPORT_HEIGHT);
  });

  it("clamps against the measured height", async () => {
    vi.stubGlobal("ResizeObserver", ReportingResizeObserver);
    const api: { current: CanvasApi | null } = { current: null };
    render(<Harness api={api} />);
    await act(async () => {});

    const requested = { ...initialCanvasTransform, y: -10_000 };
    act(() => {
      api.current?.schedule(requested);
    });

    const settled = api.current?.transformRef.current.y ?? 0;
    // Clamped to what that height allows, not left where it was asked to go.
    expect(settled).not.toBe(requested.y);
    expect(settled).toBe(
      clampCanvasTransform(requested, VIEWPORT_HEIGHT, FRAME_HEIGHT).y,
    );
    // A clamp of the reported height, not of zero: with no height the hook
    // applies the request unchanged.
    expect(settled).toBeLessThan(-CANVAS_VERTICAL_OVERSCROLL);
  });
});

describe("what a canvas pan costs while the pointer is down", () => {
  beforeEach(() => {
    renderCount = 0;
    frames = [];
    scheduleFromTest = null;
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * The one that matters. A re-render here is the whole editor shell, and the
   * shell holds the preview iframe — which is how a pan came to starve the
   * thing it was panning.
   */
  it("does not re-render while the pan is in flight", () => {
    render(<GestureHarness />);
    const afterMount = renderCount;

    // One `act` per move, not one around the loop: a browser delivers twenty
    // pointer events as twenty tasks, and batching them into one would let a
    // per-move `setState` regression show up as a single extra render instead
    // of twenty.
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        scheduleFromTest?.({ x: step * 10, y: 0, scale: 1 });
        flushFrames();
      });
    }

    expect(
      renderCount,
      "panning re-rendered the component that owns the preview",
    ).toBe(afterMount);
  });

  it("coalesces several moves in one frame into a single paint", () => {
    render(<GestureHarness />);

    act(() => {
      scheduleFromTest?.({ x: 10, y: 0, scale: 1 });
      scheduleFromTest?.({ x: 20, y: 0, scale: 1 });
      scheduleFromTest?.({ x: 30, y: 0, scale: 1 });
    });

    // Three moves, one frame — and the frame paints where the pointer ended up,
    // not where it was when the frame was asked for.
    expect(frames).toHaveLength(1);
    act(() => flushFrames());
    const viewport = document.querySelector<HTMLDivElement>(
      '[data-testid="viewport"]',
    )!;
    expect(viewport.style.getPropertyValue("--morph-canvas-x")).toBe("30px");
  });

  it("commits once, after the pan stops", () => {
    render(<GestureHarness />);
    const afterMount = renderCount;

    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        scheduleFromTest?.({ x: step * 10, y: 0, scale: 1 });
        flushFrames();
      });
    }
    expect(renderCount).toBe(afterMount);

    act(() => {
      vi.advanceTimersByTime(CANVAS_SCROLL_COMMIT_DELAY_MS + 1);
    });

    // Exactly one: the commit is debounced, so twenty moves settle into a
    // single state update carrying the final position.
    expect(renderCount).toBe(afterMount + 1);
    const viewport = document.querySelector<HTMLDivElement>(
      '[data-testid="viewport"]',
    )!;
    expect(viewport.dataset.x).toBe("200");
  });

  /**
   * A move that changes nothing is a pointer event that resolved to the same
   * place. Without this, "no re-render during the drag" could be met by a hook
   * that does no work at all.
   */
  it("schedules no frame for a move that changes nothing", () => {
    render(<GestureHarness />);

    act(() => {
      scheduleFromTest?.({ x: 40, y: 0, scale: 1 });
    });
    act(() => flushFrames());
    frames = [];

    act(() => {
      scheduleFromTest?.({ x: 40, y: 0, scale: 1 });
    });

    expect(frames).toHaveLength(0);
  });
});
