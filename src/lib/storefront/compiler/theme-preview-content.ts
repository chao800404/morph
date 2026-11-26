import { THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH } from "./theme-workspace-path";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "./theme-preview-dev-server";
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

/**
 * How every Live Preview reader of the snapshot answers a path it cannot
 * speak for: the snapshot is missing, unreadable, not JSON, or holds no
 * well-formed entry for that path.
 *
 * Never empty content. A route with no Document is written into the snapshot
 * as its own empty entry, `{ slots: {}, hiddenSlots: [] }`, and is answered
 * with it; an answer the snapshot does not hold says nothing about the page,
 * not even which sections the author hid. Answered empty, the Starter 32
 * reader would accept it and render every hidden section with its defaults;
 * refused, it rejects and the router shows its error state. The body is the
 * `{ error }` shape the content endpoints already refuse with.
 */
export const THEME_PREVIEW_CONTENT_UNREADABLE_STATUS = 503;
export const THEME_PREVIEW_CONTENT_UNREADABLE_BODY = {
  error: "Live Preview content could not be read.",
} as const;

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
  /**
   * Where this snapshot stands among those written into one preview: the
   * ticket it was built under (`storefrontPreviewContentTicketDal`). A
   * preview keeps the highest it has been given. Absent is 0, every
   * snapshot from before tickets.
   */
  contentTicket?: number;
  /**
   * SHA-256 of the content itself (`previewContentBody`), bound to the
   * ticket: one ticket names exactly one content, and a preview refuses the
   * same ticket with any other (docs/astro-theme-plan.md 6.6).
   */
  contentHash?: string;
  /** The draft versions the content was read at, one consistent read. */
  contentVersions?: string;
  /**
   * Which dev server this file was written for: a nonce the transport
   * stamps when a server starts and on every content write. The preview's
   * Worker names it beside the ticket, from the same read, so a content
   * sync is confirmed only for the server it was written to, never by a
   * report about another (docs/astro-theme-plan.md 6.6).
   */
  previewInstance?: string;
}>;

/** A snapshot's fields that describe it rather than being content. */
const PREVIEW_CONTENT_META_KEYS = [
  "contentTicket",
  "contentHash",
  "contentVersions",
  "previewInstance",
] as const;

/** The snapshot text stamped with the dev server it is written for. */
export function withPreviewInstance(text: string, instance: string): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return JSON.stringify({ ...parsed, previewInstance: instance });
}

/** The ticket a written snapshot carries; 0 for none, or one unreadable. */
export function previewContentTicket(text: string | null): number {
  if (text === null) return 0;
  try {
    const ticket = (JSON.parse(text) as { contentTicket?: unknown })
      ?.contentTicket;
    return typeof ticket === "number" && Number.isSafeInteger(ticket) && ticket > 0
      ? ticket
      : 0;
  } catch {
    return 0;
  }
}

/**
 * The snapshot as content alone: the same text without its ticket, hash and
 * versions. Those order and identify writes; two snapshots that differ only
 * in them describe the same workspace (`themeWorkspaceFingerprint`), and
 * this is what the hash is taken over.
 */
export function previewContentWithoutTicket(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      PREVIEW_CONTENT_META_KEYS.some((key) => key in parsed)
    ) {
      const content = { ...parsed };
      for (const key of PREVIEW_CONTENT_META_KEYS) delete content[key];
      return JSON.stringify(content);
    }
  } catch {
    // Not a snapshot this can read: counted as it is.
  }
  return text;
}

