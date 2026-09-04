import {
  resolvePanelResizeKey,
  resolvePanelResizeWidth,
  type PanelEdge,
} from "@/lib/storefront/editor/panel-resize";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives a side panel's width without re-rendering during the drag.
 *
 * Calling `setState` on every `pointermove` re-rendered the whole editor shell
 * — a component with ~150 hooks whose memoised children were already being
 * defeated by inline props — at pointer rate, which on a high-refresh display
 * is 120+ full reconciliations per second. The preview iframe has to re-layout
 * its entire document on each width change anyway, and that work was competing
 * with React for the main thread, so the canvas visibly dropped frames.
 *
 * So the drag writes the width straight to a CSS custom property on the
 * surface element and coalesces those writes with `requestAnimationFrame`. The
 * browser still does one layout per frame, but React does nothing at all until
 * the pointer is released, when the final width is committed to state and
 * persisted.
 *
 * React state therefore holds the *committed* width only. It is what renders
 * on the server and after a reload; the CSS variable is what moves.
 */
export interface PanelResizeOptions {
  /** Initial committed width, e.g. restored from a cookie. */
  initialWidth: number;
  /** Width applied when the handle is double-clicked. */
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  edge: PanelEdge;
  /** CSS custom property the panel's `width` reads from. */
  cssVariable: string;
  /** Element carrying the custom property. */
  surfaceRef: React.RefObject<HTMLElement | null>;
  /** Cookie and localStorage key used to remember the width. */
  storageKey: string;
}

export interface PanelResizeHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export interface PanelResize {
  /** Committed width. Safe to render; does not change during a drag. */
  width: number;
  handlers: PanelResizeHandlers;
}

function persistWidth(storageKey: string, width: number) {
  try {
    document.cookie = `${storageKey}=${width}; path=/; max-age=31536000; SameSite=Lax`;
    localStorage.setItem(storageKey, String(width));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies, quota). The
    // remembered width is a convenience and must never break resizing.
  }
}

export function usePanelResize({
  initialWidth,
  defaultWidth,
  minWidth,
  maxWidth,
  edge,
  cssVariable,
  surfaceRef,
  storageKey,
}: PanelResizeOptions): PanelResize {
  const [width, setWidth] = useState(initialWidth);

  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    latestWidth: number;
    frame: number | null;
    handle: HTMLElement;
  } | null>(null);

  const writeWidth = useCallback(
    (next: number) => {
      surfaceRef.current?.style.setProperty(cssVariable, `${next}px`);
      // The rendered `aria-valuenow` only carries the committed width, so
      // during a drag the attribute is kept current here instead. Re-rendering
      // for it would put this component back in the per-frame path.
      dragRef.current?.handle.setAttribute("aria-valuenow", String(next));
    },
    [cssVariable, surfaceRef],
  );

  const cancelFrame = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.frame !== null && drag?.frame !== undefined) {
      cancelAnimationFrame(drag.frame);
      drag.frame = null;
    }
  }, []);

  // A drag interrupted by unmount would otherwise leave a scheduled frame
  // writing to a detached node.
  useEffect(() => cancelFrame, [cancelFrame]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startWidth: width,
        latestWidth: width,
        frame: null,
        handle: event.currentTarget,
      };
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      drag.latestWidth = resolvePanelResizeWidth({
        startWidth: drag.startWidth,
        startX: drag.startX,
        clientX: event.clientX,
        edge,
        min: minWidth,
        max: maxWidth,
      });

      // Several pointermove events can arrive within one frame, especially on
      // a 120Hz display. Painting more than once per frame is wasted layout.
      if (drag.frame !== null) return;
      drag.frame = requestAnimationFrame(() => {
        const current = dragRef.current;
        if (!current) return;
        current.frame = null;
        writeWidth(current.latestWidth);
      });
    },
    [edge, maxWidth, minWidth, writeWidth],
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      cancelFrame();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const finalWidth = drag.latestWidth;

      // The variable already holds this value mid-drag; writing it once more
      // covers the case where the last move was dropped with its frame. Done
      // before clearing the drag so the handle's aria value is written too.
      writeWidth(finalWidth);
      dragRef.current = null;

      setWidth(finalWidth);
      persistWidth(storageKey, finalWidth);
    },
    [cancelFrame, storageKey, writeWidth],
  );

  /**
   * Keyboard resizing, so the separator's tab stop leads somewhere.
   *
   * Committed immediately rather than coalesced: a key press is one discrete
   * change, and there is no stream of events here to keep out of React.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const next = resolvePanelResizeKey({
        key: event.key,
        shiftKey: event.shiftKey,
        width,
        edge,
        min: minWidth,
        max: maxWidth,
      });
      // An unhandled key, or one that would not move the edge, is left to the
      // browser rather than swallowed.
      if (next === null) return;

      event.preventDefault();
      writeWidth(next);
      setWidth(next);
      persistWidth(storageKey, next);
    },
    [edge, maxWidth, minWidth, storageKey, width, writeWidth],
  );

  const onDoubleClick = useCallback(() => {
    writeWidth(defaultWidth);
    setWidth(defaultWidth);
    persistWidth(storageKey, defaultWidth);
  }, [defaultWidth, storageKey, writeWidth]);

  return {
    width,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onDoubleClick,
      onKeyDown,
    },
  };
}
