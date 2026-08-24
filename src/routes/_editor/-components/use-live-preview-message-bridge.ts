import {
  parsePreviewToEditorEvent,
  postEditorToPreviewMessage,
  type EditorToPreviewMessage,
  type PreviewMessageChannel,
} from "@/lib/storefront/editor/preview-protocol";
import { type RefObject, useCallback, useRef } from "react";

export function useLivePreviewMessageBridge(
  channel: PreviewMessageChannel,
  previewIframeRef: RefObject<HTMLIFrameElement | null>,
) {
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const postMessage = useCallback(
    (target: Window | null | undefined, message: EditorToPreviewMessage) => {
      postEditorToPreviewMessage(target, message, channelRef.current);
    },
    [],
  );

  const parseMessage = useCallback(
    (event: MessageEvent<unknown>) =>
      parsePreviewToEditorEvent(event, {
        expectedOrigin: channelRef.current.targetOrigin,
        expectedSource: previewIframeRef.current?.contentWindow ?? null,
        previewSession: channelRef.current.previewSession,
      }),
    [previewIframeRef],
  );

  return { parseMessage, postMessage };
}
