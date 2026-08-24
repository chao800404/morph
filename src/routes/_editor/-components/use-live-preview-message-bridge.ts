import {
  parsePreviewToEditorEvent,
  postEditorToPreviewMessage,
  type EditorToPreviewMessage,
  type PreviewMessageChannel,
} from "@/lib/storefront/editor/preview-protocol";
import { type RefObject, useCallback, useRef } from "react";

export function useStableLivePreviewSession(
  workspaceKey: string,
  previewSession: string,
) {
  const sessionRef = useRef({ workspaceKey, previewSession });
  if (
    sessionRef.current.workspaceKey !== workspaceKey ||
    !sessionRef.current.previewSession
  ) {
    sessionRef.current = { workspaceKey, previewSession };
  }
  return sessionRef.current.previewSession;
}

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
