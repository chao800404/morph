import { THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH } from "./theme-workspace-path";
import type {
  StorefrontPageDocument,
  StorefrontTemplateType,
} from "@/db/storefront.schema";
import {
  resolveStorefrontContent,
  type StorefrontContentResult,
} from "@/lib/storefront/service/storefront-content-runtime";

export const THEME_PREVIEW_CONTENT_PATH = "/_morph/content";
export const THEME_PREVIEW_CONTENT_MODULE_PATH = "src/morph/preview-content.ts";
/**
 * The draft content a page loads with, apart from the code that serves it.
 *
 * Content changes far more often than the preview's code, and one preview
 * container serves every tab its author has open. Kept in its own module, a
 * newer snapshot written when another tab starts the preview is a data update
 * those pages accept and ignore, rather than a code change that reloads them.
 */
export const THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH =
  "src/morph/preview-content-snapshot.ts";
/**
 * The same snapshot for the dev server's own content endpoint, read on each
 * request. Outside the module graph, so rewriting it reloads nothing; and not
 * inlined in the Vite config any more, so a content change is not a config
 * change that restarts the server.
 */
export { THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH };

const EMPTY_PREVIEW_CONTENT = { templates: {}, pages: {} } as const;

export type ThemePreviewContentSnapshot = Readonly<{
  templates: Partial<
    Record<Exclude<StorefrontTemplateType, "layout">, StorefrontContentResult>
  >;
  pages: Readonly<Record<string, StorefrontContentResult>>;
  /** Content of the static routes that own a document, by route path. */
  routes?: Readonly<Record<string, StorefrontContentResult>>;
  /**
   * Content of a path nothing else describes: the shell's alone.
   *
   * The runtime serves the layout's header and footer values to every path,
   * including one with no document of its own; the preview answered such a
   * path with nothing at all, so the shell rendered its defaults there.
   */
  shell?: StorefrontContentResult;
}>;

const ROUTE_TEMPLATE_TYPES = [
  "index",
  "product",
  "collection",
  "page",
  "blog",
] as const;

/**
 * Resolves only the authenticated author's draft documents before they cross
 * into the untrusted preview container. The snapshot contains render DTOs,
 * never a database capability, session cookie, or storage credential.
 */
export async function createThemePreviewContentSnapshot(args: {
  templates: readonly {
    type: StorefrontTemplateType;
    /** Set for a document one static route owns. */
    routePath?: string | null;
    document: StorefrontPageDocument;
  }[];
  pages?: readonly { handle: string; document: StorefrontPageDocument }[];
}): Promise<ThemePreviewContentSnapshot> {
  // Kept apart: a route's own document is typed `page`, and in the by-type map
  // it would stand in for every page — or be replaced by the one that does.
  const templateDocuments = new Map(
    args.templates
      .filter((template) => !template.routePath)
      .map((template) => [template.type, template.document]),
  );
  const routeDocuments = new Map(
    args.templates.flatMap((template) =>
      template.routePath ? [[template.routePath, template.document] as const] : [],
    ),
  );
  const pageDocuments = new Map(
    (args.pages ?? []).map((page) => [page.handle, page.document]),
  );
  const ports = {
    getPublishedDocument: async ({
      templateType,
    }: {
      publicationId: string;
      templateType: StorefrontTemplateType;
    }) => templateDocuments.get(templateType) ?? null,
    getPublishedPageDocument: async ({
      handle,
    }: {
      publicationId: string;
      handle: string;
    }) => pageDocuments.get(handle) ?? null,
    getPublishedRouteDocument: async ({
      routePath,
    }: {
      publicationId: string;
      routePath: string;
    }) => routeDocuments.get(routePath) ?? null,
  };

  const templates = Object.fromEntries(
    await Promise.all(
      ROUTE_TEMPLATE_TYPES.map(async (type) => [
        type,
        await resolveStorefrontContent({
          publicationId: "draft-preview",
          pathname:
            type === "index"
              ? "/"
              : `/${type === "collection" ? "collections" : `${type}s`}/preview`,
          ports,
        }),
      ]),
    ),
  ) as ThemePreviewContentSnapshot["templates"];

  const pages = Object.fromEntries(
    await Promise.all(
      [...pageDocuments.keys()].map(async (handle) => [
        handle,
        await resolveStorefrontContent({
          publicationId: "draft-preview",
          pathname: `/pages/${encodeURIComponent(handle)}`,
          ports,
        }),
      ]),
    ),
  );

  const routes = Object.fromEntries(
    await Promise.all(
      [...routeDocuments.keys()].map(async (routePath) => [
        routePath,
        await resolveStorefrontContent({
          publicationId: "draft-preview",
          pathname: routePath,
          ports,
        }),
      ]),
    ),
  );

  // A path no type and no route document describes: what remains is the shell.
  const shell = await resolveStorefrontContent({
    publicationId: "draft-preview",
    pathname: "/__morph-preview-unmapped__",
    ports: { ...ports, getPublishedRouteDocument: async () => null },
  });

  return { templates, pages, routes, shell };
}

