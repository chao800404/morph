// @vitest-environment node
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalPreviewSidecar } from "./local-preview-sidecar";
import {
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  localPreviewSidecarPath,
} from "./local-preview-sidecar.protocol";

/**
 * The sidecar's connection policy, against the real server.
 *
 * Core's Worker runs in workerd, which pools connections to the sidecar and
 * closes an idle one itself after 5 s, whatever `Keep-Alive` hint the server
 * sends. If the sidecar closed an idle connection first, a Worker whose event
 * loop was busy past that point would reuse the dead socket and fail with
 * "Network connection lost.". So the sidecar must keep an idle connection
 * open, and still reclaim every connection when it stops.
 *
 * The client here is a raw socket on purpose. Like workerd, it ignores the
 * server's `Keep-Alive: timeout=` hint; Node's own http.Agent honours that hint
 * and would close the socket itself, which would hide what the server does.
 */

const TOKEN = "k".repeat(48);
/** Past Node's default idle close: 5 s keepAliveTimeout + 1 s buffer. */
const IDLE_PAST_OLD_CLOSE_MS = 6_500;

let workspacesRoot = "";
let sidecar: Awaited<ReturnType<typeof startLocalPreviewSidecar>> | null = null;
let observed: Array<Record<string, unknown>> = [];
const clientSockets: net.Socket[] = [];

async function freePort(): Promise<number> {
  return new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

beforeEach(async () => {
  workspacesRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "morph-sidecar-keepalive-"),
  );
  observed = [];
  sidecar = await startLocalPreviewSidecar({
    origin: `http://127.0.0.1:${await freePort()}`,
    token: TOKEN,
    workspacesRoot,
    toolchainRoot: process.cwd(),
    env: { NODE_ENV: "test" },
    observe: (line) => {
      observed.push(JSON.parse(line.slice(line.indexOf("{"))));
    },
  });
});

afterEach(async () => {
  for (const socket of clientSockets.splice(0)) socket.destroy();
  await sidecar?.close().catch(() => undefined);
  sidecar = null;
  await fs.rm(workspacesRoot, { recursive: true, force: true });
});

type TrackedSocket = {
  socket: net.Socket;
  closed: () => boolean;
  whenClosed: Promise<void>;
};

async function connect(): Promise<TrackedSocket> {
  const { port } = new URL(sidecar!.origin);
  const socket = net.connect(Number(port), "127.0.0.1");
  clientSockets.push(socket);
  let isClosed = false;
  const whenClosed = new Promise<void>((resolve) =>
    socket.once("close", () => {
      isClosed = true;
      resolve();
    }),
  );
  socket.on("error", () => undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return { socket, closed: () => isClosed, whenClosed };
}

/** One `isServing` request, written as raw HTTP/1.1 on a kept-alive socket. */
function writeIsServing(socket: net.Socket): void {
  const body = JSON.stringify({
    previewId: "keepalive-probe",
    previewHostname: "127.0.0.1",
  });
  socket.write(
    [
      `POST ${localPreviewSidecarPath("isServing")} HTTP/1.1`,
      "Host: 127.0.0.1",
      "Connection: keep-alive",
      "Content-Type: application/json",
      `${LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER}: ${TOKEN}`,
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body,
    ].join("\r\n"),
  );
}

/** Reads exactly one response (the sidecar always sends Content-Length). */
function readResponse(
  socket: net.Socket,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headEnd = buffer.indexOf("\r\n\r\n");
      if (headEnd < 0) return;
      const head = buffer.subarray(0, headEnd).toString("latin1");
      const length = Number(/\r\ncontent-length: *(\d+)/i.exec(head)?.[1]);
      if (buffer.length < headEnd + 4 + length) return;
      cleanup();
      resolve({
        status: Number(head.split(" ")[1]),
        body: buffer.subarray(headEnd + 4, headEnd + 4 + length).toString(),
      });
    };
    const onClose = () => {
      cleanup();
      reject(new Error("the sidecar closed the connection"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("close", onClose);
    };
    socket.on("data", onData);
    socket.once("close", onClose);
  });
}

const serverClosedSockets = () =>
  observed.filter(
    (event) =>
      event.event === "socket-timeout" || event.event === "socket-close",
  );

describe("the local preview sidecar's connection policy", () => {
  it(
    "keeps an idle kept-alive connection open past Node's default close, and serves the next request on it",
    async () => {
      const client = await connect();

      writeIsServing(client.socket);
      const first = await readResponse(client.socket);
      expect(first.status).toBe(200);

      await new Promise((resolve) =>
        setTimeout(resolve, IDLE_PAST_OLD_CLOSE_MS),
      );
      // The server did not close it: no timeout and no close on its side, and
      // the client's socket is still open.
      expect(serverClosedSockets()).toEqual([]);
      expect(client.closed()).toBe(false);

      writeIsServing(client.socket);
      const second = await readResponse(client.socket);
      expect(second.status).toBe(200);
      expect(JSON.parse(second.body)).toMatchObject({ serving: false });

      // Both requests arrived on one server-side socket, the second as a reuse.
      const requests = observed.filter((event) => event.event === "request");
      expect(requests).toHaveLength(2);
      expect(new Set(requests.map((event) => event.socket)).size).toBe(1);
      expect(requests[1]).toMatchObject({ seq: 2 });
      expect(Number(requests[1]!.idleMs)).toBeGreaterThanOrEqual(
        IDLE_PAST_OLD_CLOSE_MS - 50,
      );
    },
    IDLE_PAST_OLD_CLOSE_MS + 10_000,
  );

  it("reclaims idle connections on close, including one whose response was never read", async () => {
    const read = await connect();
    writeIsServing(read.socket);
    expect((await readResponse(read.socket)).status).toBe(200);

    // Like stageBinary on success: the response arrives and nobody reads it.
    const unread = await connect();
    unread.socket.pause();
    writeIsServing(unread.socket);
    await expect
      .poll(() => observed.filter((event) => event.event === "response").length)
      .toBe(2);

    const startedAt = Date.now();
    await sidecar!.close();
    const closeMs = Date.now() - startedAt;
    sidecar = null;

    // close() did not wait for an idle timeout to reclaim them.
    expect(closeMs).toBeLessThan(2_000);
    // The server side of both sockets closes (its "close" events may land just
    // after close() resolves), and neither through an idle timeout.
    await expect
      .poll(
        () => observed.filter((event) => event.event === "socket-close").length,
        { timeout: 1_000 },
      )
      .toBe(2);
    expect(observed.some((event) => event.event === "socket-timeout")).toBe(
      false,
    );
    await read.whenClosed;
    // The unread socket sees the close once its buffered response is drained.
    unread.socket.resume();
    await unread.whenClosed;
    expect(read.closed() && unread.closed()).toBe(true);
  });
});
