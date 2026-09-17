import { useCallback, useMemo, useRef } from "react";
import {
  createSelectionRestoreMessages,
  isPreviewSelectionReportStale,
  previewSelectionTargetMatches,
  shouldRevealPreviewSelection,
  shouldSkipStalePreviewSectionSync,
} from "./preview-reveal-request";
import type {
  EditorToPreviewMessage,
  PreviewSelectionRestoreTarget,
  PreviewToEditorMessage,
} from "@/lib/storefront/editor/preview-protocol";
import { isLatestStyleRevision } from "./style-revision";

/**
 * The editor's side of the selection round trip: which request is outstanding,
 * which reply answers it, and which reply may move the canvas.
 *
 * The rules themselves already live in `preview-reveal-request`, stated as tests.
 * What was left here — four refs scattered through a 7,000-line component, each
 * written from a different callback — is the *bookkeeping* those rules read:
 *
 * - `revision`: the number a new selection intent takes. Only a new intent
 *   mints one; a re-assertion carries the number already in hand, or it
 *   outranks the request the author just made and its answer is discarded as
 *   stale. That is the distinction `askForSelection` and `reassertMode` are
 *   named for, because it is the one that has been got wrong.
 * - `pending`: the request awaiting an answer, cleared only by an answer that
 *   was accepted.
 * - `reveal`: the outstanding centring request, consumed only by the reply
 *   that answers it.
 * - `last`: the target the editor believes is current.
 *
 * **`last` is written here and nowhere else.** The shell has its own
 * representation of the current selection — the descriptor it renders — and the
 * two are not duplicates: a restore target is what a request names, a descriptor
 * is what the Inspector draws. Two writers for one of them is how they drift.
 *
 * Nothing here knows about the canvas. Whether a report *should* reveal is this
 * hook's answer; moving the canvas is the caller's, from the rect the report
 * carried.
 */

type PendingSelection = Readonly<{
  target: PreviewSelectionRestoreTarget;
  revision: number;
}>;

type RevealRequest = Readonly<{
  target: PreviewSelectionRestoreTarget;
  revision: number;
  previewKey: string | null;
}>;

export type PreviewSelectionReport = Extract<
  PreviewToEditorMessage,
  { type: "morph:storefront-preview-select-section" }
>;

export type PreviewSelectionAcceptance =
  | { accepted: false }
  | {
      accepted: true;
      /** What the report named, for the caller to turn into a descriptor. */
      target: PreviewSelectionRestoreTarget;
      /** Whether this report is the answer that asked the canvas to move. */
      reveal: boolean;
    };

export type PreviewSelectionPorts = Readonly<{
  post: (message: EditorToPreviewMessage) => void;
  /** The preview currently framed; a reconnect mints a new one. */
  previewKey: string | null;
  /** Highest style revision the preview has acknowledged. */
  latestStyleRevision: () => number;
}>;

