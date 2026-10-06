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
