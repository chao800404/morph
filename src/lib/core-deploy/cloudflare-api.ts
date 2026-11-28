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

/**
 * A list endpoint, read to the end. The first request names no page; an
 * answer whose `result_info` says there are more pages is followed page by
 * page, and a stated total must match what arrived. An answer with no
 * `result_info` is an unpaged list.
 */
async function readList(
  transport: CloudflareTransport,
  label: string,
  path: string,
): Promise<unknown[]> {
  const items: unknown[] = [];
  let totalCount: number | null = null;
  let totalPages = 1;
  let perPage: number | null = null;
  for (let page = 1; page <= totalPages; page += 1) {
    if (page > MAX_PAGES) throw new CloudflareReadError(`${label}: more than ${MAX_PAGES} pages`);
    const query = page === 1 ? "" : `${path.includes("?") ? "&" : "?"}page=${page}${perPage ? `&per_page=${perPage}` : ""}`;
    let answer: Awaited<ReturnType<typeof send>>;
    try {
      answer = await send(transport, "GET", `${path}${query}`);
    } catch (error) {
      throw new CloudflareReadError(`${label}: request failed (${error instanceof Error ? error.message : String(error)})`);
    }
    const { status, envelope } = answer;
    if (status !== 200 || !envelope || envelope.success !== true || !Array.isArray(envelope.result)) {
      throw new CloudflareReadError(`${label}: unreadable answer (${describe(envelope, status)})`);
    }
    items.push(...envelope.result);
    const info = envelope.result_info;
    if (info && typeof info.count === "number" && info.count !== envelope.result.length) {
      throw new CloudflareReadError(`${label}: page ${page} says ${info.count} entries and carries ${envelope.result.length}`);
    }
    if (page === 1) {
      if (info && typeof info.total_count === "number") totalCount = info.total_count;
      if (info && typeof info.total_pages === "number" && info.total_pages > 1) totalPages = info.total_pages;
      if (info && typeof info.per_page === "number") perPage = info.per_page;
    } else {
      // Every page must describe the same list the first page described: a
      // total that moves between pages means the list changed (or the answer
      // is wrong) while it was being read, so what arrived proves nothing.
      const pageTotal = typeof info?.total_count === "number" ? info.total_count : null;
      const pagePages = typeof info?.total_pages === "number" ? info.total_pages : null;
      const pagePer = typeof info?.per_page === "number" ? info.per_page : null;
      if (pageTotal !== totalCount || pagePages !== totalPages || pagePer !== perPage) {
        throw new CloudflareReadError(
          `${label}: page ${page} describes another list (total ${pageTotal}/${pagePages} pages, page 1 said ${totalCount}/${totalPages})`,
        );
      }
    }
    if (info && typeof info.page === "number" && info.page !== page) {
      throw new CloudflareReadError(`${label}: asked for page ${page}, the API answered page ${info.page}`);
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
      const items = await readList(transport, "Custom Domains", `${account}/workers/domains`);
      return items.map(toWorkerDomain);
    },
    async listZoneRoutes(zoneId) {
      const items = await readList(transport, `Workers Routes (zone ${zoneId})`, `/zones/${zoneId}/workers/routes`);
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
  const ambiguous = status >= 500 || envelope === null || (status >= 200 && status < 300);
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
