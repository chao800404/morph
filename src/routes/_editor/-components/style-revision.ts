export function isLatestStyleRevision(
  revision: number,
  latestRequested: number,
): boolean {
  return Number.isSafeInteger(revision) && revision === latestRequested;
}

export function shouldAcceptStyleAck(
  revision: number,
  latestRequested: number,
): boolean {
  return isLatestStyleRevision(revision, latestRequested);
}

export function shouldRevealPreviewForStyleAck(
  revision: number,
  latestRequested: number,
  initialPreviewRevision: number | null,
): boolean {
  return (
    initialPreviewRevision !== null &&
    revision >= initialPreviewRevision &&
    shouldAcceptStyleAck(revision, latestRequested)
  );
}

export function shouldConfirmPreviewStyleRevision(input: {
  confirmationPreviewKey: string;
  currentPreviewKey: string | null;
  initialPreviewKey: string | null;
  revision: number;
  latestRequested: number;
  initialPreviewRevision: number | null;
}): boolean {
  return (
    input.confirmationPreviewKey === input.currentPreviewKey &&
    input.confirmationPreviewKey === input.initialPreviewKey &&
    shouldRevealPreviewForStyleAck(
      input.revision,
      input.latestRequested,
      input.initialPreviewRevision,
    )
  );
}

export function isPreviewHandshakePending(
  previewKey: string | null,
  loadedPreviewKey: string | null,
  failedPreviewKey: string | null,
): boolean {
  return (
    previewKey !== null &&
    loadedPreviewKey !== previewKey &&
    failedPreviewKey !== previewKey
  );
}

/**
 * Whether a preview frame is still owed its first sign of life.
 *
 * A frame that has an address but has never announced itself is the one state
 * nothing else watches: the confirmation timeout only starts once the frame is
 * ready, and the heartbeat only starts once the source has been confirmed. A
 * sandbox that is unreachable when the frame loads reaches neither, so without
 * this the canvas waits on a document that is never going to arrive.
 *
 * A frame that already failed is not waited on again — it has an answer, and
 * reporting a second one would only overwrite the more specific first.
 */
export function shouldWaitForPreviewFrame(
  previewKey: string | null,
  readyPreviewKey: string | null,
  failedPreviewKey: string | null,
): boolean {
  return (
    previewKey !== null &&
    readyPreviewKey !== previewKey &&
    failedPreviewKey !== previewKey
  );
}