/** The snapshot module a preview page loads its initial content from. */
export function themePreviewContentSnapshotModuleSource(
  snapshot: ThemePreviewContentSnapshot = EMPTY_PREVIEW_CONTENT,
): string {
  return `export default ${JSON.stringify(snapshot)};\n`;
}

/** The snapshot as the dev server's content endpoint reads it. */
export function themePreviewContentDataSource(
  snapshot: ThemePreviewContentSnapshot = EMPTY_PREVIEW_CONTENT,
): string {
  return JSON.stringify(snapshot);
}

/**
 * Source installed only in a preview workspace. It holds no content itself,
 * so it is the same for every snapshot and never changes with one.
 */
export function themePreviewContentModuleSource(): string {
  return `import {
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
  readPreviewRuntimeChannel,
} from "./preview/preview-protocol";
import initialSnapshot from "./preview-content-snapshot";

// A page keeps the snapshot it loaded with: the author's live edits are applied
// to it, and replacing it would throw them away. A newer snapshot is written
// when another tab starts this shared preview, and it is for pages loaded
// after that — so the update is accepted here and deliberately not applied,
// which also keeps it from reloading this page.
const snapshot = initialSnapshot;
if (import.meta.hot) {
  import.meta.hot.accept("./preview-content-snapshot", () => {});
}
const previewChannel = readPreviewRuntimeChannel(window.location.href);
const pendingCatalogRequests = new Map();
let nextCatalogRequestId = 0;

function templateTypeForPath(pathname) {
  const normalized = (pathname || "/").split("?")[0].replace(/\\/+$/, "") || "/";
  if (normalized === "/") return "index";
  if (normalized.startsWith("/products/")) return "product";
  if (normalized.startsWith("/collections/")) return "collection";
  if (normalized.startsWith("/blogs/")) return "blog";
  if (normalized.startsWith("/pages/")) return "page";
  return null;
}

function pageHandleForPath(pathname) {
  const normalized = (pathname || "/").split("?")[0].replace(/\\/+$/, "") || "/";
  if (!normalized.startsWith("/pages/")) return null;
  const handle = normalized.slice("/pages/".length);
  return handle && !handle.includes("/") ? decodeURIComponent(handle) : null;
}

export function previewContentForPath(pathname) {
  const handle = pageHandleForPath(pathname);
  if (handle && snapshot.pages[handle]) return snapshot.pages[handle];
  const type = templateTypeForPath(pathname);
  if (type) return snapshot.templates[type] || { slots: {}, hiddenSlots: [] };
  const routes = snapshot.routes || (snapshot.routes = {});
  const routePath = (pathname || "/").split("?")[0].replace(/\\/+$/, "") || "/";
  // Created per path from the shell, so a live edit on one route never leaks
  // into another that has no document of its own.
  if (!routes[routePath]) {
    const shell = snapshot.shell || { slots: {}, hiddenSlots: [] };
    routes[routePath] = { slots: { ...shell.slots }, hiddenSlots: [...shell.hiddenSlots] };
  }
  return routes[routePath];
}

export function updatePreviewContent(sectionId, props, enabled) {
  const content = previewContentForPath(window.__morphPreviewRouter?.state?.location?.pathname || "/");
  if (enabled === false) {
    delete content.slots[sectionId];
    if (!content.hiddenSlots.includes(sectionId)) content.hiddenSlots.push(sectionId);
    return;
  }
  if (enabled === true) {
    content.hiddenSlots = content.hiddenSlots.filter((id) => id !== sectionId);
  }
  if (props) content.slots[sectionId] = { ...(content.slots[sectionId] || {}), ...props };
}

const nativeFetch = window.fetch.bind(window);
window.addEventListener("message", (event) => {
  const message = parseEditorToPreviewWindowEvent(event);
  if (message?.type !== "morph:storefront-preview-catalog-response") return;
  const pending = pendingCatalogRequests.get(message.requestId);
  if (!pending) return;
  pendingCatalogRequests.delete(message.requestId);
  window.clearTimeout(pending.timeout);
  pending.resolve(new Response(JSON.stringify(message.body), {
    status: message.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  }));
});

window.fetch = (input, init) => {
  const requestUrl = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const requestMethod = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (requestUrl.origin === window.location.origin && requestUrl.pathname === ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)}) {
    return Promise.resolve(new Response(JSON.stringify(previewContentForPath(requestUrl.searchParams.get("path") || "/")), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    }));
  }
  const catalogMatch = requestUrl.origin === window.location.origin
    ? /^\\/api\\/store\\/products(?:\\/([^/]+))?\\/?$/.exec(requestUrl.pathname)
    : null;
  if (catalogMatch && previewChannel && requestMethod === "GET") {
    const pageValue = Number(requestUrl.searchParams.get("page") || "1");
    const page = Number.isSafeInteger(pageValue) && pageValue >= 1 && pageValue <= 10_000 ? pageValue : 1;
    let handle;
    try {
      handle = catalogMatch[1] ? decodeURIComponent(catalogMatch[1]) : undefined;
    } catch {
      return Promise.resolve(new Response(JSON.stringify({ error: "Invalid product handle" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
    if (handle && handle.length > 200) {
      return Promise.resolve(new Response(JSON.stringify({ error: "Invalid product handle" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      }));
    }
    nextCatalogRequestId = nextCatalogRequestId >= Number.MAX_SAFE_INTEGER ? 1 : nextCatalogRequestId + 1;
    const requestId = nextCatalogRequestId;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingCatalogRequests.delete(requestId);
        reject(new Error("Catalog preview request timed out."));
      }, 15_000);
      pendingCatalogRequests.set(requestId, { resolve, reject, timeout });
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-catalog-request",
        requestId,
        page,
        ...(handle ? { handle } : {}),
      }, previewChannel);
    });
  }
  return nativeFetch(input, init);
};
`;
}

/**
 * Vite middleware source for the initial route load, before the bridge runs.
 *
 * Reads the snapshot from the workspace on each request rather than carrying
 * it: inlined, every content change was a change to the Vite config itself.
 * The generated config imports `fs` and `path`.
 */
export function themePreviewContentPluginSource(): string {
  const source = themePreviewContentModuleSource();
  const bodyStart = source.indexOf("function templateTypeForPath");
  const bodyEnd = source.indexOf("export function updatePreviewContent");
  const resolver = source
    .slice(bodyStart, bodyEnd)
    .replace(
      "export function previewContentForPath",
      "function previewContentForPath",
    );
  return `{
  name: "morph-preview-content",
  configureServer(server) {
    const dataPath = path.join(server.config.root, ${JSON.stringify(THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH)});
    let snapshot = ${JSON.stringify(EMPTY_PREVIEW_CONTENT)};
    ${resolver}
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || "/", "http://preview.invalid");
      if (url.pathname !== ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)}) return next();
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      try {
        snapshot = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      } catch {
        snapshot = ${JSON.stringify(EMPTY_PREVIEW_CONTENT)};
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(previewContentForPath(url.searchParams.get("path") || "/")));
    });
  },
}`;
}
