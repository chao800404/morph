/**
 * The Cloudflare API calls the Core deploy tooling makes, and nothing else.
 *
 * Two clients over one transport, so that each carries its own credential:
 *
 * - the inventory client only reads (Custom Domains, zone Routes, the zone,
 *   and one `SELECT` against D1 — sent as an HTTP POST, which is how D1's
 *   query endpoint takes read-only SQL);
 * - the bootstrap client only creates. It has no delete and no update: the
 *   one PUT it sends is the Custom Domain attach, which the API names an
 *   update, so the caller reads before and after it (see
 *   `ensure-platform-bindings.ts`).
 *
 * Every read is validated before it is believed. A list that cannot be shown
 * complete, a response that is not `success: true`, or an entry missing a
 * field it must carry is an error — "could not read" never passes for
 * "nothing there".
 */

export type WorkerDomain = Readonly<{
  id: string;
  hostname: string;
  service: string;
  environment: string;
  zoneId: string;
  zoneName: string | null;
  /** `enabled` as the API reports it; null when the answer does not say. A disabled domain stops routing to the Worker. */
  enabled: boolean | null;
  /** `previews_enabled`, the same way. */
  previewsEnabled: boolean | null;
}>;

export type ZoneRoute = Readonly<{
  id: string;
  pattern: string;
  /** Absent for a Route with no Worker (a "no Worker" exclusion route). */
  script: string | null;
}>;

export type Zone = Readonly<{ id: string; name: string }>;

export class CloudflareReadError extends Error {
  override readonly name = "CloudflareReadError";
}

