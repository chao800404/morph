import type { PreviewResourceFailure } from "../editor/preview-protocol";

/**
 * How the preview proxy says a module read was interrupted, and how the
 * editor recognises a page that was broken by it.
 *
 * The Sandbox SDK answers a request it could not carry to the container —
 * its Durable Object call failed with what it classifies as a platform
 * interruption — with an opaque `500 Proxy routing error`. The proxy retries
 * module reads a bounded number of times; when the interruption outlasts that,
 * the browser still gets a failure, and a module that fails to load stops its
 * whole graph for that document. The container is healthy again a moment
 * later, so nothing on the server side is left to notice: only a new document
 * can load the page.
 *
 * The SDK's message — "interrupted while the platform was updating the
 * sandbox runtime" — is its label for any retryable Durable Object error, not
 * a finding that the runtime was replaced. A Worker deploy does replace it,
 * but measured in local container runs the cause underneath was the
 * container port fetch failing with "Container port connection closed
 * unexpectedly." (retryable, remote) during a page's burst of module reads,
 * which the SDK's own preview forwarding does not absorb.
 *
 * A 500 cannot say that: Vite answers a module it cannot compile — a Theme's
 * own syntax error — with a 500 too, and reloading that would only fail again.
 * So the proxy answers an interruption it gave up on with its own status, which
 * the page's diagnostic script can see through Resource Timing and the editor
 * can tell apart from the Theme's failures.
 */
export const PREVIEW_RUNTIME_INTERRUPTED_STATUS = 503;
export const PREVIEW_RUNTIME_INTERRUPTED_CODE = "PREVIEW_RUNTIME_INTERRUPTED";

/** The proxy's answer for a module read it could not complete. */
export function previewRuntimeInterruptedResponse(): Response {
  return new Response(
    JSON.stringify({
      error:
        "Live Preview's runtime was interrupted while serving this module. Reload the preview.",
      code: PREVIEW_RUNTIME_INTERRUPTED_CODE,
    }),
    {
      status: PREVIEW_RUNTIME_INTERRUPTED_STATUS,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Whether a preview page reports a module graph that failed because the proxy
 * gave up on an interruption — not because of the Theme.
 *
 * Both halves are needed: a failed script says the page cannot come up in this
 * document, and the interruption status says why. A browser that does not
 * expose response statuses to Resource Timing reports none, and its page is
 * left to the editor's load watchdog as before.
 */
export function previewLoadWasInterrupted(report: {
  failedScripts: readonly string[];
  failures: readonly PreviewResourceFailure[];
}): boolean {
  return (
    report.failedScripts.length > 0 &&
    report.failures.some(
      (failure) => failure.status === PREVIEW_RUNTIME_INTERRUPTED_STATUS,
    )
  );
}
