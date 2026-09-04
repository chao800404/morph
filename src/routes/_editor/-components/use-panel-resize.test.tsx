import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelResize } from "./use-panel-resize";

const CSS_VARIABLE = "--editor-left-panel-width";
const STORAGE_KEY = "morph:test-panel-width";

let renderCount = 0;
let frames: Array<() => void> = [];

function flushFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

function Harness() {
  renderCount += 1;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { width, handlers } = usePanelResize({
    initialWidth: 300,
    defaultWidth: 260,
    minWidth: 220,
    maxWidth: 460,
    edge: "left",
    cssVariable: CSS_VARIABLE,
    surfaceRef,
    storageKey: STORAGE_KEY,
  });

  return (
    <div ref={surfaceRef} data-testid="surface">
      <div
        data-testid="handle"
        role="separator"
        aria-valuenow={width}
        {...handlers}
      />
      <span data-testid="committed">{width}</span>
    </div>
  );
}

beforeEach(() => {
  renderCount = 0;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // jsdom implements none of the pointer capture API.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePanelResize", () => {
  // The whole point of the hook: the editor shell must not re-render while the
  // pointer is moving, because that is what was starving the preview iframe.
  it("resizes by writing a CSS variable, with no re-render during the drag", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const surface = getByTestId("surface");
    const rendersAfterMount = renderCount;

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });
    flushFrames();

    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("360px");
    expect(renderCount).toBe(rendersAfterMount);
    // The committed width is unchanged until release.
    expect(getByTestId("committed").textContent).toBe("300");
  });

  it("coalesces several moves in one frame into a single write", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const surface = getByTestId("surface");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 520 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 540 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });

    // Three moves, one scheduled frame, and it paints the latest position.
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("360px");
  });

  it("commits and persists the width once, on release", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });
    flushFrames();
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 560 });

    expect(getByTestId("committed").textContent).toBe("360");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("360");
  });

  it("keeps the last position when the final move never got a frame", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const surface = getByTestId("surface");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });
    // Released before the scheduled frame ran.
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 560 });

    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("360px");
    expect(getByTestId("committed").textContent).toBe("360");
  });

  it("clamps to the panel's bounds while dragging", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const surface = getByTestId("surface");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 });
    flushFrames();
    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("460px");

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 });
    flushFrames();
    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("220px");
  });

  // Screen readers would otherwise be told the panel is still at its
  // pre-drag width, because the rendered attribute only carries committed state.
  it("keeps aria-valuenow current during the drag", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });
    flushFrames();

    expect(handle.getAttribute("aria-valuenow")).toBe("360");
  });

  it("ignores moves that did not start with a primary-button press", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const surface = getByTestId("surface");

    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 560 });

    expect(frames).toHaveLength(0);
    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("");
  });

  it("resets to the default width on double click", () => {
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const surface = getByTestId("surface");

    fireEvent.doubleClick(handle);

    expect(surface.style.getPropertyValue(CSS_VARIABLE)).toBe("260px");
    expect(getByTestId("committed").textContent).toBe("260");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("260");
  });
});
