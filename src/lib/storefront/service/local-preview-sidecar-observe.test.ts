// @vitest-environment node
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX,
  LocalPreviewSidecarClient,
  safeTransportMessage,
} from "./local-preview-sidecar-client";
import { startLocalPreviewSidecar } from "./local-preview-sidecar";
import {
  LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX,
  observeLocalPreviewSidecar,
  readSidecarRequestId,
} from "./local-preview-sidecar-observe";
import {
  LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER,
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  localPreviewSidecarPath,
} from "./local-preview-sidecar.protocol";

/**
 * The record a lost Worker → sidecar request leaves on both sides.
 *
 * One CI run lost a preview start with "Network connection lost" and nothing
 * said whether the sidecar had seen it. These pin what is now written: the
 * Worker's failure line carries the request id it sent, the sidecar's lines
 * carry the same id and the connection that carried it, and neither carries
 * the token. They check the record, not the cause; nothing here retries,
 * waits longer or changes a result.
 */

const TOKEN = "t".repeat(48);

type Event = Record<string, unknown> & { event: string };

const parse = (lines: readonly string[], prefix: string): Event[] =>
  lines
    .filter((line) => line.startsWith(`${prefix} `))
    .map((line) => JSON.parse(line.slice(prefix.length + 1)) as Event);

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(found));
    });
  });
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

async function observedSidecar() {
  const lines: string[] = [];
  const sidecar = await startLocalPreviewSidecar({
    origin: `http://127.0.0.1:${await freePort()}`,
    token: TOKEN,
    env: { NODE_ENV: "test" },
    observe: (line) => lines.push(line),
  });
  closers.push(() => sidecar.close());
  return { sidecar, lines };
}

/** A client whose sent request ids and failure lines are kept. */
function recordingClient(origin: string, fetchImpl?: typeof fetch) {
  const sentIds: string[] = [];
  const logged: string[] = [];
  const base = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const client = new LocalPreviewSidecarClient({
    origin,
    token: TOKEN,
    timeoutMs: 2_000,
    log: (line) => logged.push(line),
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      sentIds.push(headers[LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER]);
      return base(url, init);
    }) as typeof fetch,
  });
  return { client, sentIds, logged };
}

