// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorCanvasComments } from "./editor-canvas-comments";

/**
 * What dragging a comment pin may cost.
 *
 * The pin was the last gesture in the editor still following the pointer
 * through React state: one `setOptimisticPositions` per `pointermove`, which
 * the Canvas gesture rule forbids in as many words — the transient x/y belongs
 * in a ref, reaches the DOM through CSS variables, and React syncs once when
 * the gesture ends. `use-panel-resize` and `use-editor-canvas-transform` were
 * already built that way and say so in tests; this pins the third.
 *
 * Frames are driven by hand, so "one paint per burst" is a statement rather
 * than a race.
 */

vi.mock("@/server/storefront/storefront-comments.serverFn", () => ({
  updateStorefrontCommentThreadPosition: vi.fn(async () => ({
    success: true,
    message: "ok",
    data: null,
  })),
  createStorefrontCommentThread: vi.fn(),
  deleteStorefrontCommentThread: vi.fn(),
  resolveStorefrontCommentThread: vi.fn(),
  createStorefrontCommentReply: vi.fn(),
}));

import { updateStorefrontCommentThreadPosition } from "@/server/storefront/storefront-comments.serverFn";

let frames: Array<() => void> = [];

function flushFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame();
}

const thread = {
  id: "thread-1",
  storefrontId: "sf",
  themeId: "theme",
  templateId: "tpl",
  groupId: null,
  positionX: 20,
  positionY: 30,
  status: "open",
  author: { id: "u1", name: "Ada", image: null },
  comments: [{ id: "c1", body: "hi", author: { id: "u1", name: "Ada", image: null }, createdAt: "2026-09-19T00:00:00.000Z" }],
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
} as unknown as Parameters<typeof EditorCanvasComments>[0]["threads"][number];

function renderOverlay() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EditorCanvasComments
        storefrontId="sf"
        themeId="theme"
        templateId="tpl"
        threads={[thread]}
        isCommentMode
        activeThreadId={null}
        onActiveThreadChange={vi.fn()}
        draftPin={null}
        onDraftPinChange={vi.fn()}
        canvasScale={1}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  frames = [];
  vi.mocked(updateStorefrontCommentThreadPosition).mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Element.prototype.getBoundingClientRect = vi.fn(
    () =>
      ({ width: 1000, height: 1000, top: 0, left: 0, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dragging a comment pin", () => {
  it("paints through CSS variables without committing, and commits once on release", async () => {
    const { container } = renderOverlay();
    const pin = container.querySelector("button")!;
    const wrapper = container.querySelector<HTMLElement>("[data-comment-pin]")!;

    fireEvent.pointerDown(pin, { button: 0, pointerId: 1, clientX: 200, clientY: 300 });

    // A browser delivers these as separate tasks; one `act` around the loop
    // would let a per-move state setter hide behind React's batching.
    for (let step = 1; step <= 20; step += 1) {
      act(() => {
        fireEvent.pointerMove(pin, {
          pointerId: 1,
          clientX: 200 + step * 5,
          clientY: 300,
        });
      });
    }

    expect(
      updateStorefrontCommentThreadPosition,
      "a drag wrote to the server before the pointer was released",
    ).toHaveBeenCalledTimes(0);

    // Twenty moves, one frame in flight — and it paints where the pointer
    // ended up rather than where it was when the frame was asked for.
    expect(frames).toHaveLength(1);
    act(() => flushFrames());
    expect(wrapper.style.getPropertyValue("--morph-pin-x")).toBe("30%");

    // Awaited, because `mutate` hands the call to a microtask: asserting
    // synchronously would report zero whether or not the release committed.
    await act(async () => {
      fireEvent.pointerUp(pin, { pointerId: 1, clientX: 300, clientY: 300 });
    });

    expect(updateStorefrontCommentThreadPosition).toHaveBeenCalledTimes(1);
  });

  /**
   * A press that never crossed the movement threshold is a click on the pin,
   * not a move. Without this, "commits once" could be met by committing on
   * every release.
   */
  it("commits nothing when a press never became a drag", () => {
    const { container } = renderOverlay();
    const pin = container.querySelector("button")!;

    fireEvent.pointerDown(pin, { button: 0, pointerId: 1, clientX: 200, clientY: 300 });
    act(() => {
      fireEvent.pointerUp(pin, { pointerId: 1, clientX: 200, clientY: 300 });
    });

    expect(updateStorefrontCommentThreadPosition).toHaveBeenCalledTimes(0);
    expect(frames).toHaveLength(0);
  });
});