export class CloudflareWriteError extends Error {
  override readonly name = "CloudflareWriteError";
  constructor(
    message: string,
    /** True when the request may have been applied (network error, 5xx, unparseable answer). */
    readonly ambiguous: boolean,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export type CloudflareTransport = Readonly<{
  baseUrl: string;
  token: string;
  accountId: string;
  fetch?: typeof fetch;
}>;

type Envelope = {
  success?: unknown;
  result?: unknown;
  errors?: Array<{ code?: number; message?: string }>;
  result_info?: { page?: number; per_page?: number; total_pages?: number; count?: number; total_count?: number };
};

async function send(
  transport: CloudflareTransport,
  method: string,
  pathAndQuery: string,
  body?: unknown,
): Promise<{ status: number; envelope: Envelope | null }> {
  const doFetch = transport.fetch ?? fetch;
  const response = await doFetch(`${transport.baseUrl}${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${transport.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  try {
    return { status: response.status, envelope: JSON.parse(text) as Envelope };
  } catch {
    return { status: response.status, envelope: null };
  }
}

function describe(envelope: Envelope | null, status: number): string {
  const first = envelope?.errors?.[0];
  return first ? `${first.code ?? "?"} ${first.message ?? ""}`.trim() : `HTTP ${status}`;
}

const MAX_PAGES = 200;

async function getEnvelope(transport: CloudflareTransport, label: string, pathAndQuery: string) {
  let answer: Awaited<ReturnType<typeof send>>;
  try {
    answer = await send(transport, "GET", pathAndQuery);
  } catch (error) {
    throw new CloudflareReadError(`${label}: request failed (${error instanceof Error ? error.message : String(error)})`);
  }
  const { status, envelope } = answer;
  if (status !== 200 || !envelope || envelope.success !== true || !Array.isArray(envelope.result)) {
    throw new CloudflareReadError(`${label}: unreadable answer (${describe(envelope, status)})`);
  }
  return { result: envelope.result as unknown[], info: envelope.result_info };
}

/**
 * A list endpoint, read completely or not at all. Each endpoint is declared
 * paginated or not, from Cloudflare's own SDK (the pinned Wrangler bundles
 * `cloudflare@5.2.0`, whose list calls for `/accounts/{a}/workers/domains`
 * and `/zones/{z}/workers/routes` are `SinglePage`: no `page`, no
 * `per_page`, no `result_info`).
 *
 * - **Unpaginated:** one request. The answer is the whole list. A
 *   `result_info` that says otherwise (more pages, a larger total, a
 *   `count` that is not the payload) is unavailable.
 * - **Paginated:** a missing `result_info` is never complete, and
 *   - with `total_pages`: every stated page is read; a page that comes back
 *     empty before the last stated one is unavailable;
 *   - with only `total_count`: pages are read until it is reached, and an
 *     empty page before that is unavailable;
 *   - with neither: pages are read until one comes back short or empty;
 *   - every page must agree with page 1 (totals, `per_page`), carry no more
 *     than its `per_page` and exactly its `count`, and repeat no entry
 *     already read (a list that shifted while it was read proves nothing).
 */
export async function readCloudflareList(
  transport: CloudflareTransport,
  label: string,
  path: string,
  options: Readonly<{ paged: boolean }>,
): Promise<unknown[]> {
  if (!options.paged) {
    const { result, info } = await getEnvelope(transport, label, path);
    if (info) {
      const pages = typeof info.total_pages === "number" ? info.total_pages : null;
      const total = typeof info.total_count === "number" ? info.total_count : null;
      const count = typeof info.count === "number" ? info.count : null;
      const page = typeof info.page === "number" ? info.page : null;
      const perPage = typeof info.per_page === "number" ? info.per_page : null;
      const record = info as Record<string, unknown>;
      // Signs that the endpoint has started paging: a cursor, a later page,
      // or a full page with no total to say it is the last.
      const hasCursor = ["cursor", "cursors", "next_cursor"].some(
        (key) => record[key] !== undefined && record[key] !== null && record[key] !== "" && !(typeof record[key] === "object" && Object.keys(record[key] as object).length === 0),
      );
      const fullPageWithoutTotal = perPage !== null && total === null && result.length >= perPage;
      if (hasCursor || (page !== null && page > 1) || fullPageWithoutTotal) {
        throw new CloudflareReadError(
          `${label}: an unpaginated endpoint's result_info suggests more data (${JSON.stringify(info)}); the list cannot be shown complete`,
        );
      }
      if ((pages !== null && pages > 1) || (total !== null && total !== result.length) || (count !== null && count !== result.length)) {
        throw new CloudflareReadError(
          `${label}: an unpaginated endpoint answered with only part of the list (${result.length} entries, result_info ${JSON.stringify(info)})`,
        );
      }
    }
    return result;
  }

  const items: unknown[] = [];
  const seen = new Set<string>();
  let totalCount: number | null = null;
  let totalPages: number | null = null;
  let perPage: number | null = null;
  let pageSize = 0;
  for (let page = 1; ; page += 1) {
    if (page > MAX_PAGES) throw new CloudflareReadError(`${label}: more than ${MAX_PAGES} pages`);
    const query = page === 1 ? "" : `${path.includes("?") ? "&" : "?"}page=${page}${perPage ? `&per_page=${perPage}` : ""}`;
    const { result, info } = await getEnvelope(transport, label, `${path}${query}`);
    if (!info) throw new CloudflareReadError(`${label}: page ${page} of a paginated list carries no result_info`);
    const declaredPerPage = typeof info.per_page === "number" ? info.per_page : perPage;
    if (declaredPerPage !== null && result.length > declaredPerPage) {
      throw new CloudflareReadError(`${label}: page ${page} carries ${result.length} entries, more than per_page ${declaredPerPage}`);
    }
    if (typeof info.count === "number" && info.count !== result.length) {
      throw new CloudflareReadError(`${label}: page ${page} says ${info.count} entries and carries ${result.length}`);
    }
    if (typeof info.page === "number" && info.page !== page) {
      throw new CloudflareReadError(`${label}: asked for page ${page}, the API answered page ${info.page}`);
    }
    const pageTotal = typeof info.total_count === "number" ? info.total_count : null;
    const pagePages = typeof info.total_pages === "number" ? info.total_pages : null;
    const pagePer = typeof info.per_page === "number" ? info.per_page : null;
    if (page === 1) {
      totalCount = pageTotal;
      totalPages = pagePages;
      perPage = pagePer;
      pageSize = perPage ?? result.length;
    } else if (pageTotal !== totalCount || pagePages !== totalPages || pagePer !== perPage) {
      throw new CloudflareReadError(
        `${label}: page ${page} describes another list (total ${pageTotal}/${pagePages} pages per ${pagePer}, page 1 said ${totalCount}/${totalPages} per ${perPage})`,
      );
    }
    for (const entry of result) {
      const key = JSON.stringify(entry);
      if (seen.has(key)) {
        throw new CloudflareReadError(`${label}: page ${page} repeats entries already read; the list cannot be shown complete`);
      }
      seen.add(key);
    }
    items.push(...result);

    if (totalPages !== null) {
      // An empty page anywhere — the last stated one included — means the
      // list is not what page 1 described; only an empty list (one empty
      // page, nothing stated) is complete when empty.
      const emptyList = page === 1 && totalPages <= 1 && (totalCount ?? 0) === 0;
      if (result.length === 0 && !emptyList) {
        throw new CloudflareReadError(`${label}: page ${page} is empty before the stated ${totalPages} page(s) were read`);
      }
      if (page < totalPages && perPage !== null && result.length < perPage) {
        throw new CloudflareReadError(`${label}: page ${page} is short (${result.length} of per_page ${perPage}) before the last stated page`);
      }
      if (page >= totalPages) break;
    } else if (totalCount !== null) {
      if (items.length >= totalCount) break;
      if (result.length === 0) throw new CloudflareReadError(`${label}: page ${page} is empty before total_count ${totalCount} was reached`);
    } else if (result.length === 0 || result.length < pageSize) {
      break;
    }
  }
  if (totalCount !== null && totalCount !== items.length) {
    throw new CloudflareReadError(`${label}: incomplete list (${items.length} of ${totalCount})`);
  }
  return items;
}