describe("the sidecar's own record of its requests", () => {
  it("names the request id the Worker sent, and never the token", async () => {
    const { sidecar, lines } = await observedSidecar();
    const { client, sentIds, logged } = recordingClient(sidecar.origin);

    await expect(
      client.isServing({
        previewId: "preview-x",
        previewHostname: "127.0.0.1",
      }),
    ).resolves.toBe(false);

    const events = parse(lines, LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX);
    const listening = events.find((event) => event.event === "listening");
    expect(listening?.pid).toBe(process.pid);
    expect(typeof listening?.keepAliveTimeoutMs).toBe("number");

    expect(sentIds).toHaveLength(1);
    const request = events.find((event) => event.event === "request");
    expect(request).toMatchObject({
      operation: "isServing",
      requestId: sentIds[0],
      seq: 1,
      idleMs: null,
    });
    expect(typeof request?.socket).toBe("number");
    expect(events.find((event) => event.event === "response")).toMatchObject({
      operation: "isServing",
      requestId: sentIds[0],
      status: 200,
    });

    expect(lines.join("\n")).not.toContain(TOKEN);
    // A request that was answered leaves nothing on the Worker's side.
    expect(logged).toEqual([]);
  });

  it("shows a kept-alive connection being reused, and how long it sat idle", async () => {
    const { sidecar, lines } = await observedSidecar();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    closers.push(async () => agent.destroy());
    const ask = () =>
      new Promise<number>((resolve, reject) => {
        const request = http.request(
          `${sidecar.origin}${localPreviewSidecarPath("isServing")}`,
          {
            method: "POST",
            agent,
            headers: {
              "content-type": "application/json",
              [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: TOKEN,
            },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.on("error", reject);
        request.end(
          JSON.stringify({ previewId: "p", previewHostname: "127.0.0.1" }),
        );
      });

    expect(await ask()).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await ask()).toBe(200);

    const requests = parse(lines, LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX).filter(
      (event) => event.event === "request",
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.socket).toBe(requests[0]?.socket);
    expect(requests[1]?.seq).toBe(2);
    expect(requests[1]?.idleMs).toEqual(expect.any(Number));
    expect(requests[1]?.idleMs as number).toBeGreaterThanOrEqual(40);
    // No id was sent, so none is invented.
    expect(requests[0]?.requestId).toBeNull();
  });

  it("records a request whose connection closed before it was answered", async () => {
    const lines: string[] = [];
    const server = http.createServer(() => {
      /* Never answers. */
    });
    const observer = observeLocalPreviewSidecar(server, (line) =>
      lines.push(line),
    );
    server.prependListener("request", (request, response) =>
      observer.request("start", request, response),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const address = server.address() as net.AddressInfo;

    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      path: "/start",
      headers: { [LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER]: "abc-123" },
    });
    request.on("error", () => undefined);
    request.end("{}");
    await expect
      .poll(() =>
        parse(lines, LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX).some(
          (e) => e.event === "request",
        ),
      )
      .toBe(true);
    request.destroy();

    await expect
      .poll(() =>
        parse(lines, LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX).map((e) => e.event),
      )
      .toEqual(expect.arrayContaining(["response-aborted", "socket-close"]));
    const events = parse(lines, LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX);
    expect(events.find((e) => e.event === "response-aborted")).toMatchObject({
      operation: "start",
      requestId: "abc-123",
    });
    expect(events.find((e) => e.event === "socket-close")).toMatchObject({
      requests: 1,
      idleMs: null,
    });
    expect(events.some((e) => e.event === "response")).toBe(false);
  });

  it("writes nothing of a request's query, headers or body", async () => {
    const MARK = "SENSITIVEMARK";
    const { sidecar, lines } = await observedSidecar();
    const send = (path: string, requestId: string) =>
      new Promise<number>((resolve, reject) => {
        const request = http.request(
          `${sidecar.origin}${path}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: `better-auth.session_token=${MARK}1`,
              authorization: `Bearer ${MARK}2`,
              [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: TOKEN,
              [LOCAL_PREVIEW_SIDECAR_REQUEST_ID_HEADER]: requestId,
            },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        request.on("error", reject);
        request.end(
          JSON.stringify({
            previewId: `${MARK}3`,
            previewHostname: "127.0.0.1",
            content: `<h1>${MARK}4 draft</h1>`,
          }),
        );
      });

    expect(
      await send(
        `${localPreviewSidecarPath("isServing")}?q=${MARK}5`,
        `${MARK}6 x`,
      ),
    ).toBe(200);
    expect(await send(`/${MARK}7/unknown`, "ok-id")).toBe(404);

    const all = lines.join("\n");
    expect(all).not.toContain(MARK);
    expect(all).not.toContain(TOKEN);
    const requests = parse(lines, LOCAL_PREVIEW_SIDECAR_OBSERVE_PREFIX).filter(
      (event) => event.event === "request",
    );
    expect(requests).toMatchObject([
      { operation: "isServing", requestId: null },
      { operation: "unknown", requestId: "ok-id" },
    ]);
  });

  it("keeps only something shaped like an id", () => {
    expect(readSidecarRequestId("0f8e-ab12")).toBe("0f8e-ab12");
    expect(readSidecarRequestId(["a1", "b2"])).toBe("a1");
    expect(readSidecarRequestId(undefined)).toBeNull();
    expect(readSidecarRequestId("has space")).toBeNull();
    expect(readSidecarRequestId("x".repeat(65))).toBeNull();
  });
});

describe("the Worker's record of a request that failed", () => {
  const startInput = {
    previewId: "preview-1",
    files: [],
    entry: "src/pages/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
  };

  it("logs a lost connection with the id it sent, and returns the same failure as before", async () => {
    const { client, sentIds, logged } = recordingClient(
      "http://127.0.0.1:5199",
      (async () => {
        throw new TypeError("Network connection lost.");
      }) as typeof fetch,
    );

    const started = await client.start(startInput);
    expect(started).toEqual({
      ok: false,
      stage: "preview-sidecar",
      errorMessage:
        "LOCAL_PREVIEW_SIDECAR_UNREACHABLE: Network connection lost.",
      logs: [],
    });

    const [failure, ...rest] = parse(
      logged,
      LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX,
    );
    expect(rest).toEqual([]);
    expect(failure).toMatchObject({
      event: "request-failed",
      requestId: sentIds[0],
      operation: "start",
      previewId: "preview-1",
      outcome: "unreachable",
      phase: "request",
      status: null,
      errorName: "TypeError",
      errorMessage: "Network connection lost.",
    });
    expect(failure?.elapsedMs).toEqual(expect.any(Number));
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  // Messages a runtime could produce, each carrying a marker where a URL, a
  // path, a response fragment or a credential would be. Includes the shapes
  // that got past the earlier pattern-based filter.
  const SHORT_TOKEN = "abcd1234efgh";
  const UNSAFE_MESSAGES = (MARK: string) => [
    `request to http://127.0.0.1:5199/start?token=${TOKEN}&q=${MARK}1 failed`,
    `while reading /home/a0921/workspaces/${MARK}2/src/pages/index.tsx`,
    `and C:\\Users\\someone\\${MARK}3\\draft.tsx`,
    `body "export default () => <h1>${MARK}4 draft</h1>"`,
    `cookie 'better-auth.session_token=${MARK}5'`,
    `raw ${TOKEN}`,
    `127.0.0.1:5199/start?token=${SHORT_TOKEN}&draft=${MARK}6`,
    `src/${MARK}7-draft.tsx`,
    `%2Fhome%2F${MARK}8%2Fdraft`,
    `<body>${MARK}9 Draft Title</body>`,
    `unclosed "quote ${MARK}10 and the rest`,
    `{"error":"\\"${MARK}11\\""}`,
    `Network connection lost. ${MARK}12`,
    `fetch failed\n${MARK}13`,
    `connect ECONNREFUSED 127.0.0.1:5199 ${MARK}14`,
    `${"x".repeat(50_000)}${MARK}15`,
  ];

  it("records no transport message that is not a known wording, only its length", async () => {
    const MARK = "SENSITIVEMARK";
    for (const message of UNSAFE_MESSAGES(MARK)) {
      const thrown = new TypeError(message);
      thrown.name = `TypeError ${MARK}name`;
      const { client, logged } = recordingClient(
        "http://127.0.0.1:5199",
        (async () => {
          throw thrown;
        }) as typeof fetch,
      );
      const started = await client.start(startInput);
      // What the caller gets is not this record's business: it is unchanged.
      expect(started).toMatchObject({
        ok: false,
        errorMessage: `LOCAL_PREVIEW_SIDECAR_UNREACHABLE: ${message}`,
      });
      const all = logged.join("\n");
      expect(logged, message.slice(0, 60)).toHaveLength(1);
      expect(all, message.slice(0, 60)).not.toContain(MARK);
      expect(all).not.toContain(TOKEN);
      expect(all).not.toContain(SHORT_TOKEN);
      const [failure] = parse(logged, LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX);
      expect(failure).toMatchObject({
        errorName: "Error",
        errorMessage: null,
        errorMessageLength: message.length,
      });
    }
  });

  it("keeps the transport's own wording as it is, and the error's code", async () => {
    for (const message of [
      "Network connection lost.",
      "fetch failed",
      "socket hang up",
      "other side closed",
      "This operation was aborted",
      "internal error; reference = 0123abcdxyz",
      "connect ECONNREFUSED 127.0.0.1:5199",
      "read ECONNRESET",
      "connect ECONNREFUSED ::1:5199",
    ]) {
      expect(safeTransportMessage(message)).toBe(message);
    }
    const cause = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const { client, logged } = recordingClient(
      "http://127.0.0.1:5199",
      (async () => {
        throw new TypeError("fetch failed", { cause });
      }) as typeof fetch,
    );
    await client.start(startInput);
    expect(
      parse(logged, LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX),
    ).toMatchObject([
      {
        errorName: "TypeError",
        errorCode: "UND_ERR_SOCKET",
        errorMessage: "fetch failed",
      },
    ]);
  });

  it("names a body that would not parse, and does not quote the parser", async () => {
    const MARK = "SENSITIVEMARK";
    const { client, logged } = recordingClient(
      "http://127.0.0.1:5199",
      (async () =>
        new Response(`{"draft":"${MARK}" broken`, {
          status: 200,
        })) as unknown as typeof fetch,
    );
    const started = await client.start(startInput);
    expect(started.ok).toBe(false);
    expect(logged.join("\n")).not.toContain(MARK);
    expect(
      parse(logged, LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX),
    ).toMatchObject([
      {
        phase: "response",
        status: 200,
        errorName: "SyntaxError",
        errorMessage: null,
      },
    ]);
  });

  it("tells a connection lost while reading a 200 apart from one that never answered", async () => {
    const { client, logged } = recordingClient(
      "http://127.0.0.1:5199",
      (async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new TypeError("Network connection lost."));
            },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    );

    const started = await client.start(startInput);
    // The caller's failure is what it always was.
    expect(started).toMatchObject({
      ok: false,
      stage: "preview-sidecar",
      errorMessage:
        "LOCAL_PREVIEW_SIDECAR_UNREACHABLE: Network connection lost.",
    });
    expect(
      parse(logged, LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX),
    ).toMatchObject([
      { outcome: "unreachable", phase: "response", status: 200 },
    ]);
  });

  it("logs a refusal by status and code, without the sidecar's text", async () => {
    const { client, logged } = recordingClient(
      "http://127.0.0.1:5199",
      (async () =>
        new Response(
          JSON.stringify({
            error:
              'RESERVED_THEME_GENERATED_PATH: "src/secret-draft/page.tsx" under /home/someone/workspaces',
          }),
          { status: 500 },
        )) as unknown as typeof fetch,
    );
    const started = await client.start(startInput);
    // The returned reason still carries the text, exactly as before.
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.errorMessage).toContain("src/secret-draft/page.tsx");
    }
    const [failure] = parse(logged, LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX);
    expect(failure).toMatchObject({
      operation: "start",
      outcome: "http",
      phase: "response",
      status: 500,
      errorCode: "RESERVED_THEME_GENERATED_PATH",
    });
    expect(logged.join("\n")).not.toContain("secret-draft");
    expect(logged.join("\n")).not.toContain("/home/someone");
  });

  it("logs every failing isServing poll: a client lives for one call", async () => {
    const { client, logged } = recordingClient(
      "http://127.0.0.1:5199",
      (async () =>
        new Response("busy", { status: 503 })) as unknown as typeof fetch,
    );
    const poll = () =>
      client.isServing({
        previewId: "preview-1",
        previewHostname: "127.0.0.1",
      });
    await poll();
    await poll();
    expect(
      parse(logged, LOCAL_PREVIEW_SIDECAR_CLIENT_LOG_PREFIX),
    ).toMatchObject([
      { operation: "isServing", status: 503 },
      { operation: "isServing", status: 503 },
    ]);
  });
});
