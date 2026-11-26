import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type PreviewMessageChannel } from "@/lib/storefront/editor/preview-protocol";
import {
  useLivePreviewMessageBridge,
  useStableLivePreviewSession,
} from "./use-live-preview-message-bridge";

const firstChannel: PreviewMessageChannel = {
  targetOrigin: "https://editor.example.com",
  previewSession: "11111111-1111-4111-8111-111111111111",
};
const nextChannel: PreviewMessageChannel = {
  targetOrigin: "https://editor.example.com",
  previewSession: "22222222-2222-4222-8222-222222222222",
};

describe("useLivePreviewMessageBridge", () => {
  it("uses the latest session after the preview channel rotates", () => {
    const previewWindow = {} as Window;
    const iframeRef = {
      current: { contentWindow: previewWindow } as HTMLIFrameElement,
    };
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const { result, rerender } = renderHook(
      ({ channel }) => useLivePreviewMessageBridge(channel, iframeRef),
      { initialProps: { channel: firstChannel } },
    );
    const stablePostMessage = result.current.postMessage;

    rerender({ channel: nextChannel });
    expect(result.current.postMessage).toBe(stablePostMessage);

    result.current.postMessage(target, {
      type: "morph:storefront-preview-update-theme-files",
      files: [{ path: "sections/Hero.tsx", content: "export default null" }],
      styleRevision: 1,
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ previewSession: nextChannel.previewSession }),
      nextChannel.targetOrigin,
    );

    expect(
      result.current.parseMessage({
        origin: nextChannel.targetOrigin,
        source: previewWindow,
        data: {
          type: "morph:storefront-preview-ready",
          previewSession: nextChannel.previewSession,
        },
      } as MessageEvent<unknown>),
    ).toEqual({ type: "morph:storefront-preview-ready" });
  });
});

describe("a ready that carries a channel bootstrap nonce", () => {
  const NONCE = "b".repeat(32);
  const DOC_A = "a".repeat(32);
  const DOC_B = "c".repeat(32);

  function setup(accept: ((nonce: string) => boolean) | undefined) {
    const previewWindow = { postMessage: vi.fn() } as unknown as Window;
    const iframeRef = {
      current: { contentWindow: previewWindow } as HTMLIFrameElement,
    };
    const rendered = renderHook(() =>
      useLivePreviewMessageBridge(
        firstChannel,
        iframeRef,
        () => "frame-1",
        accept ? { acceptBootstrapNonce: accept } : {},
      ),
    );
    const ready = (extra: Record<string, unknown>) =>
      ({
        origin: firstChannel.targetOrigin,
        source: previewWindow,
        data: {
          type: "morph:storefront-preview-ready",
          previewSession: firstChannel.previewSession,
          ...extra,
        },
      }) as MessageEvent<unknown>;
    return { ...rendered, ready, previewWindow };
  }

  it("is taken when the editor offered that nonce on this frame", () => {
    const accept = vi.fn(() => true);
    const { result, ready } = setup(accept);
    expect(
      result.current.parseMessage(ready({ bootstrapNonce: NONCE })),
    ).toEqual({
      type: "morph:storefront-preview-ready",
      bootstrapNonce: NONCE,
    });
    expect(accept).toHaveBeenCalledWith(NONCE);
  });

  it("is not taken when the editor made no such offer, or it expired", () => {
    const { result, ready } = setup(() => false);
    expect(
      result.current.parseMessage(ready({ bootstrapNonce: NONCE })),
    ).toBeNull();
  });

  it("is not taken when the editor can accept none", () => {
    const { result, ready } = setup(undefined);
    expect(
      result.current.parseMessage(ready({ bootstrapNonce: NONCE })),
    ).toBeNull();
  });

  it("is not taken with a nonce of the wrong shape, and does not ask the editor", () => {
    const accept = vi.fn(() => true);
    const { result, ready } = setup(accept);
    expect(
      result.current.parseMessage(ready({ bootstrapNonce: "short" })),
    ).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });

  it("still goes through the document confirmation: an unconfirmed document is a candidate", () => {
    const { result, ready, previewWindow } = setup(() => true);
    // A first, id-less ready makes a verified document current later.
    expect(
      result.current.parseMessage(
        ready({ previewDocument: DOC_A, bootstrapNonce: NONCE }),
      ),
    ).toBeNull();
    expect(
      (previewWindow as unknown as { postMessage: ReturnType<typeof vi.fn> })
        .postMessage,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ type: "morph:storefront-preview-ping" }),
      firstChannel.targetOrigin,
    );
    // The ping is answered by the active document: B, not the candidate.
    expect(
      result.current.parseMessage({
        origin: firstChannel.targetOrigin,
        source: previewWindow,
        data: {
          type: "morph:storefront-preview-pong",
          previewSession: firstChannel.previewSession,
          previewDocument: DOC_B,
          heartbeatId: 2 ** 40 + 1,
        },
      } as MessageEvent<unknown>),
    ).toBeNull();
  });

  it("is a ready without one, as before, when the document had its channel in its URL", () => {
    const accept = vi.fn(() => false);
    const { result, ready } = setup(accept);
    expect(result.current.parseMessage(ready({}))).toEqual({
      type: "morph:storefront-preview-ready",
    });
    expect(accept).not.toHaveBeenCalled();
  });
});

describe("useStableLivePreviewSession", () => {
  it("keeps the iframe session stable across background context refetches", () => {
    const { result, rerender } = renderHook(
      ({
        workspaceKey,
        previewSession,
      }: {
        workspaceKey: string;
        previewSession: string;
      }) => useStableLivePreviewSession(workspaceKey, previewSession),
      {
        initialProps: {
          workspaceKey: "store-1:theme-1",
          previewSession: firstChannel.previewSession,
        },
      },
    );

    rerender({
      workspaceKey: "store-1:theme-1",
      previewSession: nextChannel.previewSession,
    });
    expect(result.current).toBe(firstChannel.previewSession);

    rerender({
      workspaceKey: "store-1:theme-2",
      previewSession: nextChannel.previewSession,
    });
    expect(result.current).toBe(nextChannel.previewSession);
  });
});