/** The content hash a written snapshot carries, or null for none. */
export function previewContentHash(text: string | null): string | null {
  if (text === null) return null;
  try {
    const hash = (JSON.parse(text) as { contentHash?: unknown })?.contentHash;
    return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/**
 * SHA-256 of a snapshot's content (`previewContentWithoutTicket`), in hex.
 * Web Crypto, so Core in its Worker and the sidecar in Node take it alike.
 */
export async function previewContentDigest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(previewContentWithoutTicket(text));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
      template.routePath
        ? [[template.routePath, template.document] as const]
        : [],
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
  documentPreviewRuntimeChannel,
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
const previewChannel = documentPreviewRuntimeChannel();
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

/**
 * The page handle \`pathname\` names: null for a path that is not a page,
 * false for one whose handle is not a valid percent-escape (which no
 * snapshot can answer, so it is refused rather than thrown).
 */
function pageHandleForPath(pathname) {
  const normalized = (pathname || "/").split("?")[0].replace(/\\/+$/, "") || "/";
  if (!normalized.startsWith("/pages/")) return null;
  const handle = normalized.slice("/pages/".length);
  if (!handle || handle.includes("/")) return null;
  try {
    return decodeURIComponent(handle);
  } catch {
    return false;
  }
}

function isPreviewContentRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwnPreviewEntry(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Whether \`value\` is one path's content as Core writes it
 * (\`resolveStorefrontContent\`): its own \`slots\`, every value an object of
 * props, and its own \`hiddenSlots\`, a list of ids. Own fields only: in the
 * snapshot module a \`"__proto__"\` key would otherwise lend them.
 */
function isReadablePreviewContent(value) {
  if (
    !isPreviewContentRecord(value) ||
    !hasOwnPreviewEntry(value, "slots") ||
    !hasOwnPreviewEntry(value, "hiddenSlots") ||
    !isPreviewContentRecord(value.slots) ||
    !Array.isArray(value.hiddenSlots) ||
    !value.hiddenSlots.every((id) => typeof id === "string")
  ) {
    return false;
  }
  for (const id of Object.keys(value.slots)) {
    if (!isPreviewContentRecord(value.slots[id])) return false;
  }
  return true;
}

/** The template types Core writes an entry for in every snapshot. */
const PREVIEW_SNAPSHOT_TEMPLATE_TYPES = ["index", "product", "collection", "page", "blog"];

function isReadablePreviewEntries(record) {
  if (!isPreviewContentRecord(record)) return false;
  for (const key of Object.keys(record)) {
    if (!isReadablePreviewContent(record[key])) return false;
  }
  return true;
}

/**
 * Whether \`value\` is a whole snapshot as Core writes it
 * (\`createThemePreviewContentSnapshot\`): an entry for every template type,
 * the \`pages\` and \`routes\` maps, and the shell, each well formed. Anything
 * less is not "nothing stored" but a snapshot that cannot be read, and no
 * path is answered from it. The Start Worker's probe asks the same question
 * before it reports a snapshot as the one it serves.
 */
function isReadablePreviewSnapshot(value) {
  if (!isPreviewContentRecord(value)) return false;
  for (const key of ["templates", "pages", "routes", "shell"]) {
    if (!hasOwnPreviewEntry(value, key)) return false;
  }
  if (!isPreviewContentRecord(value.templates)) return false;
  for (const type of PREVIEW_SNAPSHOT_TEMPLATE_TYPES) {
    if (!hasOwnPreviewEntry(value.templates, type)) return false;
  }
  return isReadablePreviewEntries(value.templates) &&
    isReadablePreviewEntries(value.pages) &&
    isReadablePreviewEntries(value.routes) &&
    isReadablePreviewContent(value.shell);
}

/**
 * The content the snapshot holds for \`pathname\`, or null when it holds
 * none it can be read for.
 *
 * Core writes an entry for every template type and for the shell, empty for
 * a route with no Document (\`createThemePreviewContentSnapshot\`), so
 * "nothing stored" is an entry, read as it is. A snapshot that is not whole
 * and well formed (\`isReadablePreviewSnapshot\`), or a page handle that is
 * not a valid escape, is null and never empty content: answered empty, a
 * page would render the sections its author hid.
 */
export function previewContentForPath(pathname) {
  if (!isReadablePreviewSnapshot(snapshot)) return null;
  const handle = pageHandleForPath(pathname);
  if (handle === false) return null;
  // A page with a draft Document of its own; one without is the page template's.
  if (handle && hasOwnPreviewEntry(snapshot.pages, handle)) {
    return snapshot.pages[handle];
  }
  const type = templateTypeForPath(pathname);
  if (type) return snapshot.templates[type];
  const routes = snapshot.routes;
  const routePath = (pathname || "/").split("?")[0].replace(/\\/+$/, "") || "/";
  if (hasOwnPreviewEntry(routes, routePath)) return routes[routePath];
  // Created per path from the shell, so a live edit on one route never leaks
  // into another that has no document of its own.
  const shell = snapshot.shell;
  routes[routePath] = { slots: { ...shell.slots }, hiddenSlots: [...shell.hiddenSlots] };
  return routes[routePath];
}

export function updatePreviewContent(sectionId, props, enabled, resetKeys) {
  function previewValuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
      return false;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
      }
      for (let i = 0; i < left.length; i += 1) {
        if (!previewValuesEqual(left[i], right[i])) return false;
      }
      return true;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      if (!previewValuesEqual(left[key], right[key])) return false;
    }
    return true;
  }
  const content = currentPreviewContent();
  // A page whose content could not be read has nothing to apply an edit to.
  if (!content) return false;
  if (enabled === false) {
    const hadSlot = Object.prototype.hasOwnProperty.call(content.slots, sectionId);
    const wasHidden = content.hiddenSlots.includes(sectionId);
    delete content.slots[sectionId];
    if (!wasHidden) content.hiddenSlots.push(sectionId);
    return hadSlot || !wasHidden;
  }
  let changed = false;
  if (enabled === true) {
    if (content.hiddenSlots.includes(sectionId)) {
      content.hiddenSlots = content.hiddenSlots.filter((id) => id !== sectionId);
      changed = true;
    }
  } else if (content.hiddenSlots.includes(sectionId)) {
    // A hidden slot is written only by a show: a late edit, a signed repost
    // or a reset for it must not put its values back on this page.
    return false;
  }
  const previousSlot = content.slots[sectionId];
  let nextSlot = previousSlot;
  if (props) nextSlot = { ...(nextSlot || {}), ...props };
  if (Array.isArray(resetKeys) && nextSlot) {
    const next = { ...nextSlot };
    for (const key of resetKeys) delete next[key];
    nextSlot = next;
  }
  if (nextSlot !== previousSlot && !previewValuesEqual(previousSlot, nextSlot)) {
    content.slots[sectionId] = nextSlot;
    changed = true;
  }
  return changed;
}

// Below \`updatePreviewContent\`: the dev-server plugin copies the resolver
// above it, and these read the browser's page.
function currentPreviewPath() {
  return window.__morphPreviewRouter?.state?.location?.pathname ||
    (window.location.pathname.startsWith(${JSON.stringify(THEME_PREVIEW_SERVER_BASE_PATH)}) ? "/" : window.location.pathname) || "/";
}

/** Set only while \`livePreviewContentOverlay\` replays edits onto its copy. */
let previewContentTarget = null;

function currentPreviewContent() {
  return previewContentTarget || previewContentForPath(currentPreviewPath());
}

/**
 * The edits this page received, per exact path, in order: what
 * \`updatePreviewContent\` applied to that path's content. Kept apart from
 * the content itself only so they can be laid over another answer for the
 * same path (\`livePreviewContentOverlay\`); nothing else reads them.
 */
const livePreviewEdits = new Map();

// Every caller (the bridge, the Start client's early receiver) imports
// \`updatePreviewContent\`; its binding is replaced here, once, by one that
// also records the edit for its path. What it does to the page's content is
// the function above, unchanged.
const applyPreviewContentUpdate = updatePreviewContent;
updatePreviewContent = function updatePreviewContent(sectionId, props, enabled, resetKeys) {
  // An edit the page cannot apply, because its content could not be read, is
  // not recorded either: \`livePreviewContentOverlay\` would otherwise lay it
  // over a later answer the page never showed it on.
  if (!currentPreviewContent()) return false;
  recordLivePreviewEdit(sectionId, props, enabled, resetKeys);
  return applyPreviewContentUpdate(sectionId, props, enabled, resetKeys);
};

function livePreviewPathKey(pathname) {
  return (pathname || "/").split("?")[0].replace(/\\/+$/, "") || "/";
}

function recordLivePreviewEdit(sectionId, props, enabled, resetKeys) {
  const key = livePreviewPathKey(currentPreviewPath());
  const edits = livePreviewEdits.get(key) || [];
  const last = edits[edits.length - 1];
  const valuesOnly = enabled === undefined && !Array.isArray(resetKeys);
  // A run of value edits to one section is one edit with their values merged:
  // applying them in turn gives the same slot.
  if (
    props && valuesOnly && last && last.sectionId === sectionId &&
    last.props && last.enabled === undefined && !last.resetKeys
  ) {
    last.props = { ...last.props, ...structuredClone(props) };
  } else {
    edits.push({
      sectionId,
      props: props ? structuredClone(props) : undefined,
      enabled,
      resetKeys: Array.isArray(resetKeys) ? [...resetKeys] : undefined,
    });
  }
  livePreviewEdits.set(key, edits);
}

/**
 * Starter 32's client loader reads through a server function, which answers
 * from the saved drafts only, so this page's unsaved edits would not show.
 * Given what that read returned for \`pathname\`, this answers it with the
 * edits this page received for exactly that path laid over it, applied as
 * \`updatePreviewContent\` applied them here: a newer edit wins over a saved
 * older one, and saved values it did not touch stay. Null when the path has
 * no edit. A new object each time; nothing the caller does reaches the page's
 * own content. Read through the Start Live Preview's accessor only.
 */
export function livePreviewContentOverlay(pathname, base) {
  const edits = livePreviewEdits.get(livePreviewPathKey(pathname));
  if (!edits || edits.length === 0) return null;
  if (!base || typeof base !== "object" || !base.slots || !Array.isArray(base.hiddenSlots)) {
    return null;
  }
  const content = structuredClone({ slots: base.slots, hiddenSlots: base.hiddenSlots });
  previewContentTarget = content;
  try {
    for (const edit of edits) {
      applyPreviewContentUpdate(
        edit.sectionId,
        edit.props ? structuredClone(edit.props) : undefined,
        edit.enabled,
        edit.resetKeys,
      );
    }
  } finally {
    previewContentTarget = null;
  }
  return content;
}

/** The values this page's content holds for one slot, as it renders from them. */
export function previewSlotContent(sectionId) {
  const content = currentPreviewContent();
  return content ? content.slots[sectionId] : undefined;
}

/**
 * Whether this page holds a slot hidden: the list \`updatePreviewContent\`
 * refuses value writes for. Anything else that puts a value on the page asks
 * the same list. On a page whose content could not be read every slot counts
 * as hidden: "not hidden" is the answer that would bring a section back.
 */
export function previewSlotHidden(sectionId) {
  const content = currentPreviewContent();
  return content ? content.hiddenSlots.includes(sectionId) : true;
}

/** The answer to a content read for \`pathname\`: its content, or the refusal. */
function previewContentResponse(pathname) {
  let content = null;
  try {
    content = previewContentForPath(pathname);
  } catch {
    content = null;
  }
  return new Response(JSON.stringify(content || ${JSON.stringify(THEME_PREVIEW_CONTENT_UNREADABLE_BODY)}), {
    status: content ? 200 : ${THEME_PREVIEW_CONTENT_UNREADABLE_STATUS},
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
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
    return Promise.resolve(previewContentResponse(requestUrl.searchParams.get("path") || "/"));
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
    let snapshot = null;
    ${resolver}
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || "/", "http://preview.invalid");
      if (url.pathname !== ${JSON.stringify(THEME_PREVIEW_CONTENT_PATH)}) return next();
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      // Missing, unreadable or not JSON: no snapshot, so every path is
      // refused rather than answered empty (THEME_PREVIEW_CONTENT_UNREADABLE_BODY).
      try {
        snapshot = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      } catch {
        snapshot = null;
      }
      let content = null;
      try {
        content = previewContentForPath(url.searchParams.get("path") || "/");
      } catch {
        content = null;
      }
      res.statusCode = content ? 200 : ${THEME_PREVIEW_CONTENT_UNREADABLE_STATUS};
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(content || ${JSON.stringify(THEME_PREVIEW_CONTENT_UNREADABLE_BODY)}));
    });
  },
}`;
}
