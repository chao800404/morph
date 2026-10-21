import { act } from "@testing-library/react";
import { onTestFinished, vi } from "vitest";
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
 *
 * A test can also play a current bridge (`modelCurrentBridge`): every
 * document in the frame names itself on every message, and the document
 * active in the frame answers each ping the editor posts to it. That is what
 * the editor needs before it takes a ready as a new document (C5, option A):
 * a page that reloads itself in the same frame is played by
 * `reloadFrameDocument` before its ready.
 */

export type PreviewFrameAddress = Readonly<{ origin: string; session: string }>;

const READY = "morph:storefront-preview-ready";
const PING = "morph:storefront-preview-ping";
const PONG = "morph:storefront-preview-pong";

const frameWindow = () =>
  document.querySelector("iframe")?.contentWindow ?? null;

/**
 * A current bridge in one frame window: the document active in it, and how
 * many of the editor's posts it has read for pings.
 */
type CurrentBridge = { active: string; read: number };
const bridges = new WeakMap<Window, CurrentBridge>();
/** On for the rest of the test that called `modelCurrentBridge`. */
let currentBridges = false;
let documents = 0;
const nextDocument = () => {
  documents += 1;
  return documents.toString(16).padStart(32, "0");
};

/** The bridge in the frame on screen, made on its first message; null when not modelled. */
function bridgeOf(frame: Window | null): CurrentBridge | null {
  if (!frame || !currentBridges) return null;
  let bridge = bridges.get(frame);
  if (!bridge) {
    bridge = { active: nextDocument(), read: 0 };
    bridges.set(frame, bridge);
  }
  return bridge;
}

/**
 * For the rest of this test, every frame runs a current bridge: each
 * document names itself (`previewDocument`) on every message, and the active
 * one answers each ping the editor posts to its frame with the matching
 * pong. Through the real message path only.
 */
export function modelCurrentBridge() {
  currentBridges = true;
  onTestFinished(() => {
    currentBridges = false;
  });
}

/**
 * The page in the frame on screen reloads itself: from now on a new
 * document is active in it, and answers its pings. Nothing unless a current
 * bridge is modelled.
 */
export function reloadFrameDocument() {
  const bridge = bridgeOf(frameWindow());
  if (bridge) bridge.active = nextDocument();
}

/** What the frame's poster puts on a message: the active document's id, when modelled. */
export function frameEnvelope<T extends Record<string, unknown>>(data: T): T {
  const bridge = bridgeOf(frameWindow());
  return bridge ? { ...data, previewDocument: bridge.active } : data;
}

/**
 * The active document answers each ping the editor has posted to its frame
 * and it has not answered yet: same id, naming itself. `committed: false`
 * delivers the answers outside act, as a test that delivers its own
 * messages uncommitted needs. Nothing unless a current bridge is modelled.
 */
export function answerFramePings(
  address: PreviewFrameAddress,
  options: Readonly<{ committed?: boolean }> = {},
) {
  const frame = frameWindow();
  const bridge = bridgeOf(frame);
  if (!bridge) return;
  const calls = vi.mocked(postEditorToPreviewMessage).mock.calls;
  const pings: number[] = [];
  for (; bridge.read < calls.length; bridge.read += 1) {
    const [target, message] = calls[bridge.read]!;
    const posted = message as { type?: string; heartbeatId?: number };
    if (target === frame && posted.type === PING && typeof posted.heartbeatId === "number") {
      pings.push(posted.heartbeatId);
    }
  }
  for (const heartbeatId of pings) {
    const deliver = () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: PONG,
            heartbeatId,
            previewSession: address.session,
            previewDocument: bridge.active,
          },
          origin: address.origin,
          source: frame,
        }),
      );
    if (options.committed === false) deliver();
    else act(deliver);
  }
}

function send(address: PreviewFrameAddress, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: frameEnvelope({ ...data, previewSession: address.session }),
        origin: address.origin,
        source: frameWindow(),
      }),
    );
  });
  answerFramePings(address);
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
 * `answerReady` is false (a test of what waits for that answer). With a
 * current bridge modelled, `after` first answers the pings the editor
 * posted.
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
      answerFramePings(address);
      if (data.type === READY && options.answerReady !== false) {
        answerLatestRouteRequest(address);
      }
    },
  };
}
