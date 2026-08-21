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
