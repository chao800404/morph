import { useCallback, useRef, useState, type RefObject } from "react";

import {
  CANVAS_SCROLL_COMMIT_DELAY_MS,
  clampCanvasTransform,
  initialCanvasTransform,
  type CanvasTransform,
} from "./editor-canvas-geometry";

/**
 * Pan and zoom for the editor canvas.
 *
 * Held apart from the shell because it is the one piece of that component with
 * a boundary this clean: five refs, three functions, and two values it reads
 * from outside. Inside the shell it was 90 lines between a resize handler and a
 * preview measurement, which is how a self-contained thing goes unnoticed.
 *
 * A transform is written to the DOM through CSS variables on the next frame and
 * committed to React state only after the gesture settles. Panning at sixty
 * frames a second through `setState` re-renders an editor whose tree is large
 * enough for that to be felt, and nothing in it depends on the intermediate
 * values.
 */
export function useEditorCanvasTransform({
  previewWidthRef,
  previewFrameHeightRef,
}: {
  previewWidthRef: RefObject<number>;
  previewFrameHeightRef: RefObject<number>;
}) {
  const [transform, setTransform] = useState<CanvasTransform>(
    initialCanvasTransform,
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef(transform);
  const renderFrameRef = useRef(0);
  const commitTimerRef = useRef(0);
  const viewportHeightRef = useRef(0);

  const applyToDom = useCallback(
    (next: CanvasTransform) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      viewport.style.setProperty("--morph-canvas-x", `${next.x}px`);
      viewport.style.setProperty("--morph-canvas-y", `${next.y}px`);
      viewport.style.setProperty("--morph-canvas-scale", String(next.scale));
      viewport.style.setProperty(
        "--morph-canvas-half-width",
        `${(previewWidthRef.current * next.scale) / 2}px`,
      );
      viewport.style.setProperty(
        "--morph-canvas-scaled-height",
        `${previewFrameHeightRef.current * next.scale}px`,
      );
    },
    [previewFrameHeightRef, previewWidthRef],
  );

  const scheduleCommit = useCallback(() => {
    if (commitTimerRef.current !== 0) {
      window.clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = 0;
      const current = transformRef.current;
      setTransform((previous) =>
        previous.x === current.x &&
        previous.y === current.y &&
        previous.scale === current.scale
          ? previous
          : current,
      );
    }, CANVAS_SCROLL_COMMIT_DELAY_MS);
  }, []);

  const schedule = useCallback(
    (
      action: CanvasTransform | ((current: CanvasTransform) => CanvasTransform),
    ) => {
      const current = transformRef.current;
      const requested = typeof action === "function" ? action(current) : action;
      const viewportHeight =
        viewportHeightRef.current || viewportRef.current?.clientHeight || 0;
      const next =
        viewportHeight > 0
          ? clampCanvasTransform(
              requested,
              viewportHeight,
              previewFrameHeightRef.current,
            )
          : requested;
      const didChange = !(
        next.x === current.x &&
        next.y === current.y &&
        next.scale === current.scale
      );
      if (!didChange) return;

      transformRef.current = next;
      if (commitTimerRef.current !== 0) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = 0;
      }
      if (renderFrameRef.current !== 0) return;

      renderFrameRef.current = requestAnimationFrame(() => {
        renderFrameRef.current = 0;
        applyToDom(transformRef.current);
        scheduleCommit();
      });
    },
    [applyToDom, previewFrameHeightRef, scheduleCommit],
  );

  /** Releases the frame and timer a gesture may have left pending. */
  const dispose = useCallback(() => {
    cancelAnimationFrame(renderFrameRef.current);
    window.clearTimeout(commitTimerRef.current);
  }, []);

  return {
    transform,
    setTransform,
    transformRef,
    viewportRef,
    viewportHeightRef,
    renderFrameRef,
    commitTimerRef,
    applyToDom,
    schedule,
    scheduleCommit,
    dispose,
  };
}
