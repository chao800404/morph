import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type PreviewMessageChannel } from "@/lib/storefront/editor/preview-protocol";
import { useLivePreviewMessageBridge } from "./use-live-preview-message-bridge";

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
