import type { ThemeBuildContentSnapshot } from "../dto/storefront-theme-build.dto";
import {
  resolveStorefrontContent,
  templateTypeForPath,
  type StorefrontContentResult,
} from "../service/storefront-content-runtime";
import type { ThemeRouteRegistry } from "./theme-route-registry";
import { themePrerenderOptions } from "./theme-prerender";
import { THEME_PRERENDER_CONTENT_DATA_RELATIVE_PATH } from "./theme-workspace-path";
import { frozenContentRoute } from "./theme-build-content-route";
import { isStorefrontTemplateType } from "../dto/storefront-content-publication.dto";
import type { StorefrontTemplateType } from "@/db/storefront.schema";

export const THEME_PRERENDER_CONTENT_FILE =
  THEME_PRERENDER_CONTENT_DATA_RELATIVE_PATH;
export type ThemePrerenderContent = Readonly<
  Record<string, StorefrontContentResult>
>;

/** Reuse the public content resolver, with ports restricted to sealed input.
 * Legacy unmapped content is refused, never assigned using current draft rows.
 */
export async function createThemePrerenderContent(
  snapshot: ThemeBuildContentSnapshot | undefined,
  registry: ThemeRouteRegistry,
): Promise<ThemePrerenderContent | undefined> {
  for (const { item } of snapshot?.documents ?? []) {
    if (
      item.metadata?.templateType !== undefined &&
      (item.itemType !== "template" ||
        !isStorefrontTemplateType(item.metadata.templateType))
    )
      throw new Error("SSG_INVALID_TEMPLATE_TYPE");
  }
  const options = themePrerenderOptions(snapshot, registry, true);
  if (!snapshot || !options) return undefined;
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
  const result: Record<string, StorefrontContentResult> = {};
  for (const { path } of options.pages) {
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
    result[path] = await resolveStorefrontContent({
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
  }
  return result;
}

/** Node preview middleware only: neither the snapshot nor this plugin belongs
 * to the compiled Worker. The same endpoint/header contract is used in Core.
 */
export function themePrerenderContentPluginSource(root: string): string {
  return `{
    name: "morph:frozen-prerender-content",
    enforce: "pre",
    configurePreviewServer(server) {
      if (process.env.TSS_PRERENDERING !== "true") return;
      const content = JSON.parse(fs.readFileSync(path.join(${JSON.stringify(root)}, ${JSON.stringify(THEME_PRERENDER_CONTENT_FILE)}), "utf8"));
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
          if (req.method !== "GET" || !Object.hasOwn(content, pathname)) { res.statusCode = 404; res.end(); return; }
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
    }
  }`;
}
