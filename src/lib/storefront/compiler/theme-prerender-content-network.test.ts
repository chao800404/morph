// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { expect, it } from "vitest";
import { themePrerenderContentPluginSource } from "./theme-prerender-content";

// Real listeners, not DNS assumptions or mocked fetch. The prerender bridge
// must send SSR to the same loopback address family as Vite's listener.
it.each(["127.0.0.1", "::1"])(
  "fetches sealed content from a preview listening only on %s",
  async (host) => {
    type Middleware = (
      req: IncomingMessage,
      res: ServerResponse,
      next: (error?: Error) => void,
    ) => void;
    let middleware: Middleware | undefined;
    const server = createServer((req, res) => {
      middleware!(req, res, (error) => {
        res.setHeader("Content-Type", "application/json");
        if (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error.message }));
        } else
          res.end(
            JSON.stringify({ origin: req.headers["x-morph-content-origin"] }),
          );
      });
    });
    const plugin = new Function(
      "fs",
      "path",
      "process",
      `return (${themePrerenderContentPluginSource("/workspace")});`,
    )(
      {
        readFileSync: () =>
          JSON.stringify({
            "/landing": {
              slots: { hero: { title: "Frozen" } },
              hiddenSlots: [],
            },
          }),
      },
      { join: (...parts: string[]) => parts.join("/") },
      { env: { TSS_PRERENDERING: "true" } },
    );
    plugin.configurePreviewServer({
      httpServer: server,
      middlewares: {
        use: (handler: Middleware) => {
          middleware = handler;
        },
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host, port: 0, ipv6Only: host === "::1" }, resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP listener");
      const directOrigin = `http://${host === "::1" ? "[::1]" : host}:${address.port}`;
      const page = await fetch(`${directOrigin}/landing`, {
        signal: AbortSignal.timeout(3000),
      });
      expect(page.status).toBe(200);
      const { origin } = (await page.json()) as { origin: string };
      expect(origin).toBe(directOrigin);
      const content = await fetch(`${origin}/_morph/content?path=/landing`, {
        signal: AbortSignal.timeout(3000),
      });
      expect(content.status).toBe(200);
      expect(await content.json()).toEqual({
        slots: { hero: { title: "Frozen" } },
        hiddenSlots: [],
      });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    }
  },
);

// Start reports a failed prerender fetch without reading its body, and Vite's
// default handler answers a failure with a bare "Internal Server Error". The
// plugin's handler, installed after every plugin's own middleware, says what
// failed in the build's output and in the response.
it("reports a request that fails on the prerender server, with its cause", async () => {
  type Handler = (...args: never[]) => void;
  const stack: Handler[] = [];
  const written: string[] = [];
  const server = createServer((req, res) => {
    let index = 0;
    const next = (error?: Error): void => {
      const handler = stack[index++] as
        | ((...args: unknown[]) => void)
        | undefined;
      if (!handler) {
        res.statusCode = error ? 500 : 404;
        res.end("Internal Server Error");
      } else if (error && handler.length === 4) handler(error, req, res, next);
      else if (!error && handler.length < 4) handler(req, res, next);
      else next(error);
    };
    next();
  });
  const plugin = new Function(
    "fs",
    "path",
    "process",
    `return (${themePrerenderContentPluginSource("/workspace")});`,
  )(
    { readFileSync: () => "{}" },
    { join: (...parts: string[]) => parts.join("/") },
    {
      env: { TSS_PRERENDERING: "true" },
      stderr: { write: (text: string) => written.push(text) },
    },
  );
  const middlewares = { use: (handler: Handler) => stack.push(handler) };
  const postHook = plugin.configurePreviewServer({
    httpServer: server,
    middlewares,
  });
  // Another plugin's middleware — the Worker's, in a real build — fails the
  // way a Miniflare that could not start does.
  middlewares.use(((
    _req: IncomingMessage,
    _res: ServerResponse,
    next: (error?: Error) => void,
  ) => {
    next(new Error("listen EADDRINUSE: address already in use 127.0.0.1:9233"));
  }) as Handler);
  postHook();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0 }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP listener");
    const page = await fetch(`http://127.0.0.1:${address.port}/landing/`, {
      signal: AbortSignal.timeout(3000),
    });
    expect(page.status).toBe(500);
    const body = await page.text();
    expect(body).toContain("PRERENDER_SERVER_ERROR");
    expect(body).toContain("EADDRINUSE");
    expect(written.join("")).toContain(
      "PRERENDER_SERVER_ERROR: GET /landing/: Error: listen EADDRINUSE",
    );
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
});
