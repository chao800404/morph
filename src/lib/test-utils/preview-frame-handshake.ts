import { act } from "@testing-library/react";
import { vi } from "vitest";
import { postEditorToPreviewMessage } from "@/lib/storefront/editor/preview-protocol";

/**
 * The editor shell takes a selection or an edit from its preview frame only
 * while it knows the frame shows the editor's page: the frame said it is
 * ready and then named, in that ready round, the page it is on. A live frame
 * does both as soon as its bridge starts. Shell tests whose subject is
 * something else play that part with this, so their frame is one the editor
 * listens to.
 *
 * The test file must mock `postEditorToPreviewMessage` (they all do: jsdom
 * frames are same-origin and the real transport refuses them); the editor's
 * route requests are read from that mock's calls.
 *
 * The answer names the route the frame was sent, as a frame on the editor's
 * page does. What a frame that names no page proves, and when, is the
 * subject of `visual-editor-shell-frame-no-router-writes.test.tsx` and
 * `visual-editor-shell-frame-mismatch-writes.test.tsx`, which send their own
 * messages.
 */

export type PreviewFrameAddress = Readonly<{ origin: string; session: string }>;

const READY = "morph:storefront-preview-ready";

const frameWindow = () =>
  document.querySelector("iframe")?.contentWindow ?? null;

function send(address: PreviewFrameAddress, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...data, previewSession: address.session },
        origin: address.origin,
        source: frameWindow(),
      }),
    );
  });
}

/** The editor's latest route request, as posted. */
function latestRouteRequest() {
  const calls = vi.mocked(postEditorToPreviewMessage).mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const message = calls[index]?.[1] as
      | { type?: string; routePath?: string | null; routeRequestId?: number }
      | undefined;
    if (message?.type === "morph:storefront-preview-set-route") return message;
  }
  return null;
}

/**
 * What a current frame says it can do on ready: it reads the section an
 * `update-selection-field` post names. A frame built before that says
 * nothing, and the editor then sends it no such post.
 */
export const LIVE_FRAME_CAPABILITIES: readonly string[] = [
  "selection-field-section",
];

/** The frame says it is ready, naming what it can do. */
export function sendFrameReady(
  address: PreviewFrameAddress,
  capabilities: readonly string[] = LIVE_FRAME_CAPABILITIES,
) {
  send(address, {
    type: READY,
    ...(capabilities.length > 0 ? { capabilities: [...capabilities] } : {}),
  });
}

/** Answers the editor's latest route request from the page it names. */
export function answerLatestRouteRequest(address: PreviewFrameAddress) {
  const request = latestRouteRequest();
  if (!request || typeof request.routeRequestId !== "number") return;
  send(address, {
    type: "morph:storefront-preview-route-applied",
    routeRequestId: request.routeRequestId,
    routePath: request.routePath ?? "/",
  });
}

/**
 * Hooks for a test file's own `fromPreview`, plus `up()` for a test that
 * builds a message from what the editor has sent before sending it.
 *
 * Before the first message from a frame, the frame names the page it is on,
 * as a live one does in every report. After a ready the test sends itself,
 * the frame answers the route request that ready brings, unless
 * `answerReady` is false (a test of what waits for that answer).
 */
export function createLiveFrame(
  address: PreviewFrameAddress,
  options: Readonly<{
    answerReady?: boolean;
    /** What the frame's own ready (`ready()`) names; a frame built before these says none. */
    capabilities?: readonly string[];
  }> = {},
) {
  const up = new WeakSet<Window>();
  // A frame names its page in every structure report. Named this way, before
  // any ready, nothing else the editor sends a ready frame (its route, the
  // Theme's files and their style revision) changes under the test.
  const bringUp = () => {
    const frame = frameWindow();
    if (!frame || up.has(frame)) return;
    up.add(frame);
    send(address, {
      type: "morph:storefront-preview-structure",
      nodes: [],
      routePath: latestRouteRequest()?.routePath ?? "/",
    });
  };
  return {
    up: bringUp,
    /**
     * The whole of what a live frame does on coming up: ready, naming what
     * it can do; a structure report naming the page it is on; and its answer
     * to the route request that ready brought.
     */
    ready() {
      const frame = frameWindow();
      if (frame) up.add(frame);
      sendFrameReady(address, options.capabilities ?? LIVE_FRAME_CAPABILITIES);
      send(address, {
        type: "morph:storefront-preview-structure",
        nodes: [],
        routePath: latestRouteRequest()?.routePath ?? "/",
      });
      answerLatestRouteRequest(address);
    },
    before(data: Readonly<{ type?: unknown }>) {
      if (data.type === READY) {
        const frame = frameWindow();
        if (frame) up.add(frame);
        return;
      }
      bringUp();
    },
    after(data: Readonly<{ type?: unknown }>) {
      if (data.type === READY && options.answerReady !== false) {
        answerLatestRouteRequest(address);
      }
    },
  };
}
