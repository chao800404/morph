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
