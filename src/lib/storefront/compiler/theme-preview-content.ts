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

export type ThemePreviewContentSnapshot = Readonly<{
  templates: Partial<
    Record<Exclude<StorefrontTemplateType, "layout">, StorefrontContentResult>
  >;
  pages: Readonly<Record<string, StorefrontContentResult>>;
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
    document: StorefrontPageDocument;
  }[];
  pages?: readonly { handle: string; document: StorefrontPageDocument }[];
}): Promise<ThemePreviewContentSnapshot> {
  const templateDocuments = new Map(
    args.templates.map((template) => [template.type, template.document]),
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

  return { templates, pages };
}

/** Source installed only in a preview workspace. */
export function themePreviewContentModuleSource(
  snapshot: ThemePreviewContentSnapshot,
): string {
  return `import {
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
  readPreviewRuntimeChannel,
} from "./preview/preview-protocol";

const snapshot = ${JSON.stringify(snapshot)};
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
  return (type && snapshot.templates[type]) || { slots: {}, hiddenSlots: [] };
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

/** Vite middleware source for the initial route load, before the bridge runs. */
export function themePreviewContentPluginSource(
  snapshot: ThemePreviewContentSnapshot,
): string {
  const source = themePreviewContentModuleSource(snapshot);
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
    const snapshot = ${JSON.stringify(snapshot)};
    ${resolver}
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || "/", "http://preview.invalid");
      if (url.pathname !== ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)}) return next();
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(previewContentForPath(url.searchParams.get("path") || "/")));
    });
  },
}`;
}
