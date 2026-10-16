import { MorphError, type MorphErrorResource } from "./errors";
import type {
  Morph,
  MorphFetch,
  MorphOptions,
  MorphPage,
  MorphProductList,
  MorphProductListParams,
  MorphProductResult,
} from "./types";
import { absolutizeMorphPaths } from "./urls";

const TIMEOUT_MS = 15_000;
/** The same cap as the local development proxy (`DEFAULT_MAX_BYTES`). */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PATH_LENGTH = 500;
const MAX_QUERY_LENGTH = 200;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;
const MAX_HANDLE_LENGTH = 255;
const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIST_PARAMS = new Set(["q", "page", "limit", "order"]);

type Answer = Readonly<{ status: number; ok: boolean; body: unknown }>;
/** A body that was not JSON. Kept apart from `null`, which is valid JSON. */
const NOT_JSON: unique symbol = Symbol("not json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * The origin every read goes to. Strict on purpose: an address with a path,
 * query, credentials or another scheme is refused rather than trimmed, so
 * the origin a site names is exactly the one it reads. The one exception is
 * a single trailing `/`, which names the same origin.
 */
function parseBaseUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new MorphError("invalid_content_origin", null);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MorphError("invalid_content_origin", null);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (value !== url.origin && value !== url.origin + "/")
  ) {
    throw new MorphError("invalid_content_origin", null);
  }
  return url.origin;
}

/**
 * Whether this code is running in a browser page.
 *
 * Pages are read on the server in v0: the content endpoint sends no CORS
 * headers, so a cross-origin read from a page would fail in the browser
 * anyway, and failing here says why before anything is sent.
 */
function inBrowser(): boolean {
  const scope = globalThis as { window?: unknown; document?: unknown };
  return scope.window !== undefined && scope.document !== undefined;
}

/** Stops a body that will not be read, without waiting on it. */
function discard(response: Response): void {
  response.body?.cancel().catch(() => {});
}

/**
 * Reads a body as text, counting bytes as they arrive and stopping at the
 * cap rather than after it. A declared length over the cap is refused before
 * anything is read.
 */
