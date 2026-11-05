import { describe, expect, it } from "vitest";
import {
  acceptLivePreviewAccessBegin,
  isLivePreviewAccessEnded,
  LIVE_PREVIEW_ACCESS_ENDED_MESSAGE,
  isLivePreviewAccessFailure,
  LIVE_PREVIEW_ACCESS_BEGIN_MESSAGE,
  LIVE_PREVIEW_ACCESS_CODE_MESSAGE,
  LIVE_PREVIEW_ACCESS_FAILED_MESSAGE,
  LIVE_PREVIEW_ACCESS_FLOW_TTL_MS,
  livePreviewAccessBeginUrl,
  livePreviewAccessCodeMessage,
  newLivePreviewAccessFlowId,
  startLivePreviewAccessFlow,
} from "./live-preview-access";

const PREVIEW_ORIGIN =
  "https://pv-0123456789abcdef0123456789abcdef.preview.example.test";
const FRAME = { name: "the framed window" };
const OTHER_WINDOW = { name: "another window" };
const HASH = "a".repeat(64);
const expected = { origin: PREVIEW_ORIGIN, window: FRAME };

const begin = (flowId: string, overrides: Record<string, unknown> = {}) => ({
  data: {
    type: LIVE_PREVIEW_ACCESS_BEGIN_MESSAGE,
    flowId,
    binderHash: HASH,
    ...overrides,
  },
  origin: PREVIEW_ORIGIN,
  source: FRAME,
});

