/**
 * Records why a preview failed to start, and hands back only a reference.
 *
 * The stage alone named the step and nothing else: a start that failed once
 * and worked on retry left the same four words behind whether the port was
 * taken, the process exited, or the workspace never finished syncing. The
 * cause was there — `start` returns it — and was being dropped on the floor.
 *
 * Sandbox output names container paths and internals, so it is logged here and
 * never returned. The reference is what lets an author's screenshot be matched
 * to this line without giving the browser anything it should not hold.
 *
 * Its own module, not an export of the preview server function. A server
 * function file is replaced by RPC stubs in the client bundle, and that
 * substitution only happens while every export is a server function: one plain
 * export keeps the real module — and its `cloudflare:workers` import — in the
 * browser graph, where the editor route then fails to load at all.
 */
export function recordPreviewStartFailure(detail: {
  stage: string;
  errorMessage?: string;
  logs?: readonly string[];
  storefrontId: string;
  themeId: string;
  previewId: string;
  /** The start's `[preview-observe]` attempt, when the transport reports one. */
  attemptId?: string;
}): string {
  const traceId = crypto.randomUUID().slice(0, 8);
  console.error(
    JSON.stringify({
      scope: "storefront.preview.start",
      traceId,
      stage: detail.stage,
      errorMessage: detail.errorMessage ?? null,
      storefrontId: detail.storefrontId,
      themeId: detail.themeId,
      previewId: detail.previewId,
      attemptId: detail.attemptId ?? null,
      // The tail is where a start failure explains itself; the head is the
      // same container boot every time.
      logs: (detail.logs ?? []).slice(-40),
    }),
  );
  return traceId;
}
