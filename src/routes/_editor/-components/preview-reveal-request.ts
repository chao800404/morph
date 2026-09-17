import type {
  EditorToPreviewMessage,
  PreviewSelectionRestoreTarget,
} from "@/lib/storefront/editor/preview-protocol";

/**
 * Whether a selection report is the answer to the request that asked the canvas
 * to move.
 *
 * Bringing the canvas to a selection is the one part of the round trip that
 * moves something the author is looking at, so it is the part that must not act
 * on the wrong answer. A flag saying "reveal the next one" cannot tell which
 * request it belongs to: the next report consumes it, and between asking and
 * hearing back the author may have clicked the canvas, clicked another row,
 * changed route, or had the preview reconnect underneath them.
 *
 * Binding it to the request instead makes every one of those a non-match rather
 * than a wrong move. Kept apart from the shell because these are rules worth
 * stating as tests, not a behaviour to reproduce by clicking quickly.
 */
export type PreviewRevealRequest = Readonly<{
  revision: number;
  reveal?: boolean;
  /** Absent on requests made before a preview key was known. */
  previewKey?: string | null;
}>;

export function shouldRevealPreviewSelection(args: {
  /** The outstanding request, or null once one has been answered. */
  request: PreviewRevealRequest | null;
  /** The revision the preview echoed back. */
  responseRevision: number;
  /** The preview the editor is framing now. */
  previewKey: string | null;
  /** Whether the report names the element the request asked for. */
  targetMatches: boolean;
}): boolean {
  const { request, responseRevision, previewKey, targetMatches } = args;
  if (!request || request.reveal !== true) return false;
  // At least the revision asked for, not exactly it. The preview takes the
  // higher of its own counter and the one it is sent, so an answer can come
  // back numbered above the request that provoked it. An earlier revision is an
  // answer to a request already superseded, and the target check below is what
  // keeps a newer, unrelated selection out.
  if (responseRevision < request.revision) return false;
  // A reconnect mints a new preview, and anything outstanding against the old
  // one describes a document that is no longer on screen.
  if (
    request.previewKey !== undefined &&
    request.previewKey !== null &&
    request.previewKey !== previewKey
  ) {
    return false;
  }
  return targetMatches;
}

/**
 * Whether a selection report has been overtaken and should be ignored.
 *
 * The editor numbers each selection it asks for, and a report numbered below
 * the latest one asked for describes a selection the author has already moved
 * on from. The rule is only sound while that number means *a new selection was
 * asked for*: a message that merely re-asserts the selection already in hand —
 * re-sending selection mode, say — must carry the current number rather than
 * take a new one, or it silently outranks a request still waiting to be
 * answered and the answer is discarded as stale.
 *
 * That is not hypothetical. It is what made the first tree click of every
 * session fail to move the canvas: that click is what turns selection mode on,
 * the mode sync ran immediately after it with a freshly minted number, and the
 * preview's answer to the click arrived one behind.
 */
export function isPreviewSelectionReportStale(args: {
  /** The revision the preview echoed back. */
  responseRevision: number;
  /** The highest revision the editor has asked for or seen. */
  latestSelectionRevision: number;
}): boolean {
  return args.responseRevision < args.latestSelectionRevision;
}

/**
 * Whether a report names the element a request asked for.
 *
 * A report can arrive enriched — with a source location or a DOM marker the
 * tree payload never carried — so the strongest *shared* identity is what
 * decides, not equality of every optional field. Two reports that share no
 * identity are about different elements, however similar they look.
 */
export function previewSelectionTargetMatches(
  left: PreviewSelectionRestoreTarget,
  right: PreviewSelectionRestoreTarget,
): boolean {
  if (
    left.sectionId !== right.sectionId ||
    Boolean(left.isSection) !== Boolean(right.isSection)
  ) {
    return false;
  }
  if (left.isSection) return true;

  const identityKeys = [
    "fieldPath",
    "nodeId",
    "elementKey",
    "fieldKey",
    "sourceLocation",
  ] as const;
  return identityKeys.some(
    (key) =>
      left[key] !== undefined &&
      right[key] !== undefined &&
      left[key] === right[key],
  );
}

/**
 * A route-section effect may be running for an older render while a newer
 * sidebar selection is already waiting for the preview. Sending that older
 * section-only message would replace the requested descendant with a wrapper.
 */
export function shouldSkipStalePreviewSectionSync(
  currentSectionId: string | null,
  pendingTarget: PreviewSelectionRestoreTarget | null,
): boolean {
  return Boolean(pendingTarget && pendingTarget.sectionId !== currentSectionId);
}

/**
 * The messages that ask the preview for a selection.
 *
 * Two of them, in order: turn selection mode on with the target to restore, then
 * ask for the selection's style. The style request only means something once a
 * target is being selected, which is why it is not sent on its own.
 */
export function createSelectionRestoreMessages(
  selectionMode: boolean,
  restoreTarget: PreviewSelectionRestoreTarget | null,
  selectionRevision?: number,
): EditorToPreviewMessage[] {
  const messages: EditorToPreviewMessage[] = [
    {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: selectionMode,
      restoreTarget: selectionMode ? (restoreTarget ?? undefined) : undefined,
      ...(selectionRevision === undefined ? {} : { selectionRevision }),
    },
  ];
  if (selectionMode && restoreTarget) {
    messages.push({
      type: "morph:storefront-preview-request-selection-style",
    });
  }
  return messages;
}
