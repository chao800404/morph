// @vitest-environment node
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  parsePreviewRequestTraceRecords,
  PREVIEW_REQUEST_TRACE_ENV,
  PREVIEW_REQUEST_TRACE_MARKER,
  PREVIEW_REQUEST_TRACE_MAX_BYTES,
  PREVIEW_REQUEST_TRACE_RECORD_PATH,
  PREVIEW_REQUEST_TRACE_STATUS_PATH,
  themePreviewRequestTracePluginSource,
} from "./theme-preview-request-trace";

type TraceEvent = Record<string, unknown>;

/**
 * Runs the emitted source as the container config does, with `fs` and
 * `process` standing in for the container's.
 */
const statuses: unknown[] = [];

function loadPlugin(
  env: Record<string, string>,
  lines: string[],
  existingBytes?: number,
) {
  const fs = {
    statSync(path: string) {
      expect(path).toBe(PREVIEW_REQUEST_TRACE_RECORD_PATH);
      if (existingBytes === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return { size: existingBytes };
    },
    appendFileSync(path: string, line: string) {
      expect(path).toBe(PREVIEW_REQUEST_TRACE_RECORD_PATH);
      lines.push(line);
    },
    writeFileSync(path: string, text: string) {
      expect(path).toBe(PREVIEW_REQUEST_TRACE_STATUS_PATH);
      statuses.push(JSON.parse(text));
    },
  };
  const fakeProcess = { env, pid: 4242 };
  return new Function(
    "fs",
    "process",
    `return (${themePreviewRequestTracePluginSource()});`,
  )(fs, fakeProcess) as {
    name: string;
    configureServer(server: { httpServer: http.Server | null }): void;
  };
}

function events(lines: string[]): TraceEvent[] {
  return lines.map((line) => {
    expect(line.startsWith(`${PREVIEW_REQUEST_TRACE_MARKER} `)).toBe(true);
    expect(line.endsWith("\n")).toBe(true);
    return JSON.parse(line.slice(PREVIEW_REQUEST_TRACE_MARKER.length + 1));
  });
}

const servers: http.Server[] = [];
afterEach(async () => {
  statuses.length = 0;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
});

async function serve(
  handler: http.RequestListener,
  env: Record<string, string>,
  lines: string[],
  existingBytes?: number,
) {
  const server = http.createServer(handler);
  servers.push(server);
  loadPlugin(env, lines, existingBytes).configureServer({ httpServer: server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function settle(lines: string[], until: (all: TraceEvent[]) => boolean) {
  for (let i = 0; i < 100 && !until(events(lines)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return events(lines);
}

describe("preview request trace plugin", () => {
  it("records nothing unless the container was started with the variable", async () => {
    const lines: string[] = [];
    const port = await serve((_req, res) => res.end("ok"), {}, lines);
    const answer = await fetch(`http://127.0.0.1:${port}/src/a.ts?t=1`);
    expect(await answer.text()).toBe("ok");
    expect(lines).toEqual([]);
    // Off: not even its state is kept.
    expect(statuses).toEqual([]);
  });

  it("keeps its state where the Worker can read it, even with no server to record", () => {
    const lines: string[] = [];
    loadPlugin({ [PREVIEW_REQUEST_TRACE_ENV]: "1" }, lines).configureServer({
      httpServer: null,
    });
    expect(statuses).toEqual([
      { pid: 4242, httpServer: false, writeError: null, capped: false },
    ]);
    expect(lines).toEqual([]);
  });

  it("records a request's path without its query, and the body bytes handed to Node", async () => {
    const lines: string[] = [];
    const body = "x".repeat(70_000) + "é";
    const port = await serve(
      (_req, res) => {
        res.write(body.slice(0, 1000));
        res.end(body.slice(1000));
      },
      { [PREVIEW_REQUEST_TRACE_ENV]: "1" },
      lines,
    );
    const answer = await fetch(
      `http://127.0.0.1:${port}/src/morph/preview-bridge.ts?previewSession=secret-session&token=abc`,
      { headers: { cookie: "session=hunter2", authorization: "Bearer zzz" } },
    );
    expect(await answer.text()).toBe(body);
    const all = await settle(lines, (e) => e.some((x) => x.ev === "res"));
    const text = lines.join("");
    for (const secret of [
      "secret-session",
      "token",
      "hunter2",
      "Bearer",
      "zzz",
      "?",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(all[0]).toMatchObject({ ev: "trace-start", pid: 4242, n: 1 });
    // Each line is numbered within its process, so a line read twice is
    // known to be the same.
    expect(all.map((event) => event.n)).toEqual(all.map((_e, i) => i + 1));
    expect(all.every((event) => event.pid === 4242)).toBe(true);
    expect(statuses).toEqual([
      { pid: 4242, httpServer: true, writeError: null, capped: false },
    ]);
    const request = all.find((x) => x.ev === "req")!;
    expect(request).toMatchObject({
      seq: 1,
      conn: 1,
      method: "GET",
      path: "/src/morph/preview-bridge.ts",
    });
    const response = all.find((x) => x.ev === "res")!;
    expect(response).toMatchObject({
      seq: 1,
      handedBytes: Buffer.byteLength(body),
      deliveredBytes: "unknown",
    });
    expect(Object.keys(response).sort()).toEqual(
      [
        "deliveredBytes",
        "ev",
        "handedBytes",
        "ms",
        "n",
        "outcome",
        "pid",
        "seq",
        "status",
        "t",
      ].sort(),
    );
    expect(all.find((x) => x.ev === "conn-open")).toMatchObject({
      conn: 1,
      peer: "127.0.0.1",
    });
    for (const event of all) {
      expect(typeof event.t).toBe("string");
      expect(Number.isNaN(Date.parse(event.t as string))).toBe(false);
    }
  });

  it("records a response the peer closed before it finished, and how the connection ended", async () => {
    const lines: string[] = [];
    const port = await serve(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.write("partial");
        // Never ends: the peer goes away first.
      },
      { [PREVIEW_REQUEST_TRACE_ENV]: "1" },
      lines,
    );
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write("GET /src/a.ts?q=1 HTTP/1.1\r\nHost: x\r\n\r\n");
    await new Promise<void>((resolve) => socket.once("data", () => resolve()));
    socket.end();
    const all = await settle(lines, (e) =>
      e.some((x) => x.ev === "conn-close"),
    );
    expect(all.find((x) => x.ev === "res")).toMatchObject({
      seq: 1,
      outcome: "closed-before-finish",
      status: 200,
      handedBytes: "partial".length,
      deliveredBytes: "unknown",
    });
    expect(all.find((x) => x.ev === "conn-peer-end")).toMatchObject({
      conn: 1,
    });
    expect(all.find((x) => x.ev === "conn-close")).toMatchObject({
      conn: 1,
      peerEndObserved: true,
      requests: 1,
    });
  });

  it("stops recording, and keeps serving, once a line cannot be written", async () => {
    let calls = 0;
    const kept: unknown[] = [];
    const fs = {
      statSync() {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      appendFileSync() {
        calls++;
        throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
      },
      writeFileSync(_path: string, text: string) {
        kept.push(JSON.parse(text));
      },
    };
    const plugin = new Function(
      "fs",
      "process",
      `return (${themePreviewRequestTracePluginSource()});`,
    )(fs, { env: { [PREVIEW_REQUEST_TRACE_ENV]: "1" }, pid: 1 });
    const server = http.createServer((_req, res) => res.end("still here"));
    servers.push(server);
    plugin.configureServer({ httpServer: server });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const answer = await fetch(`http://127.0.0.1:${port}/x`);
    expect(await answer.text()).toBe("still here");
    expect(calls).toBe(1);
    // The failure is kept where the Worker reads it, not in the log it failed on.
    expect(kept).toEqual([
      { pid: 1, httpServer: true, writeError: null, capped: false },
      { pid: 1, httpServer: true, writeError: "EPIPE", capped: false },
    ]);
  });

  it("stops growing the file at its limit, counting what earlier processes wrote", async () => {
    const lines: string[] = [];
    const port = await serve(
      (_req, res) => res.end("ok"),
      { [PREVIEW_REQUEST_TRACE_ENV]: "1" },
      lines,
      // Room for the first line only.
      PREVIEW_REQUEST_TRACE_MAX_BYTES - 120,
    );
    const answer = await fetch(`http://127.0.0.1:${port}/src/a.ts`);
    expect(await answer.text()).toBe("ok");
    expect(events(lines).map((event) => event.ev)).toEqual(["trace-start"]);
    expect(statuses).toEqual([
      { pid: 4242, httpServer: true, writeError: null, capped: false },
      { pid: 4242, httpServer: true, writeError: null, capped: true },
    ]);
  });
});

describe("reading the record back", () => {
  it("keeps only the plugin's fields, a path without its query, and no delivered count", () => {
    const text = [
      `${PREVIEW_REQUEST_TRACE_MARKER} {"t":"2026-10-30T14:35:18.700Z","pid":5223,"n":7,"ev":"res","seq":3,"outcome":"closed-before-finish","status":200,"ms":12,"handedBytes":65536,"deliveredBytes":"139374","cookie":"session=1"}`,
      `${PREVIEW_REQUEST_TRACE_MARKER} {"t":"x","pid":5223,"n":8,"ev":"req","path":"/src/a.ts?previewSession=secret#h","headers":{"authorization":"Bearer z"}}`,
      `${PREVIEW_REQUEST_TRACE_MARKER} {"t":"x","pid":5223,"n":9,"ev":"res","deliveredBytes":"unknown"}`,
      `${PREVIEW_REQUEST_TRACE_MARKER} not json`,
      "something else",
      `${PREVIEW_REQUEST_TRACE_MARKER} [1]`,
      "",
    ].join("\n");
    const { records, invalid } = parsePreviewRequestTraceRecords(text);
    expect(invalid).toBe(3);
    expect(records).toEqual([
      {
        t: "2026-10-30T14:35:18.700Z",
        pid: 5223,
        n: 7,
        ev: "res",
        seq: 3,
        outcome: "closed-before-finish",
        status: 200,
        ms: 12,
        handedBytes: 65536,
      },
      { t: "x", pid: 5223, n: 8, ev: "req", path: "/src/a.ts" },
      { t: "x", pid: 5223, n: 9, ev: "res", deliveredBytes: "unknown" },
    ]);
    const kept = JSON.stringify(records);
    for (const secret of ["session", "secret", "Bearer", "139374", "#"]) {
      expect(kept).not.toContain(secret);
    }
  });
});
