/**
 * Container-side record of the Live Preview's HTTP traffic, for diagnosing
 * the container port connections that close during the container acceptance
 * job (handoff 2026-10-30, container-port-close-diagnosis). The Worker side
 * already logs each module read it could not complete; this is the same
 * traffic as the preview's Vite server saw it.
 *
 * Off unless the Vite process was started with
 * `MORPH_PREVIEW_REQUEST_TRACE=1`, which only a non-production Worker with
 * that binding does (theme-preview-server.factory.ts). The generated config
 * always carries the plugin, so turning it on changes no workspace file.
 *
 * Each event is one line, `MORPH_PREVIEW_REQUEST_TRACE <json>`, appended to
 * the container's main process output, which the container's own log keeps.
 * It records the time, connection and request sequence numbers, the peer's
 * address and port, the method, the path without its query, the status, the
 * duration, the body bytes the response handed to Node, and how the response
 * and the connection ended. No header, cookie, query or body is read or
 * written.
 *
 * What it cannot say:
 * - `handedBytes` counts what Vite passed to `write`/`end`. How much of it
 *   reached the peer is not known here and is written as "unknown";
 *   Content-Length is never taken for it.
 * - "finished" is Node's `finish`: the whole response was handed to the
 *   operating system, not that the proxy in front or the browser received
 *   it. A response can finish here and still fail on its way out.
 * - `peerEndObserved` says only that the socket's `end` event (the peer's
 *   end of the stream) was seen before it closed. This side's own closing is
 *   not recorded, so it does not say which side closed first.
 * - No request id is shared with the Worker: lining a record up with the
 *   Worker's log goes by path and time, and is uncertain when the same path
 *   is requested more than once close together.
 */

/** The variable that turns the record on inside the preview container. */
export const PREVIEW_REQUEST_TRACE_ENV = "MORPH_PREVIEW_REQUEST_TRACE";

/** The prefix of every record line. */
export const PREVIEW_REQUEST_TRACE_MARKER = "MORPH_PREVIEW_REQUEST_TRACE";

/** The container's main process output, which its log keeps. */
const CONTAINER_LOG_PATH = "/proc/1/fd/1";

/**
 * The plugin, as source for the generated container config, which imports
 * `fs` itself. Emitted as text rather than a compiled function's source, so
 * nothing the Worker's bundler adds to a function can reach the container.
 */
export function themePreviewRequestTracePluginSource(): string {
  return `{
  name: "morph-preview-request-trace",
  configureServer(server) {
    const httpServer = server.httpServer;
    if (process.env.${PREVIEW_REQUEST_TRACE_ENV} !== "1" || !httpServer) return;
    let broken = false;
    function emit(event) {
      if (broken) return;
      try {
        fs.appendFileSync(
          ${JSON.stringify(CONTAINER_LOG_PATH)},
          ${JSON.stringify(PREVIEW_REQUEST_TRACE_MARKER + " ")} +
            JSON.stringify(Object.assign({ t: new Date().toISOString() }, event)) +
            "\\n",
        );
      } catch {
        // A record that cannot be written stops; serving never does.
        broken = true;
      }
    }
    let connections = 0;
    let requests = 0;
    const sockets = new WeakMap();
    emit({ ev: "trace-start", pid: process.pid });
    httpServer.on("connection", (socket) => {
      const state = { conn: ++connections, served: 0 };
      sockets.set(socket, state);
      let peerEndSeen = false;
      emit({
        ev: "conn-open",
        conn: state.conn,
        peer: socket.remoteAddress ?? null,
        peerPort: socket.remotePort ?? null,
      });
      socket.on("end", () => {
        peerEndSeen = true;
        emit({ ev: "conn-peer-end", conn: state.conn });
      });
      socket.on("error", (error) => {
        emit({
          ev: "conn-error",
          conn: state.conn,
          code: typeof error?.code === "string" ? error.code : null,
        });
      });
      socket.on("close", (hadError) => {
        emit({
          ev: "conn-close",
          conn: state.conn,
          hadError,
          peerEndObserved: peerEndSeen,
          requests: state.served,
        });
      });
    });
    // Ahead of Vite's own handler, so a response it ends at once is still
    // counted.
    httpServer.prependListener("request", (request, response) => {
      const seq = ++requests;
      const state = sockets.get(request.socket);
      if (state) state.served++;
      const started = Date.now();
      let path;
      try {
        path = new URL(request.url ?? "/", "http://preview.invalid").pathname;
      } catch {
        path = "(unparsable)";
      }
      emit({ ev: "req", seq, conn: state?.conn ?? null, method: request.method ?? null, path });
      let handed = 0;
      function count(chunk, encoding) {
        if (chunk == null || typeof chunk === "function") return;
        if (typeof chunk === "string") {
          handed += Buffer.byteLength(chunk, typeof encoding === "string" ? encoding : "utf8");
        } else if (chunk instanceof Uint8Array) {
          handed += chunk.byteLength;
        }
      }
      const write = response.write;
      const end = response.end;
      response.write = function (...args) {
        count(args[0], args[1]);
        return write.apply(this, args);
      };
      response.end = function (...args) {
        count(args[0], args[1]);
        return end.apply(this, args);
      };
      let finished = false;
      response.on("finish", () => {
        finished = true;
        emit({
          ev: "res",
          seq,
          outcome: "finished",
          status: response.statusCode,
          ms: Date.now() - started,
          handedBytes: handed,
          deliveredBytes: "unknown",
        });
      });
      response.on("close", () => {
        if (finished) return;
        emit({
          ev: "res",
          seq,
          outcome: "closed-before-finish",
          status: response.headersSent ? response.statusCode : null,
          ms: Date.now() - started,
          handedBytes: handed,
          deliveredBytes: "unknown",
        });
      });
    });
  },
}`;
}
