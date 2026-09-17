import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_VERTICAL_OVERSCROLL,
  clampCanvasTransform,
  initialCanvasTransform,
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
