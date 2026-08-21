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
