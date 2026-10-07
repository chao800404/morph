import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import {
  resolveStorefrontContent,
  templateTypeForPath,
  type StorefrontContentResult,
} from "../service/storefront-content-runtime";
import type { ThemeRouteRegistry } from "./theme-route-registry";
import { isStaticPageRoute, themePrerenderOptions } from "./theme-prerender";
import { THEME_PRERENDER_CONTENT_DATA_RELATIVE_PATH } from "./theme-workspace-path";
import { frozenContentRoute } from "./theme-build-content-route";
import { isStorefrontTemplateType } from "../dto/storefront-content-publication.dto";
import type { StorefrontTemplateType } from "@/db/storefront.schema";

export const THEME_PRERENDER_CONTENT_FILE =
  THEME_PRERENDER_CONTENT_DATA_RELATIVE_PATH;
export type ThemePrerenderContent = Readonly<
  Record<string, StorefrontContentResult>
>;

/**
 * Where a native build's prerender records each content read it could not
 * answer, one JSON line per read. Read back by `nativeBuildResult`, which
 * fails the build if it exists.
 */
export const NATIVE_PRERENDER_REFUSED_READS_PATH =
  ".morph/prerender-refused-reads.ndjson";

/**
 * What a native build's prerender may read from Morph's content endpoint.
 *
 * Whether to prerender is the project's own config's to say, not the CMS
 * render policy's, so every static route's content is sealed here rather
 * than only the pages the CMS marks SSG. A read this cannot answer is
 * refused and recorded, never answered with nothing: the Theme falls back to
 * component defaults on a failed read, and static HTML built that way would
 * publish defaults in place of the author's content.
 */
export type NativePrerenderContent = Readonly<{
  /** Each static route's content, from the build's sealed snapshot only. */
  content: Readonly<Record<string, StorefrontContentResult>>;
  /** Why a static route has no content here. */
  unavailable: Readonly<Record<string, string>>;
  /** Why no route has content: no snapshot, or one Core alone can read. */
  refusedAll?: string;
}>;

/** A native build with no sealed content: every content read is refused. */
export const NATIVE_PRERENDER_WITHOUT_SNAPSHOT: NativePrerenderContent = {
  content: {},
  unavailable: {},
  refusedAll:
    "NATIVE_PRERENDER_NO_CONTENT_SNAPSHOT: this build has no sealed content",
};

/**
 * Resolves a path's content from the sealed snapshot only, with the public
 * content resolver. Legacy unmapped content is refused, never assigned using
 * current draft rows; so is a path whose document's role the snapshot cannot
 * prove. Throws for the first while being built and for the second per path.
 */
function assertSnapshotTemplateTypes(
  snapshot: ThemeBuildContentSnapshot | undefined,
) {
  for (const { item } of snapshot?.documents ?? []) {
    if (
      item.metadata?.templateType !== undefined &&
      (item.itemType !== "template" ||
        !isStorefrontTemplateType(item.metadata.templateType))
    )
      throw new Error("SSG_INVALID_TEMPLATE_TYPE");
  }
}

function sealedContentResolver(snapshot: ThemeBuildContentSnapshot) {
  assertSnapshotTemplateTypes(snapshot);
  const layout =
    snapshot.documents.find(
      ({ item, document }) =>
        item.metadata?.templateType === "layout" ||
        document.websiteRenderPolicy !== undefined,
    )?.document ?? null;
  const byPath = new Map(
    snapshot.documents.flatMap(({ item, document }) => {
      if (document === layout) return [];
      const path = frozenContentRoute(item);
      if (!path) {
        if (
          item.itemType === "template" &&
          isStorefrontTemplateType(item.metadata?.templateType)
        )
          return [];
        if (document.sections.length)
          throw new Error(
            "SSG_CONTENT_ROUTE_REQUIRED: Content needs an immutable route or layout reference.",
          );
        return [];
      }
      return [[path, document] as const];
    }),
  );
  const byType = new Map<StorefrontTemplateType, typeof layout>();
  for (const { item, document } of snapshot.documents) {
    const type = item.metadata?.templateType;
    if (item.itemType !== "template" || item.metadata?.routePath || !type)
      continue;
    if (!isStorefrontTemplateType(type))
      throw new Error("SSG_INVALID_TEMPLATE_TYPE");
    if (byType.has(type)) throw new Error("SSG_DUPLICATE_TEMPLATE_TYPE");
    byType.set(type, document);
  }
  return async (path: string): Promise<StorefrontContentResult> => {
    // A concrete route reference alone does not prove the role of a generic
    // product/page/blog template. Do not render a different document than Core.
    const type = templateTypeForPath(path);
    const owner = snapshot.documents.find(
      ({ item }) => frozenContentRoute(item) === path,
    )?.item;
    if (
      type &&
      byPath.get(path)?.sections.length &&
      owner?.itemType === "template" &&
      owner.metadata?.routePath &&
      (type !== "index" ||
        (owner.metadata.templateType &&
          owner.metadata.templateType !== "index"))
    )
      throw new Error("SSG_CONTENT_TEMPLATE_IDENTITY_REQUIRED");
    return resolveStorefrontContent({
      publicationId: snapshot.publicationId,
      pathname: path,
      ports: {
        getPublishedDocument: async ({ templateType }) =>
          templateType === "layout"
            ? layout
            : byType.has(templateType)
              ? (byType.get(templateType) ?? null)
              : path === "/" && templateType === "index"
                ? (byPath.get(path) ?? null)
                : null,
        getPublishedRouteDocument: async ({ routePath }) =>
          byPath.get(routePath) ?? null,
        getPublishedPageDocument: async () => byPath.get(path) ?? null,
      },
    });
  };
}

