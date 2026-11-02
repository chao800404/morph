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
 * Each event is one line, `MORPH_PREVIEW_REQUEST_TRACE <json>`, appended to a
 * file in the container that the Worker reads back through the sandbox's file
 * API after each start it completes, and writes to its own log. (The
 * container's main process output was used first; in CI the Vite process may
 * not open it: EACCES.) Every line carries the Vite process id and its line
 * number in that process, so a line read twice is known to be the same line.
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
 * - The Worker reads the file only when a start completes, never after a
 *   failed request, so lines written after a container's last start are not
 *   read before the container is removed.
 * - The file stops growing at PREVIEW_REQUEST_TRACE_MAX_BYTES; its state then
 *   says `capped`.
 */

/** The variable that turns the record on inside the preview container. */
export const PREVIEW_REQUEST_TRACE_ENV = "MORPH_PREVIEW_REQUEST_TRACE";

/** The prefix of every record line. */
export const PREVIEW_REQUEST_TRACE_MARKER = "MORPH_PREVIEW_REQUEST_TRACE";

/**
 * The record itself, outside the workspace so Vite does not watch it. Every
 * Vite process of the container appends to the same file.
 */
export const PREVIEW_REQUEST_TRACE_RECORD_PATH =
  "/tmp/morph-preview-request-trace.txt";

/**
 * The most the record file grows to: an eighth of the sandbox's 32 MiB read
 * limit, and some four times what the acceptance job's page loads are
 * estimated to write (about 1,300 preview requests, some 1 MB).
 */
export const PREVIEW_REQUEST_TRACE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The record's own state, for when the container's log has none of it: one
 * small file the Worker reads back through the sandbox's file API, only when
 * it turned the record on. Outside the workspace, so Vite does not watch it.
 * It holds the Vite process id, whether there was an HTTP server to record,
 * the code of the first write to the record that failed, if any, and whether
 * the record reached its size limit.
 */
export const PREVIEW_REQUEST_TRACE_STATUS_PATH =
  "/tmp/morph-preview-request-trace.json";

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
    if (process.env.${PREVIEW_REQUEST_TRACE_ENV} !== "1") return;
    let writeError = null;
    let capped = false;
    function status() {
      try {
        fs.writeFileSync(
          ${JSON.stringify(PREVIEW_REQUEST_TRACE_STATUS_PATH)},
          JSON.stringify({ pid: process.pid, httpServer: Boolean(httpServer), writeError, capped }),
        );
      } catch {
        // The state cannot be kept; the Worker reads it as missing.
      }
    }
    status();
    if (!httpServer) return;
    // Earlier Vite processes of this container wrote to the same file.
    let size = 0;
    try {
      size = fs.statSync(${JSON.stringify(PREVIEW_REQUEST_TRACE_RECORD_PATH)}).size;
    } catch {
      // Not there yet.
    }
    let lineNumber = 0;
    function emit(event) {
      if (writeError !== null || capped) return;
      const line =
        ${JSON.stringify(PREVIEW_REQUEST_TRACE_MARKER + " ")} +
        JSON.stringify(
          Object.assign({ t: new Date().toISOString(), pid: process.pid, n: lineNumber + 1 }, event),
        ) +
        "\\n";
      const bytes = Buffer.byteLength(line);
      if (size + bytes > ${PREVIEW_REQUEST_TRACE_MAX_BYTES}) {
        capped = true;
        status();
        return;
      }
      try {
        fs.appendFileSync(${JSON.stringify(PREVIEW_REQUEST_TRACE_RECORD_PATH)}, line);
        size += bytes;
        lineNumber++;
      } catch (error) {
        // A record that cannot be written stops; serving never does.
        writeError = typeof error?.code === "string" ? error.code : "unknown";
        status();
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

/** The fields a record line may carry; anything else is dropped on reading. */
const PREVIEW_REQUEST_TRACE_FIELDS = [
  "t",
  "pid",
  "n",
  "ev",
  "conn",
  "seq",
  "peer",
  "peerPort",
  "code",
  "hadError",
  "peerEndObserved",
  "requests",
  "method",
  "path",
  "outcome",
  "status",
  "ms",
  "handedBytes",
  "deliveredBytes",
] as const;

export type PreviewRequestTraceRecord = Partial<
  Record<
    (typeof PREVIEW_REQUEST_TRACE_FIELDS)[number],
    string | number | boolean | null
  >
>;

/**
 * The record file as the Worker reads it back: its lines, with only the
 * plugin's own fields kept. A path loses anything from `?` or `#` on, and a
 * delivered byte count other than "unknown" is dropped, whatever the file
 * says.
 */
export function parsePreviewRequestTraceRecords(text: string): {
  records: PreviewRequestTraceRecord[];
  invalid: number;
} {
  const records: PreviewRequestTraceRecord[] = [];
  let invalid = 0;
  const prefix = `${PREVIEW_REQUEST_TRACE_MARKER} `;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = line.startsWith(prefix)
        ? JSON.parse(line.slice(prefix.length))
        : null;
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalid++;
      continue;
    }
    const source = parsed as Record<string, unknown>;
    const record: PreviewRequestTraceRecord = {};
    for (const field of PREVIEW_REQUEST_TRACE_FIELDS) {
      const value = source[field];
      if (field === "path") {
        if (typeof value === "string") {
          record.path = value.split(/[?#]/, 1)[0].slice(0, 300);
        }
      } else if (field === "deliveredBytes") {
        if (value === "unknown") record.deliveredBytes = "unknown";
      } else if (typeof value === "string") {
        record[field] = value.slice(0, 80);
      } else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        record[field] = value;
      }
    }
    records.push(record);
  }
  return { records, invalid };
}
