import { isolateSvgResponse } from "../theme-svg-isolation";
import { withoutPlatformCookies } from "./preview-proxy-credentials";

/**
 * The SDK catches a runtime interruption and returns this exact, opaque 500.
 * A failed ESM import poisons that document's module graph even if the runtime
 * is healthy again a moment later. Retry only reads of Vite's module assets,
 * never a page, API, server function or write. Persistent failures still reach
 * the browser; this is bounded recovery, not evidence of a healthy runtime.
 */
export async function proxyPreviewModuleRequest(
  request: Request,
  proxy: (request: Request) => Promise<Response | null>,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response | null> {
  // The client-only runtime's Vite modules live under its base; Start's are
  // at the origin root. Classify the module path, never alter the request URL.
  const path = new URL(request.url).pathname.replace(
    /^\/__morph-theme-preview__(?=\/)/,
    "",
  );
  const moduleRead =
    request.method === "GET" &&
    (path === "/@react-refresh" ||
      path === "/@vite/client" ||
      path === "/@vite/env" ||
      path === "/__morph_preview_client.ts" ||
      ((path.startsWith("/src/") ||
        path.startsWith("/@fs/") ||
        path.startsWith("/node_modules/.vite/") ||
        path.startsWith("/@id/")) &&
        /\.(?:[cm]?[jt]sx?|css)$/.test(path)));
  for (let attempt = 0; ; attempt++) {
    const response = await proxy(request);
    if (!moduleRead || response?.status !== 500 || attempt === 2)
      return response;
    // Only inspect a bounded text body. The SDK uses a short plain-text
    // response, but the container can also return arbitrary 500 bodies.
    if (!response.headers.get("content-type")?.startsWith("text/plain"))
      return response;
    const copy = response.clone();
    const reader = copy.body?.getReader();
    if (!reader) return response;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const matches = await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 64) return false;
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return new TextDecoder().decode(bytes) === "Proxy routing error";
      })(),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 250);
      }),
    ])
      .catch(() => false)
      .finally(() => {
        clearTimeout(timer);
        void reader.cancel().catch(() => {});
      });
    if (!matches) return response;
    void response.body?.cancel().catch(() => {});
    await pause(attempt === 0 ? 100 : 250);
  }
}

/**
 * Makes a refused Live Preview request something a browser will ask again.
 *
 * A preview page imports its modules from a URL that outlives any one
 * container: the address is kept across restarts, so the same module URL is
 * requested over and over. When the Sandbox SDK briefly refused one of those
 * requests — its runtime was restarting — the browser kept the refusal and
 * answered every later load of that module from its own cache, without asking
 * again. A module that fails stops its whole graph, so the preview never came
 * up again in that browser, however healthy the container became, until the
 * cache was cleared by hand.
 *
 * An error from the preview is a statement about that moment, never about the
 * resource, so none of them is stored. Successful responses are left alone:
 * Vite sets their caching itself.
 */
export function uncacheablePreviewError(response: Response): Response {
  if (response.status < 400) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * What the preview proxy sends for a container's response: no cookie under a
 * platform credential's name; a refusal that is never stored, since it is
 * about this moment and a browser that kept it would stop asking; and an SVG,
 * whatever in the container sent it, with the platform's isolation headers.
 */
export function finishPreviewResponse(response: Response): Response {
  return isolateSvgResponse(
    uncacheablePreviewError(withoutPlatformCookies(response)),
  );
}