describe("the editor's side of the preview authorization flow", () => {
  it("asks for a tab's own flow in tab mode, and a frame's without a mode", () => {
    const args = {
      framedUrl: `${PREVIEW_ORIGIN}/products/shirt?previewSession=s1`,
      flowId: "f".repeat(32),
      editorOrigin: "https://app.example.test",
    };
    const tab = new URL(livePreviewAccessBeginUrl({ ...args, mode: "tab" }));
    expect(tab.searchParams.get("mode")).toBe("tab");
    expect(tab.searchParams.get("return")).toBe(
      "/products/shirt?previewSession=s1",
    );
    expect(
      new URL(livePreviewAccessBeginUrl(args)).searchParams.has("mode"),
    ).toBe(false);
  });

  it("frames the begin page on the preview's origin, returning to the preview's path and query", () => {
    const url = new URL(
      livePreviewAccessBeginUrl({
        framedUrl: `${PREVIEW_ORIGIN}/__morph-theme-preview__/?editorOrigin=x&previewSession=s1`,
        flowId: "f".repeat(32),
        editorOrigin: "https://app.example.test",
      }),
    );
    expect(url.origin).toBe(PREVIEW_ORIGIN);
    expect(url.pathname).toBe("/__morph/preview-auth/begin");
    expect(url.searchParams.get("flow")).toBe("f".repeat(32));
    expect(url.searchParams.get("return")).toBe(
      "/__morph-theme-preview__/?editorOrigin=x&previewSession=s1",
    );
    expect(url.searchParams.get("editorOrigin")).toBe(
      "https://app.example.test",
    );
  });

  it("makes a fresh 32-hex flow id per attempt", () => {
    const a = newLivePreviewAccessFlowId();
    const b = newLivePreviewAccessFlowId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("answers the begin page of the flow it is waiting on, once", () => {
    const flow = startLivePreviewAccessFlow(1000);

    expect(
      acceptLivePreviewAccessBegin(flow, begin(flow.flowId), expected, 1500),
    ).toBe(HASH);
    // Answered: a second begin, even a perfect copy, gets nothing.
    expect(
      acceptLivePreviewAccessBegin(flow, begin(flow.flowId), expected, 1600),
    ).toBeNull();
  });

  it("issues nothing for a Theme document's forged begin after the flow ended", () => {
    const flow = startLivePreviewAccessFlow(1000);
    acceptLivePreviewAccessBegin(flow, begin(flow.flowId), expected, 1500);

    // The Theme now runs on the same origin, in the same window.
    expect(
      acceptLivePreviewAccessBegin(
        flow,
        begin(flow.flowId, { binderHash: "b".repeat(64) }),
        expected,
        2000,
      ),
    ).toBeNull();
  });

  it.each([
    [
      "another flow",
      (flowId: string) =>
        begin(
          flowId.replace(/./, "0") === flowId ? "1".repeat(32) : "0".repeat(32),
        ),
    ],
    [
      "another window",
      (flowId: string) => ({ ...begin(flowId), source: OTHER_WINDOW }),
    ],
    [
      "another origin",
      (flowId: string) => ({ ...begin(flowId), origin: "https://evil.test" }),
    ],
    [
      "another message type",
      (flowId: string) => begin(flowId, { type: "morph:other" }),
    ],
    [
      "a malformed binder hash",
      (flowId: string) => begin(flowId, { binderHash: "nope" }),
    ],
  ])("ignores a begin from %s and keeps waiting", (_name, make) => {
    const flow = startLivePreviewAccessFlow(1000);

    expect(
      acceptLivePreviewAccessBegin(flow, make(flow.flowId), expected, 1500),
    ).toBeNull();
    expect(flow.ended).toBe(false);
    expect(
      acceptLivePreviewAccessBegin(flow, begin(flow.flowId), expected, 1600),
    ).toBe(HASH);
  });

  it("ends a flow that is older than a code lives, without answering", () => {
    const flow = startLivePreviewAccessFlow(1000);

    expect(
      acceptLivePreviewAccessBegin(
        flow,
        begin(flow.flowId),
        expected,
        1000 + LIVE_PREVIEW_ACCESS_FLOW_TTL_MS,
      ),
    ).toBeNull();
    expect(flow.ended).toBe(true);
  });

  it("answers nothing while the frame has no window", () => {
    const flow = startLivePreviewAccessFlow(1000);

    expect(
      acceptLivePreviewAccessBegin(
        flow,
        begin(flow.flowId),
        { origin: PREVIEW_ORIGIN, window: null },
        1500,
      ),
    ).toBeNull();
  });

  it("recognises only its own frame's failure for its own flow", () => {
    const flow = startLivePreviewAccessFlow(1000);
    const failure = {
      data: { type: LIVE_PREVIEW_ACCESS_FAILED_MESSAGE, flowId: flow.flowId },
      origin: PREVIEW_ORIGIN,
      source: FRAME,
    };

    expect(isLivePreviewAccessFailure(flow, failure, expected)).toBe(true);
    expect(
      isLivePreviewAccessFailure(
        flow,
        { ...failure, source: OTHER_WINDOW },
        expected,
      ),
    ).toBe(false);
    expect(
      isLivePreviewAccessFailure(
        flow,
        { ...failure, data: { ...failure.data, flowId: "0".repeat(32) } },
        expected,
      ),
    ).toBe(false);
  });

  it("hands the code over in a message naming the flow", () => {
    const flow = startLivePreviewAccessFlow(1000);

    expect(livePreviewAccessCodeMessage(flow, "c".repeat(64))).toEqual({
      type: LIVE_PREVIEW_ACCESS_CODE_MESSAGE,
      flowId: flow.flowId,
      code: "c".repeat(64),
    });
  });
});

describe("a framed preview refused for want of access", () => {
  it("is recognised only from the framed window, on the preview's origin", () => {
    const ended = {
      data: {
        type: LIVE_PREVIEW_ACCESS_ENDED_MESSAGE,
        reason: "SESSION_ENDED",
      },
      origin: PREVIEW_ORIGIN,
      source: FRAME,
    };
    expect(isLivePreviewAccessEnded(ended, expected)).toBe(true);
    expect(
      isLivePreviewAccessEnded({ ...ended, source: OTHER_WINDOW }, expected),
    ).toBe(false);
    expect(
      isLivePreviewAccessEnded(
        { ...ended, origin: "https://evil.test" },
        expected,
      ),
    ).toBe(false);
  });
});
