// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { e2eKeepIdleConnections } from "./e2e-keep-idle-connections";

/**
 * Core's dev server connection policy in an end-to-end run, against a real
 * Node server and a client configured as Playwright's API requests are:
 * `new http.Agent({ keepAlive: true })`, no idle timeout of its own.
 */

/** Past Node's default idle close: 5 s keepAliveTimeout + 1 s buffer. */
const IDLE_PAST_DEFAULT_CLOSE_MS = 6_500;

let server: http.Server | null = null;
let agent: http.Agent | null = null;

afterEach(async () => {
  agent?.destroy();
  agent = null;
  server?.closeAllConnections();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  server = null;
});

function configured(enabled: boolean): http.Server {
  const created = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => response.end("ok"));
  });
  const plugin = e2eKeepIdleConnections(enabled);
  (plugin.configureServer as (server: ViteDevServer) => void)({
    httpServer: created,
  } as unknown as ViteDevServer);
  return created;
}

function send(port: number, method: "GET" | "POST"): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: "/api/auth/sign-out",
        agent: agent!,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end(method === "POST" ? "{}" : undefined);
  });
}

describe("e2eKeepIdleConnections", () => {
  it("leaves the dev server's policy alone outside an end-to-end run", () => {
    const untouched = http.createServer().keepAliveTimeout;
    expect(configured(false).keepAliveTimeout).toBe(untouched);
  });

  it("keeps an idle kept-alive connection open past Node's default close, so the next request reuses a live socket", async () => {
    server = configured(true);
    expect(server.keepAliveTimeout).toBe(0);
    let connections = 0;
    server.on("connection", () => {
      connections += 1;
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = server.address() as AddressInfo;
    agent = new http.Agent({ keepAlive: true });

    expect(await send(port, "GET")).toBe(200);
    await new Promise((resolve) =>
      setTimeout(resolve, IDLE_PAST_DEFAULT_CLOSE_MS),
    );
    expect(await send(port, "POST")).toBe(200);
    // One connection: the server did not close the idle one. With Node's
    // default policy it is closed at 6 s and the agent has to open another.
    expect(connections).toBe(1);
  }, 20_000);
});
