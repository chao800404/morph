// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  isolateSvgNodeResponses,
  isolateSvgResponse,
  SVG_ISOLATION_HEADERS,
  svgIsolationHeadersFile,
  svgIsolationVitePluginSource,
} from "./theme-svg-isolation";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const CSP = SVG_ISOLATION_HEADERS["Content-Security-Policy"]!;

describe("isolateSvgResponse", () => {
  it("gives an SVG the isolation headers over any it had, keeping the rest", async () => {
    const isolated = isolateSvgResponse(
      new Response(SVG, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Security-Policy": "default-src *",
          "Cache-Control": "public, max-age=60",
        },
      }),
    );
    expect(isolated.headers.get("content-security-policy")).toBe(CSP);
    expect(isolated.headers.get("x-content-type-options")).toBe("nosniff");
    expect(isolated.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await isolated.text()).toBe(SVG);
  });

  it("leaves every other response as it is", () => {
    const html = new Response("<p>", {
      headers: { "Content-Type": "text/html" },
    });
    expect(isolateSvgResponse(html)).toBe(html);
    const none = new Response(null, { status: 304 });
    expect(isolateSvgResponse(none)).toBe(none);
  });
});

describe("svgIsolationHeadersFile", () => {
  it("names every .svg, in either case, with each header", () => {
    expect(svgIsolationHeadersFile()).toBe(
      [
        "/*.svg",
        `  Content-Security-Policy: ${CSP}`,
        "  X-Content-Type-Options: nosniff",
        "/*.SVG",
        `  Content-Security-Policy: ${CSP}`,
        "  X-Content-Type-Options: nosniff",
        "",
      ].join("\n"),
    );
  });
});

describe("the Live Preview middleware, as Node runs it", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  type Middleware = (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => void;

  async function serveThrough(
    middleware: Middleware,
    send: (response: ServerResponse) => void,
  ) {
    const server = createServer((request, response) =>
      middleware(request, response, () => send(response)),
    );
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}/logo.svg`);
  }

  const direct: Middleware = (request, response, next) =>
    isolateSvgNodeResponses(
      SVG_ISOLATION_HEADERS,
      request,
      response as never,
      next,
    );

  /** The plugin exactly as the generated vite.config.ts carries it. */
  function embedded(): Middleware {
    const plugin = new Function(
      `return (${svgIsolationVitePluginSource()});`,
    )();
    let middleware: Middleware | null = null;
    plugin.configureServer({
      middlewares: { use: (fn: Middleware) => (middleware = fn) },
    });
    return middleware!;
  }

  const ways: Record<string, (response: ServerResponse) => void> = {
    "headers passed to writeHead": (response) => {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(SVG);
    },
    "headers set before an implicit write": (response) => {
      response.setHeader("content-type", "image/svg+xml");
      response.end(SVG);
    },
    "a weaker policy passed to writeHead": (response) => {
      response.writeHead(200, "OK", {
        "content-type": "image/svg+xml; charset=utf-8",
        "content-security-policy": "default-src *",
      });
      response.end(SVG);
    },
  };

  for (const [label, middleware] of [
    ["the function", () => direct],
    ["the embedded source", embedded],
  ] as const) {
    for (const [way, send] of Object.entries(ways)) {
      it(`isolates an SVG sent with ${way}, through ${label}`, async () => {
        const response = await serveThrough(middleware(), send);
        expect(response.headers.get("content-security-policy")).toBe(CSP);
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.text()).toBe(SVG);
      });
    }

    it(`leaves other types alone, through ${label}`, async () => {
      const response = await serveThrough(middleware(), (res) => {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end("1");
      });
      expect(response.headers.get("content-security-policy")).toBeNull();
    });
  }
});
