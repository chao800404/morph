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
