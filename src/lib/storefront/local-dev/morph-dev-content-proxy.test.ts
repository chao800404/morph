// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMorphDevContentProxyHandler,
  morphDevContentProxy,
} from "./morph-dev-content-proxy";

type Recorded = { url: string; headers: IncomingHttpHeaders };

const servers: Server[] = [];

async function listen(
  handler: Parameters<typeof createServer>[1],
): Promise<{ origin: string; server: Server }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, server };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

const published = JSON.stringify({
  slots: { hero: { heading: "Published" } },
  hiddenSlots: [],
});

/** A stand-in for Core: records what it was asked and answers as told. */
async function fakeCore(
  answer: (req: Recorded) => {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  } = () => ({}),
) {
  const requests: Recorded[] = [];
  const { origin } = await listen((req, res) => {
    const recorded = { url: req.url ?? "", headers: req.headers };
    requests.push(recorded);
    const { status = 200, headers, body = published } = answer(recorded);
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(body);
  });
  return { origin, requests };
}

/** The dev server: the proxy, then a 404 where the framework would take over. */
async function devServer(options: Parameters<typeof createMorphDevContentProxyHandler>[0]) {
  const handler = createMorphDevContentProxyHandler({ log: () => {}, ...options });
  const { origin } = await listen((req, res) => {
    handler(req, res, () => {
      res.writeHead(404, { "x-handled-by": "framework" });
      res.end("framework");
    }).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  return origin;
}

const get = (base: string, path: string, init: RequestInit = {}) =>
  fetch(base + path, init);

describe("morph dev content proxy", () => {
  it("answers the content route with the store's published content", async () => {
    const core = await fakeCore();
    const dev = await devServer({ origin: core.origin });

    const response = await get(dev, "/_morph/content?path=%2Fhome");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(published));
    expect(core.requests.map((r) => r.url)).toEqual([
      "/_morph/content?path=%2Fhome",
    ]);
  });

  it("builds the request from nothing but accept", async () => {
    const core = await fakeCore();
    const dev = await devServer({ origin: core.origin });

    await get(dev, "/_morph/content?path=%2F", {
      headers: {
        cookie: "session=secret",
        authorization: "Bearer secret",
        "x-morph-content-origin": "https://elsewhere.example",
        "x-morph-anything": "1",
        referer: "http://localhost:5173/private",
        origin: "http://localhost:5173",
        "x-forwarded-for": "10.0.0.1",
      },
    });

    const received = Object.keys(core.requests[0]!.headers);
    for (const forbidden of [
      "cookie",
      "authorization",
      "x-morph-content-origin",
      "x-morph-anything",
      "referer",
      "origin",
      "x-forwarded-for",
    ]) {
      expect(received).not.toContain(forbidden);
    }
    expect(core.requests[0]!.headers.accept).toBe("application/json");
    // The Host the store sees is its own, not the dev server's.
    expect(core.requests[0]!.headers.host).toBe(new URL(core.origin).host);
  });

  it("sends to the configured store whatever the request says", async () => {
    const core = await fakeCore();
    const decoy = await fakeCore();
    const dev = await devServer({ origin: core.origin });

    await get(
      dev,
      `/_morph/content?path=%2F&origin=${encodeURIComponent(decoy.origin)}`,
    ).then((r) => r.status);
    await get(dev, "/_morph/content?path=%2F", {
      headers: { host: new URL(decoy.origin).host },
    });

    expect(decoy.requests).toEqual([]);
  });

  it.each([
    ["no path", "/_morph/content"],
    ["a path that does not start with /", "/_morph/content?path=home"],
    ["an extra parameter", "/_morph/content?path=%2F&draft=1"],
    ["a repeated path", "/_morph/content?path=%2F&path=%2Fabout"],
    ["a very long path", `/_morph/content?path=%2F${"a".repeat(500)}`],
  ])("refuses %s before asking the store", async (_label, url) => {
    const core = await fakeCore();
    const dev = await devServer({ origin: core.origin });

    const response = await get(dev, url);

    expect(response.status).toBe(400);
    expect(core.requests).toEqual([]);
  });

  it("allows only GET on the content route", async () => {
    const core = await fakeCore();
    const dev = await devServer({ origin: core.origin });

    const response = await get(dev, "/_morph/content?path=%2F", {
      method: "POST",
      body: "x",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(core.requests).toEqual([]);
  });

  it("leaves every other route to the framework", async () => {
    const core = await fakeCore();
    const dev = await devServer({ origin: core.origin });

    for (const path of ["/", "/_morph/other", "/api/store/products", "/_morph/content/x"]) {
      const response = await get(dev, path);
      expect(response.headers.get("x-handled-by")).toBe("framework");
    }
    expect(core.requests).toEqual([]);
  });

  it("does not follow a redirect, even to another origin", async () => {
    const elsewhere = await fakeCore();
    const core = await fakeCore(() => ({
      status: 302,
      headers: { location: `${elsewhere.origin}/_morph/content?path=%2F` },
    }));
    const dev = await devServer({ origin: core.origin });

    const response = await get(dev, "/_morph/content?path=%2F");

    expect(response.status).toBe(502);
    expect(elsewhere.requests).toEqual([]);
  });

  it.each([
    ["an error answer", { status: 500, body: "boom" }, 502, "store_error"],
    ["a missing page", { status: 404, body: "boom" }, 404, "content_not_found"],
    [
      "an answer that is not JSON",
      { headers: { "content-type": "text/html" }, body: "boom <html>" },
      502,
      "invalid_response",
    ],
  ])(
    "names %s with a fixed code and none of what the store said",
    async (_label, answer, status, code) => {
      const core = await fakeCore(() => answer);
      const logged: string[] = [];
      const dev = await devServer({
        origin: core.origin,
        log: (message) => logged.push(message),
      });

      const response = await get(dev, "/_morph/content?path=%2Fsecret-page");
      const text = await response.text();

      expect(response.status).toBe(status);
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(["code", "message"]);
      expect(JSON.parse(text).code).toBe(code);
      // Nothing of the store: not its words, its address, or the page asked for.
      expect(text).not.toMatch(/boom|127\.0\.0\.1|secret-page|html/);
      // The terminal has the detail.
      expect(logged.join(" ")).toContain(core.origin);
    },
  );

  it("refuses a response larger than the limit, declared or streamed", async () => {
    const big = "x".repeat(2_000);
    const declared = await fakeCore(() => ({ body: big }));
    const streamed = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("y".repeat(1_500));
      res.end("y".repeat(1_500));
    });

    for (const origin of [declared.origin, streamed.origin]) {
      const dev = await devServer({ origin, maxBytes: 1_000 });
      const response = await get(dev, "/_morph/content?path=%2F");
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("too large");
    }
  });

  it("gives up on a store that does not answer", async () => {
    const silent = await listen(() => {
      /* never answers */
    });
    const dev = await devServer({ origin: silent.origin, timeoutMs: 100 });

    const response = await get(dev, "/_morph/content?path=%2F");

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(JSON.parse(body).code).toBe("store_unreachable");
    expect(body).not.toContain(silent.origin);
  });

  it("says plainly that no store is configured", async () => {
    const logged: string[] = [];
    const previous = process.env.MORPH_CONTENT_ORIGIN;
    delete process.env.MORPH_CONTENT_ORIGIN;
    try {
      const dev = await devServer({ log: (message) => logged.push(message) });

      const response = await get(dev, "/_morph/content?path=%2F");

      expect(response.status).toBe(503);
      expect(await response.text()).toContain("MORPH_CONTENT_ORIGIN");
      expect(logged.join(" ")).toContain("MORPH_CONTENT_ORIGIN");
    } finally {
      if (previous !== undefined) process.env.MORPH_CONTENT_ORIGIN = previous;
    }
  });

  it.each(["not a url", "ftp://store.example", "file:///etc/passwd"])(
    "refuses to start with %s as the store address",
    (origin) => {
      expect(() => createMorphDevContentProxyHandler({ origin })).toThrow(
        "MORPH_CONTENT_ORIGIN",
      );
    },
  );

  it("is a serve-only plugin", () => {
    expect(morphDevContentProxy({ origin: "https://store.example" }).apply).toBe(
      "serve",
    );
  });
});