async function readCapped(
  response: Response,
  resource: Exclude<MorphErrorResource, null>,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    discard(response);
    throw new MorphError("response_too_large", resource, response.status);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array>;
    try {
      next = await reader.read();
    } catch {
      throw new MorphError("store_unreachable", resource, response.status);
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      reader.cancel().catch(() => {});
      throw new MorphError("response_too_large", resource, response.status);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Creates a reader for one Morph origin.
 *
 * Holds only what is fixed at creation: the origin and the fetch to use.
 * Nothing about a request — which store, which preview, which credential —
 * is kept between calls, so two requests served at once cannot see each
 * other's answers.
 */
export function createMorph(options: MorphOptions): Morph {
  const origin = parseBaseUrl(options?.baseUrl);
  const doFetch: MorphFetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request(
    url: string,
    resource: Exclude<MorphErrorResource, null>,
  ): Promise<Answer> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "omit",
        // A redirect is not followed: the origin a site names is the only one
        // it reads from.
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Not rethrown: the underlying error names the address.
      throw new MorphError("store_unreachable", resource);
    }
    // A browser reports a refused redirect as an opaque response with status
    // 0; a server runtime returns the 3xx itself. Neither body is read.
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    ) {
      discard(response);
      throw new MorphError("redirect_refused", resource, response.status);
    }
    const text = await readCapped(response, resource);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = NOT_JSON;
    }
    return { status: response.status, ok: response.ok, body };
  }

  /**
   * A refusal from Morph, by what it says rather than by status alone.
   *
   * The Store API names its refusals in JSON. A plain-text 404 comes from the
   * host lookup in front of every read: the address has no published store.
   */
  function refusal(
    answer: Answer,
    resource: Exclude<MorphErrorResource, null>,
  ): MorphError {
    const named = isRecord(answer.body) ? answer.body.error : undefined;
    if (resource === "product") {
      if (named === "INVALID_REQUEST") {
        return new MorphError("invalid_request", resource, answer.status);
      }
      if (named === "INVALID_STORE_CONTEXT") {
        return new MorphError("invalid_store_context", resource, answer.status);
      }
    }
    // Content answers a missing path with 200, so any 404 on a page read is
    // the host lookup, as the Starter reads it.
    if (
      answer.status === 404 &&
      (resource === "page" || answer.body === NOT_JSON)
    ) {
      return new MorphError("content_not_found", resource, answer.status);
    }
    return new MorphError("store_error", resource, answer.status);
  }

  function readPage(answer: Answer): MorphPage {
    const body = answer.body;
    if (
      !isRecord(body) ||
      !isRecord(body.slots) ||
      !Array.isArray(body.hiddenSlots) ||
      !body.hiddenSlots.every((slot) => typeof slot === "string")
    ) {
      throw new MorphError("invalid_response", "page", answer.status);
    }
    // `_hidden` is where the hidden list lives. A slot of that name would be
    // lost behind it, so it is refused instead of dropped.
    if (Object.prototype.hasOwnProperty.call(body.slots, "_hidden")) {
      throw new MorphError("reserved_slot", "page", answer.status);
    }
    const slots = absolutizeMorphPaths(body.slots, origin);
    return { ...slots, _hidden: [...(body.hiddenSlots as string[])] };
  }

  function isContext(value: unknown): value is Record<string, unknown> {
    return (
      isRecord(value) &&
      typeof value.storeId === "string" &&
      typeof value.salesChannelId === "string"
    );
  }

  function isProductItem(value: unknown): value is Record<string, unknown> {
    return (
      isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.handle === "string" &&
      typeof value.title === "string"
    );
  }

  function listQuery(params: unknown): string {
    if (params === undefined) return "";
    if (!isRecord(params)) throw new MorphError("invalid_request", "product");
    for (const key of Object.keys(params)) {
      if (!LIST_PARAMS.has(key)) {
        throw new MorphError("invalid_request", "product");
      }
    }
    const search = new URLSearchParams();
    const { q, page, limit, order } = params as MorphProductListParams;
    if (q !== undefined) {
      if (typeof q !== "string" || q.trim().length > MAX_QUERY_LENGTH) {
        throw new MorphError("invalid_request", "product");
      }
      if (q.trim()) search.set("q", q.trim());
    }
    if (page !== undefined) {
      if (!isInteger(page) || page < 1 || page > MAX_PAGE) {
        throw new MorphError("invalid_request", "product");
      }
      search.set("page", String(page));
    }
    if (limit !== undefined) {
      if (!isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new MorphError("invalid_request", "product");
      }
      search.set("limit", String(limit));
    }
    if (order !== undefined) {
      if (order !== "asc" && order !== "desc") {
        throw new MorphError("invalid_request", "product");
      }
      search.set("order", order);
    }
    const query = search.toString();
    return query ? "?" + query : "";
  }

  return {
    pages: {
      async get(path: string): Promise<MorphPage> {
        if (
          typeof path !== "string" ||
          !path.startsWith("/") ||
          path.length > MAX_PATH_LENGTH
        ) {
          throw new MorphError("invalid_path", "page");
        }
        if (inBrowser()) throw new MorphError("invalid_content_origin", "page");
        const answer = await request(
          origin + "/_morph/content?path=" + encodeURIComponent(path),
          "page",
        );
        if (!answer.ok) throw refusal(answer, "page");
        return readPage(answer);
      },
      isHidden(page: MorphPage, slotId: string): boolean {
        return page._hidden.includes(slotId);
      },
    },
    products: {
      async list(params?: MorphProductListParams): Promise<MorphProductList> {
        const query = listQuery(params);
        const answer = await request(
          origin + "/api/store/products" + query,
          "product",
        );
        if (!answer.ok) throw refusal(answer, "product");
        const body = answer.body;
        const pagination = isRecord(body) ? body.pagination : undefined;
        if (
          !isRecord(body) ||
          !Array.isArray(body.products) ||
          !body.products.every(isProductItem) ||
          !isRecord(pagination) ||
          !isInteger(pagination.page) ||
          !isInteger(pagination.limit) ||
          !isInteger(pagination.total) ||
          !isInteger(pagination.totalPages) ||
          !isContext(body.context)
        ) {
          throw new MorphError("invalid_response", "product", answer.status);
        }
        return absolutizeMorphPaths<unknown>(
          {
            products: body.products,
            pagination: {
              page: pagination.page,
              limit: pagination.limit,
              total: pagination.total,
              totalPages: pagination.totalPages,
            },
            context: body.context,
          },
          origin,
        ) as MorphProductList;
      },
      async get(handle: string): Promise<MorphProductResult | null> {
        if (
          typeof handle !== "string" ||
          handle.length > MAX_HANDLE_LENGTH ||
          !HANDLE_PATTERN.test(handle)
        ) {
          throw new MorphError("invalid_request", "product");
        }
        const answer = await request(
          origin + "/api/store/products/" + encodeURIComponent(handle),
          "product",
        );
        // Only the Store API's own answer means "no such product". A 404 from
        // the host lookup means there is no store here at all, and reading it
        // as a missing product would hide that.
        if (
          answer.status === 404 &&
          isRecord(answer.body) &&
          answer.body.error === "NOT_FOUND"
        ) {
          return null;
        }
        if (!answer.ok) throw refusal(answer, "product");
        const body = answer.body;
        if (
          !isRecord(body) ||
          !isProductItem(body.product) ||
          !Array.isArray(body.product.assets) ||
          !Array.isArray(body.product.options) ||
          !Array.isArray(body.product.variants) ||
          !isContext(body.context)
        ) {
          throw new MorphError("invalid_response", "product", answer.status);
        }
        return absolutizeMorphPaths<unknown>(
          { product: body.product, context: body.context },
          origin,
        ) as MorphProductResult;
      },
    },
  };
}