function str(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function toWorkerDomain(entry: unknown): WorkerDomain {
  const raw = (entry ?? {}) as Record<string, unknown>;
  if (!str(raw.id) || !str(raw.hostname) || !str(raw.service) || !str(raw.zone_id) || !str(raw.environment)) {
    throw new CloudflareReadError(`Custom Domains: an entry lacks id, hostname, service, environment or zone_id (${JSON.stringify(entry)})`);
  }
  return {
    id: raw.id,
    hostname: raw.hostname.toLowerCase(),
    service: raw.service,
    environment: raw.environment,
    zoneId: raw.zone_id,
    zoneName: str(raw.zone_name) ? raw.zone_name : null,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
    previewsEnabled: typeof raw.previews_enabled === "boolean" ? raw.previews_enabled : null,
  };
}

function toZoneRoute(entry: unknown): ZoneRoute {
  const raw = (entry ?? {}) as Record<string, unknown>;
  if (!str(raw.id) || !str(raw.pattern)) {
    throw new CloudflareReadError(`Workers Routes: an entry lacks id or pattern (${JSON.stringify(entry)})`);
  }
  if (raw.script !== undefined && raw.script !== null && typeof raw.script !== "string") {
    throw new CloudflareReadError(`Workers Routes: an entry has a non-string script (${JSON.stringify(entry)})`);
  }
  return { id: raw.id, pattern: raw.pattern, script: str(raw.script) ? raw.script : null };
}

export type InventoryApi = Readonly<{
  getZone(zoneId: string): Promise<Zone>;
  /** Every Custom Domain in the account, unfiltered: ownership is decided by the caller. */
  listWorkerDomains(): Promise<WorkerDomain[]>;
  /** Every Workers Route in the zone, whatever Worker it names. */
  listZoneRoutes(zoneId: string): Promise<ZoneRoute[]>;
  queryD1(databaseId: string, sql: string): Promise<Record<string, unknown>[]>;
}>;

export function createInventoryApi(transport: CloudflareTransport): InventoryApi {
  const account = `/accounts/${transport.accountId}`;
  return {
    async getZone(zoneId) {
      let answer: Awaited<ReturnType<typeof send>>;
      try {
        answer = await send(transport, "GET", `/zones/${zoneId}`);
      } catch (error) {
        throw new CloudflareReadError(`Zone: request failed (${error instanceof Error ? error.message : String(error)})`);
      }
      const result = answer.envelope?.result as Record<string, unknown> | undefined;
      if (answer.status !== 200 || answer.envelope?.success !== true || !str(result?.id) || !str(result?.name)) {
        throw new CloudflareReadError(`Zone ${zoneId}: unreadable answer (${describe(answer.envelope, answer.status)})`);
      }
      if (result.id !== zoneId) throw new CloudflareReadError(`Zone ${zoneId}: the API answered for ${result.id}`);
      return { id: result.id, name: (result.name as string).toLowerCase() };
    },
    async listWorkerDomains() {
      const items = await readCloudflareList(transport, "Custom Domains", `${account}/workers/domains`, { paged: false });
      return items.map(toWorkerDomain);
    },
    async listZoneRoutes(zoneId) {
      const items = await readCloudflareList(transport, `Workers Routes (zone ${zoneId})`, `/zones/${zoneId}/workers/routes`, { paged: false });
      return items.map(toZoneRoute);
    },
    async queryD1(databaseId, sql) {
      let answer: Awaited<ReturnType<typeof send>>;
      try {
        answer = await send(transport, "POST", `${account}/d1/database/${databaseId}/query`, { sql });
      } catch (error) {
        throw new CloudflareReadError(`D1: request failed (${error instanceof Error ? error.message : String(error)})`);
      }
      const { status, envelope } = answer;
      const first = Array.isArray(envelope?.result) ? (envelope!.result as unknown[])[0] : undefined;
      const results = (first as { success?: unknown; results?: unknown } | undefined)?.results;
      if (status !== 200 || envelope?.success !== true || (first as { success?: unknown })?.success !== true || !Array.isArray(results)) {
        throw new CloudflareReadError(`D1: unreadable answer (${describe(envelope, status)})`);
      }
      return results as Record<string, unknown>[];
    },
  };
}

export type BootstrapApi = Readonly<{
  attachCustomDomain(input: {
    hostname: string;
    service: string;
    environment: string;
    zoneId: string;
  }): Promise<WorkerDomain>;
  createZoneRoute(zoneId: string, input: { pattern: string; script: string }): Promise<ZoneRoute>;
}>;

async function write(
  transport: CloudflareTransport,
  method: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  let answer: Awaited<ReturnType<typeof send>>;
  try {
    answer = await send(transport, method, path, body);
  } catch (error) {
    throw new CloudflareWriteError(`request failed (${error instanceof Error ? error.message : String(error)})`, true, null);
  }
  const { status, envelope } = answer;
  if (status >= 200 && status < 300 && envelope?.success === true) return envelope.result;
  // Any 4xx is a definite refusal, whatever the body (or its absence) says:
  // the request was not applied. A 5xx, a 2xx without success, or a status
  // with an unreadable body otherwise may have been.
  const definite = status >= 400 && status < 500;
  const ambiguous = !definite && (status >= 500 || envelope === null || (status >= 200 && status < 300));
  throw new CloudflareWriteError(describe(envelope, status), ambiguous, status);
}

export function createBootstrapApi(transport: CloudflareTransport): BootstrapApi {
  return {
    async attachCustomDomain(input) {
      const result = await write(transport, "PUT", `/accounts/${transport.accountId}/workers/domains`, {
        hostname: input.hostname,
        service: input.service,
        environment: input.environment,
        zone_id: input.zoneId,
      });
      try {
        return toWorkerDomain(result);
      } catch {
        throw new CloudflareWriteError("the attach answer carries no domain identity", true, 200);
      }
    },
    async createZoneRoute(zoneId, input) {
      const result = await write(transport, "POST", `/zones/${zoneId}/workers/routes`, input);
      const raw = (result ?? {}) as Record<string, unknown>;
      if (!str(raw.id)) throw new CloudflareWriteError("the create answer carries no route id", true, 200);
      return { id: raw.id, pattern: str(raw.pattern) ? raw.pattern : input.pattern, script: str(raw.script) ? raw.script : input.script };
    },
  };
}