export function usePreviewSelection({
  post,
  previewKey,
  latestStyleRevision,
}: PreviewSelectionPorts) {
  const revisionRef = useRef(0);
  const lastRef = useRef<PreviewSelectionRestoreTarget | null>(null);
  const pendingRef = useRef<PendingSelection | null>(null);
  const revealRef = useRef<RevealRequest | null>(null);

  const nextRevision = useCallback(() => {
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);

  /**
   * A new selection intent. Mints a revision and asks the preview for it.
   *
   * `reveal` arms the canvas move, and belongs only to a selection made
   * somewhere other than the canvas: clicking the canvas means the author is
   * already looking at what they clicked.
   */
  const askForSelection = useCallback(
    (args: { target: PreviewSelectionRestoreTarget; reveal: boolean }) => {
      const revision = nextRevision();
      pendingRef.current = { target: args.target, revision };
      // Armed only when asked, and never cleared here: a section click requests
      // no reveal, but it does not cancel one that is still outstanding either.
      // Only the reply that answers the outstanding request consumes it.
      if (args.reveal) {
        revealRef.current = { target: args.target, revision, previewKey };
      }
      lastRef.current = args.target;
      for (const message of createSelectionRestoreMessages(
        true,
        args.target,
        revision,
      )) {
        post(message);
      }
    },
    [nextRevision, post, previewKey],
  );

  /**
   * Re-asserts the selection already in hand. Mints nothing.
   *
   * Turning selection mode on is not a request for a different selection, so it
   * carries the revision in hand. Minting here numbered the message above the
   * request the author had just made, and the answer to that request then failed
   * the staleness check and was thrown away.
   */
  const reassertMode = useCallback(
    (args: { enabled: boolean }) => {
      post({
        type: "morph:storefront-preview-set-selection-mode",
        enabled: args.enabled,
        selectionRevision: revisionRef.current,
        restoreTarget: args.enabled
          ? (lastRef.current ?? undefined)
          : undefined,
      });
    },
    [post],
  );

  /** Asks again for the selection in hand, as a new request. Mints. */
  const askForCurrent = useCallback(
    (args: { enabled: boolean }) => {
      const revision = nextRevision();
      for (const message of createSelectionRestoreMessages(
        args.enabled,
        lastRef.current,
        revision,
      )) {
        post(message);
      }
    },
    [nextRevision, post],
  );

  /**
   * Wrapper-only sync when the URL's section changes, which is not a selection
   * request: it keeps the preview showing the section the sidebar moved to.
   */
  const syncSection = useCallback(
    (args: { sectionId: string | null; enabled: boolean }) => {
      const pending = pendingRef.current;
      // An effect for an older render must not replace a descendant that is
      // still waiting to be selected with a wrapper.
      if (
        shouldSkipStalePreviewSectionSync(
          args.sectionId,
          pending?.target ?? null,
        )
      ) {
        return;
      }
      const restoreTarget =
        args.enabled && lastRef.current?.sectionId === args.sectionId
          ? lastRef.current
          : undefined;
      post({
        type: "morph:storefront-preview-set-section",
        sectionId: args.sectionId,
        ...(restoreTarget
          ? {
              restoreTarget,
              selectionRevision: revisionRef.current,
            }
          : {}),
      });
    },
    [post],
  );

  /**
   * A report from the preview, judged.
   *
   * Every check here is about whether this reply answers the request that asked:
   * the style revision it belongs to, whether the author has moved on, and
   * whether it names the element that was asked for. Past them, the reply is the
   * answer, and the high-water mark it sets is the other half of the staleness
   * rule — the two have to move together.
   */
  const acceptReport = useCallback(
    (message: PreviewSelectionReport): PreviewSelectionAcceptance => {
      if (
        !isLatestStyleRevision(message.styleRevision, latestStyleRevision())
      ) {
        return { accepted: false };
      }

      const responseRevision = message.selectionRevision ?? 0;
      if (
        isPreviewSelectionReportStale({
          responseRevision,
          latestSelectionRevision: revisionRef.current,
        })
      ) {
        return { accepted: false };
      }

      const target: PreviewSelectionRestoreTarget = {
        sectionId: message.sectionId,
        sourceLocation: message.sourceLocation ?? undefined,
        nodeId: message.nodeId ?? undefined,
        fieldPath: message.fieldPath ?? undefined,
        elementKey: message.elementKey ?? undefined,
        fieldKey: message.fieldKey ?? message.field ?? undefined,
        isSection: message.isSection,
      };

      const pending = pendingRef.current;
      // A route/context sync can make the iframe briefly report its section
      // element after the sidebar has already requested a descendant. Keep that
      // older response out of both inspectors. A newer canvas click is allowed
      // through because its iframe revision is greater.
      if (
        pending &&
        responseRevision <= pending.revision &&
        !previewSelectionTargetMatches(pending.target, target)
      ) {
        return { accepted: false };
      }

      revisionRef.current = Math.max(revisionRef.current, responseRevision);

      const revealRequest = revealRef.current;
      const reveal = shouldRevealPreviewSelection({
        request: revealRequest && { ...revealRequest, reveal: true },
        responseRevision,
        previewKey,
        targetMatches: revealRequest
          ? previewSelectionTargetMatches(revealRequest.target, target)
          : false,
      });
      // Answered, or overtaken by a selection made since. A report that is
      // neither — the preview restoring its own selection after a reload —
      // leaves the request standing for the reply still on its way.
      if (
        reveal ||
        (revealRequest && responseRevision > revealRequest.revision)
      ) {
        revealRef.current = null;
      }
      pendingRef.current = null;
      lastRef.current = target;

      return { accepted: true, target, reveal };
    },
    [latestStyleRevision, previewKey],
  );

  /**
   * The remembered selection is no longer there — the element or section it
   * named was deleted.
   *
   * `reveal` is left alone deliberately, matching what the deletion paths did
   * before this was gathered up.
   */
  const forget = useCallback(() => {
    lastRef.current = null;
    pendingRef.current = null;
  }, []);

  /** The context that owned the selection is gone. */
  const clear = useCallback(() => {
    lastRef.current = null;
    pendingRef.current = null;
    revealRef.current = null;
  }, []);

  /**
   * Leaving Design: stop the preview selecting, and start a new revision.
   *
   * `last` survives on purpose. Coming back to Design restores the selection
   * the author had, which is what `askForCurrent` asks for.
   */
  const leaveSelectionMode = useCallback(() => {
    pendingRef.current = null;
    revealRef.current = null;
    post({
      type: "morph:storefront-preview-set-selection-mode",
      enabled: false,
      selectionRevision: nextRevision(),
    });
  }, [nextRevision, post]);

  const currentTarget = useCallback(() => lastRef.current, []);

  // Memoized so callers can depend on the object itself. A fresh one each
  // render would re-register every effect that reads it — including the one
  // holding the preview's message listener.
  return useMemo(
    () => ({
      askForSelection,
      reassertMode,
      askForCurrent,
      syncSection,
      acceptReport,
      forget,
      clear,
      leaveSelectionMode,
      currentTarget,
    }),
    [
      acceptReport,
      askForCurrent,
      askForSelection,
      clear,
      currentTarget,
      forget,
      leaveSelectionMode,
      reassertMode,
      syncSection,
    ],
  );
}
