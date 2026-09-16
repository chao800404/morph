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
  // At least the revision asked for, not exactly it. The preview keeps its own
  // counter and adopts the higher of the two, so a request made while its
  // counter is ahead — which it is right after a load, having already selected
  // something itself — is answered with that higher number. Requiring equality
  // refused the first selection of every session.
  //
  // An earlier revision is an answer to a request already superseded, and the
  // target check below is what keeps a newer, unrelated selection out.
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
