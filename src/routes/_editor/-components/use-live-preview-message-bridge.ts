import {
  classifyPreviewDocument,
  initialPreviewDocumentState,
  type PreviewDocumentVerdict,
} from "@/lib/storefront/editor/preview-document-identity";
import {
  parsePreviewToEditorEnvelope,
  postEditorToPreviewMessage,
  type EditorToPreviewMessage,
  type PreviewMessageChannel,
  type PreviewToEditorMessage,
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

type ReadEvent = Readonly<{
  message: PreviewToEditorMessage;
  document: PreviewDocumentVerdict;
}> | null;

/**
 * The editor's end of the preview channel.
 *
 * `parseMessage` takes a frame message only from the document the frame
 * shows (`classifyPreviewDocument`, C5): the origin, source, session and
 * schema checks are as they were, and on top of them the envelope's document
 * id is read once, here. An event is decided once, whichever listener reads
 * it first, so every listener on the window sees the same answer — the
 * decision for a ready changes which document is current, and a second
 * reading would take its own ready for a duplicate. `previewDocumentOf` is
 * that decision, for the ready handler.
 *
 * `currentKey` names the frame on screen: a new key is a new iframe, and the
 * decision starts over for it.
 */
export function useLivePreviewMessageBridge(
  channel: PreviewMessageChannel,
  previewIframeRef: RefObject<HTMLIFrameElement | null>,
  currentKey: () => string | null = () => null,
) {
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;
  const documentsRef = useRef(initialPreviewDocumentState(null));
  const decidedRef = useRef(new WeakMap<object, ReadEvent>());
  const loggedRef = useRef(new Set<string>());

  const postMessage = useCallback(
    (target: Window | null | undefined, message: EditorToPreviewMessage) => {
      postEditorToPreviewMessage(target, message, channelRef.current);
    },
    [],
  );

  const readEvent = useCallback(
    (event: MessageEvent<unknown>): ReadEvent => {
      const decided = decidedRef.current.get(event);
      if (decided !== undefined) return decided;
      const envelope = parsePreviewToEditorEnvelope(event, {
        expectedOrigin: channelRef.current.targetOrigin,
        expectedSource: previewIframeRef.current?.contentWindow ?? null,
        previewSession: channelRef.current.previewSession,
      });
      let read: ReadEvent = null;
      if (envelope) {
        const previewKey = currentKeyRef.current();
        const step = classifyPreviewDocument(documentsRef.current, {
          previewKey,
          type: envelope.message.type,
          previewDocument: envelope.previewDocument,
        });
        documentsRef.current = step.state;
        read = { message: envelope.message, document: step.verdict };
        // Said once per frame and reason: a refused message repeats (a pong
        // every few seconds), and its line would bury everything else.
        const logOnce = (reason: string, line: string) => {
          const id = `${previewKey ?? ""}|${reason}`;
          if (loggedRef.current.has(id)) return;
          loggedRef.current.add(id);
          console.info(line);
        };
        if (envelope.malformedDocument) {
          logOnce(
            "malformed",
            "[preview-document] a message named a malformed document id; read as none",
          );
        }
        if (step.verdict.kind === "ready" && step.verdict.documentId === null) {
          logOnce(
            "ready-without-identity",
            "[preview-document] ready without identity; this frame's documents cannot be told apart",
          );
        }
        if (step.verdict.kind === "refused") {
          logOnce(
            `refused:${step.verdict.why}:${envelope.message.type}`,
            `[preview-document] not taken: ${envelope.message.type} | ${step.verdict.why}`,
          );
        }
      }
      decidedRef.current.set(event, read);
      return read;
    },
    [previewIframeRef],
  );

  const parseMessage = useCallback(
    (event: MessageEvent<unknown>) => {
      const read = readEvent(event);
      return read && read.document.kind !== "refused" ? read.message : null;
    },
    [readEvent],
  );

  /** The document decision for an event `parseMessage` read; null when it took nothing. */
  const previewDocumentOf = useCallback(
    (event: MessageEvent<unknown>) => readEvent(event)?.document ?? null,
    [readEvent],
  );

  return { parseMessage, postMessage, previewDocumentOf };
}
