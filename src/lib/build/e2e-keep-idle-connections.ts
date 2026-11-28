import type { Plugin } from "vite";

/**
 * In an end-to-end run, Core's dev server never closes an idle kept-alive
 * connection; the client does, or the server's close() does.
 *
 * Playwright's API requests (`page.request`, `context.request`) share one
 * Node `http.Agent({ keepAlive: true })` with no idle timeout of its own, so
 * it keeps an idle socket until it sees the server close it. Node's default
 * server policy closes an idle connection after 5 s plus a 1 s buffer. A
 * request the test sends to the pool as that close happens goes out on the
 * dying socket and fails with "apiRequestContext.post: socket hang up"
 * before Core reads it. That is the likely cause of the sign-out failure in
 * preview-access-container.spec.ts on CI run 46100822900 (not proven: the
 * run kept no socket record). Reproduced against a plain Node server with
 * Playwright's own request context and with its agent configuration; with
 * `keepAliveTimeout = 0` it does not happen.
 *
 * The same choice the local preview sidecar makes for workerd's pool
 * (local-preview-sidecar.ts) and Miniflare makes for its loopback server.
 * Only the idle keep-alive timeout is off: headersTimeout and requestTimeout
 * are unchanged, and Vite's close() still destroys every open socket.
 * Outside an end-to-end run the dev server is left as it is.
 */
export function e2eKeepIdleConnections(enabled: boolean): Plugin {
  return {
    name: "morph:e2e-keep-idle-connections",
    apply: "serve",
    configureServer(server) {
      if (!enabled) return;
      const httpServer = server.httpServer;
      // An HTTP/2 (https) dev server has no keep-alive timeout to change.
      if (httpServer && "keepAliveTimeout" in httpServer) {
        httpServer.keepAliveTimeout = 0;
      }
    },
  };
}
