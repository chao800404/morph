import {
  classifyPreviewDocument,
  expirePreviewDocumentCandidate,
  initialPreviewDocumentState,
  PREVIEW_DOCUMENT_CONFIRM_TIMEOUT_MS,
  PREVIEW_DOCUMENT_PROBE_BASE,
  type PreviewDocumentVerdict,
} from "@/lib/storefront/editor/preview-document-identity";
import {
  parsePreviewToEditorEnvelope,
  postEditorToPreviewMessage,
  type EditorToPreviewMessage,
  type PreviewMessageChannel,
  type PreviewToEditorMessage,
} from "@/lib/storefront/editor/preview-protocol";
import { type RefObject, useCallback, useEffect, useRef } from "react";

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

export type LivePreviewDocumentEvents = Readonly<{
  /** A ready from a frame on an older bridge that cannot be confirmed was not taken. */
  onUnconfirmableReady?: () => void;
}>;

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
 * A ready from a document the editor has not taken is not taken either: it
 * is a candidate, and the frame is asked who is active with the existing
 * ping (option A). The pong that names the candidate is the moment it
 * becomes the frame's document, so that event is read as the candidate's
 * ready — what every listener sees then is the ready, never the pong — and
 * the ready path runs exactly once, for a confirmed document. A candidate
 * not confirmed in time is dropped.
 *
 * `currentKey` names the frame on screen: a new key is a new iframe, and the
 * decision starts over for it.
 */
export function useLivePreviewMessageBridge(
  channel: PreviewMessageChannel,
  previewIframeRef: RefObject<HTMLIFrameElement | null>,
  currentKey: () => string | null = () => null,
  events: LivePreviewDocumentEvents = {},
) {
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const documentsRef = useRef(initialPreviewDocumentState(null));
  const decidedRef = useRef(new WeakMap<object, ReadEvent>());
  const loggedRef = useRef(new Set<string>());
  /** The candidate's own ready, kept for the moment it is confirmed. */
  const candidateReadyRef = useRef<{
    probe: number;
    message: PreviewToEditorMessage;
  } | null>(null);
  const nextProbeRef = useRef(PREVIEW_DOCUMENT_PROBE_BASE);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (expiryTimerRef.current !== null) clearTimeout(expiryTimerRef.current);
    },
    [],
  );

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
        const isReady = envelope.message.type === "morph:storefront-preview-ready";
        const step = classifyPreviewDocument(documentsRef.current, {
          previewKey,
          type: envelope.message.type,
          previewDocument: envelope.previewDocument,
          probe: isReady ? nextProbeRef.current + 1 : undefined,
          heartbeatId:
            envelope.message.type === "morph:storefront-preview-pong"
              ? envelope.message.heartbeatId
              : undefined,
        });
        documentsRef.current = step.state;
        const verdict = step.verdict;
        read = { message: envelope.message, document: verdict };
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
        if (verdict.kind === "candidate") {
          // Who is active in the frame? Only that document can answer.
          nextProbeRef.current = verdict.probe;
          candidateReadyRef.current = { probe: verdict.probe, message: envelope.message };
          if (expiryTimerRef.current !== null) clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = setTimeout(() => {
            expiryTimerRef.current = null;
            const before = documentsRef.current;
            documentsRef.current = expirePreviewDocumentCandidate(before, verdict.probe);
            if (documentsRef.current !== before) {
              candidateReadyRef.current = null;
              console.info(
                "[preview-document] a ready was not confirmed in time; not taken",
              );
            }
          }, PREVIEW_DOCUMENT_CONFIRM_TIMEOUT_MS);
          postEditorToPreviewMessage(
            previewIframeRef.current?.contentWindow,
            { type: "morph:storefront-preview-ping", heartbeatId: verdict.probe },
            channelRef.current,
          );
        }
        if (
          verdict.kind === "ready" &&
          envelope.message.type === "morph:storefront-preview-pong"
        ) {
          // Confirmed: this event is the candidate's ready.
          const candidate = candidateReadyRef.current;
          candidateReadyRef.current = null;
          if (expiryTimerRef.current !== null) {
            clearTimeout(expiryTimerRef.current);
            expiryTimerRef.current = null;
          }
          read = candidate ? { message: candidate.message, document: verdict } : null;
        }
        if (verdict.kind === "ready" && verdict.documentId === null) {
          logOnce(
            "ready-without-identity",
            "[preview-document] ready without identity; this frame's documents cannot be told apart",
          );
        }
        if (verdict.kind === "refused") {
          if (verdict.why === "not-active") candidateReadyRef.current = null;
          logOnce(
            `refused:${verdict.why}:${envelope.message.type}`,
            `[preview-document] not taken: ${envelope.message.type} | ${verdict.why}`,
          );
          if (verdict.why === "unconfirmable-ready") {
            eventsRef.current.onUnconfirmableReady?.();
          }
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
      return read &&
        read.document.kind !== "refused" &&
        read.document.kind !== "candidate"
        ? read.message
        : null;
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
