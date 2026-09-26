/**
 * The headers every SVG the platform serves for a Theme carries.
 *
 * An SVG shown through `<img>` runs no script, but the same file opened
 * directly, or embedded as a document, is a document of the site's own
 * origin, and can script it. So SVG responses are isolated where they are
 * sent, not only where they are accepted: a sandboxed CSP gives the document
 * an opaque origin and no script, and nothing it names is fetched. `<img>` is
 * unaffected — a resource's own CSP does not apply to how a page draws it.
 *
 * Applied on every path an SVG leaves by — the Live Preview's dev server and
 * its proxy, the artifact server behind build previews and the storefront,
 * the storefront's Theme Worker responses, and the Theme Worker's static
 * assets through a platform-written `_headers`. Theme `public/` still refuses
 * SVG; this is the layer that has to be in place before it may accept one,
 * and it already covers SVG in a Theme's source, which the server's text
 * write accepts outside public/ and a project import will bring in.
 */

export const SVG_ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
};

export function isSvgContentType(value: string | null | undefined): boolean {
  return /^\s*image\/svg\+xml\b/i.test(value ?? "");
}

/** The response with the isolation headers when it carries an SVG; otherwise itself. */
export function isolateSvgResponse(response: Response): Response {
  if (!isSvgContentType(response.headers.get("content-type"))) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SVG_ISOLATION_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * A `_headers` file for a static-assets directory giving every `.svg` the
 * isolation headers. Written by the platform at deploy; a Theme's own
 * `_headers` is never deployed. Cloudflare matches paths case-sensitively
 * and `*` across directories, so both spellings of the extension are named.
 */
export function svgIsolationHeadersFile(): string {
  const rules = Object.entries(SVG_ISOLATION_HEADERS)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join("\n");
  return ["/*.svg", rules, "/*.SVG", rules, ""].join("\n");
}

type NodeResponseLike = {
  writeHead: (statusCode: number, ...rest: unknown[]) => unknown;
  getHeader: (name: string) => unknown;
  setHeader: (name: string, value: string) => unknown;
};

/**
 * Connect middleware giving SVG responses the isolation headers, for the
 * Live Preview's Vite dev server.
 *
 * Self-contained, since the generated `vite.config.ts` embeds it through
 * `toString()`: it reads nothing but its arguments. It decides at
 * `writeHead`, where the type is known whichever middleware set it — Vite's
 * static server passes headers to `writeHead`, others set them before, and
 * Node's implicit header write goes through `writeHead` as well.
 */
export function isolateSvgNodeResponses(
  isolation: Readonly<Record<string, string>>,
  _request: unknown,
  response: NodeResponseLike,
  next: () => void,
): void {
  const writeHead = response.writeHead;
  response.writeHead = function (
    this: NodeResponseLike,
    statusCode: number,
    ...rest: unknown[]
  ) {
    const given = rest.find(
      (value) =>
        value !== null && typeof value === "object" && !Array.isArray(value),
    ) as Record<string, unknown> | undefined;
    let type = "";
    for (const key of Object.keys(given ?? {})) {
      if (key.toLowerCase() === "content-type") type = String(given![key]);
    }
    if (!type) type = String(this.getHeader("content-type") ?? "");
    if (/^\s*image\/svg\+xml\b/i.test(type)) {
      for (const [name, value] of Object.entries(isolation)) {
        // A header passed to writeHead would win over one set here.
        for (const key of Object.keys(given ?? {})) {
          if (key.toLowerCase() === name.toLowerCase()) delete given![key];
        }
        this.setHeader(name, value);
      }
    }
    return writeHead.call(this, statusCode, ...rest);
  };
  next();
}

/** The Vite plugin source the generated preview config embeds. */
export function svgIsolationVitePluginSource(): string {
  return `{
  name: "morph-preview-svg-isolation",
  configureServer(server) {
    const isolation = ${JSON.stringify(SVG_ISOLATION_HEADERS)};
    const isolate = ${isolateSvgNodeResponses.toString()};
    server.middlewares.use((req, res, next) => isolate(isolation, req, res, next));
  },
}`;
}