/** The content of the pages the CMS marks SSG, for a platform build. */
export async function createThemePrerenderContent(
  snapshot: ThemeBuildContentSnapshot | undefined,
  registry: ThemeRouteRegistry,
): Promise<ThemePrerenderContent | undefined> {
  assertSnapshotTemplateTypes(snapshot);
  const options = themePrerenderOptions(snapshot, registry, true);
  if (!snapshot || !options) return undefined;
  const resolve = sealedContentResolver(snapshot);
  const result: Record<string, StorefrontContentResult> = {};
  for (const { path } of options.pages) {
    result[path] = await resolve(path);
  }
  return result;
}

/** The content a native build's prerender may read (`NativePrerenderContent`). */
export async function createNativePrerenderContent(
  snapshot: ThemeBuildContentSnapshot | undefined,
  registry: ThemeRouteRegistry | null,
): Promise<NativePrerenderContent> {
  if (!snapshot) return NATIVE_PRERENDER_WITHOUT_SNAPSHOT;
  if (!registry) {
    return {
      content: {},
      unavailable: {},
      refusedAll:
        "NATIVE_PRERENDER_NO_ROUTES: the Theme's routes could not be read",
    };
  }
  let resolve: ReturnType<typeof sealedContentResolver>;
  try {
    resolve = sealedContentResolver(snapshot);
  } catch (error) {
    return {
      content: {},
      unavailable: {},
      refusedAll: error instanceof Error ? error.message : String(error),
    };
  }
  const content: Record<string, StorefrontContentResult> = {};
  const unavailable: Record<string, string> = {};
  for (const route of registry.routes) {
    if (!isStaticPageRoute(route)) continue;
    try {
      content[route.path] = await resolve(route.path);
    } catch (error) {
      unavailable[route.path] =
        error instanceof Error ? error.message : String(error);
    }
  }
  return { content, unavailable };
}

/** Node preview middleware only: neither the snapshot nor this plugin belongs
 * to the compiled Worker. The same endpoint/header contract is used in Core.
 *
 * With `refusedReadsPath` (a native build), the content file is a
 * `NativePrerenderContent` and each read it cannot answer is appended there;
 * without it (a platform build), the file maps paths to content and a read it
 * cannot answer is a plain 404.
 */
export function themePrerenderContentPluginSource(
  root: string,
  options: Readonly<{ refusedReadsPath?: string }> = {},
): string {
  const contentFile = `path.join(${JSON.stringify(root)}, ${JSON.stringify(THEME_PRERENDER_CONTENT_FILE)})`;
  const load = options.refusedReadsPath
    ? `const sealed = JSON.parse(fs.readFileSync(${contentFile}, "utf8"));
      const content = sealed.content;
      const refusedReads = path.join(${JSON.stringify(root)}, ${JSON.stringify(options.refusedReadsPath)});`
    : `const content = JSON.parse(fs.readFileSync(${contentFile}, "utf8"));`;
  const refuse = options.refusedReadsPath
    ? `if (req.method === "GET") {
              const reason = sealed.refusedAll || (Object.hasOwn(sealed.unavailable, pathname) ? sealed.unavailable[pathname] : "NATIVE_PRERENDER_PATH_NOT_SEALED: no static route of this build has this path");
              fs.mkdirSync(path.dirname(refusedReads), { recursive: true });
              fs.appendFileSync(refusedReads, JSON.stringify({ path: pathname, reason }) + "\\n");
            }
            res.statusCode = 404; res.end(); return;`
    : `res.statusCode = 404; res.end(); return;`;
  return `{
    name: "morph:frozen-prerender-content",
    enforce: "pre",
    configurePreviewServer(server) {
      if (process.env.TSS_PRERENDERING !== "true") return;
      ${load}
      server.middlewares.use((req, res, next) => {
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") return next(new Error("SSG_CONTENT_SERVER_UNAVAILABLE"));
        // Vite binds localhost using the host's DNS order. In CI this can
        // be IPv6-only; an IPv4 origin then silently loses sealed content.
        // Use the actual listener, never the incoming Host or Theme headers.
        const host = address.address === "::" || address.address === "::1"
          ? "[::1]"
          : address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
        if (typeof host !== "string" ||
            (host !== "[::1]" && !/^127[.][0-9]+[.][0-9]+[.][0-9]+$/.test(host)) ||
            !Number.isInteger(address.port) || address.port < 1 || address.port > 65535)
          return next(new Error("SSG_CONTENT_LOOPBACK_REQUIRED"));
        const origin = "http://" + host + ":" + address.port;
        const url = new URL(req.url || "/", origin);
        if (url.pathname === "/_morph/content") {
          const pathname = url.searchParams.get("path") || "/";
          if (req.method !== "GET" || !Object.hasOwn(content, pathname)) {
            ${refuse}
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(content[pathname]));
          return;
        }
        req.headers["x-morph-content-origin"] = origin;
        // Cloudflare's Node request adapter reads rawHeaders, not headers.
        const raw = [];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          if (req.rawHeaders[i].toLowerCase() !== "x-morph-content-origin") raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
        }
        req.rawHeaders = [...raw, "x-morph-content-origin", origin];
        next();
      });
      // After every plugin's own middleware, the Worker's among them: a
      // request that fails on this server says why, in the build's output and
      // in the response, rather than as the default handler's bare 500 page,
      // which Start reports without reading.
      return () => {
        server.middlewares.use((error, req, res, next) => {
          const detail = (error && (error.stack || String(error))) || "unknown error";
          process.stderr.write("PRERENDER_SERVER_ERROR: " + req.method + " " + req.url + ": " + detail + "\\n");
          if (res.headersSent) return next(error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("PRERENDER_SERVER_ERROR: " + detail);
        });
      };
    }
  }`;
}
