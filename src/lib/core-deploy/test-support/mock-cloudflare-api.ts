import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for the Cloudflare API that answers successfully, keeps
 * state, and records every request — method, path, query and body — so a test
 * can assert both what was read and that nothing was written.
 *
 * The answers have the API's envelope (`success`, `errors`, `result`) and the
 * field names the real endpoints use. Nothing here reaches Cloudflare.
 */

export type RecordedRequest = Readonly<{
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  contentType: string | null;
  authorization: string | null;
}>;

export type MockDomain = {
  id: string;
  hostname: string;
  service: string;
  environment: string;
  zone_id: string;
  zone_name: string;
  enabled?: boolean;
  previews_enabled?: boolean;
};

export type MockRoute = { id: string; pattern: string; script?: string };

export type MockState = {
  accountId: string;
  zones: Array<{ id: string; name: string }>;
  domains: MockDomain[];
  routes: Record<string, MockRoute[]>;
  /** database_id to `storefront_domains` rows as the D1 query returns them. */
  d1: Record<string, Array<Record<string, unknown>>>;
};

export type Reply = Readonly<{ status: number; body: unknown; headers?: Record<string, string> }>;

/** A fault for requests matching `method` and `path` (a string prefix or a RegExp). */
export type Fault = {
  method: string;
  path: string | RegExp;
  /** How many matching requests fail; the rest are answered normally. */
  times: number;
  status: number;
  /** Apply the request to the state first, then answer with the fault (an ambiguous write). */
  applyFirst?: boolean;
  body?: unknown;
};

export type CustomHandler = (request: RecordedRequest, state: MockState) => Reply | undefined;

export const API_PREFIX = "/client/v4";

export function ok(result: unknown, extra: Record<string, unknown> = {}): Reply {
  return { status: 200, body: { success: true, errors: [], messages: [], result, ...extra } };
}

/**
 * The two Workers lists, as the real endpoints answer them: the whole list,
 * no `result_info` (the SDK models both as `SinglePage`).
 */
export function okList(result: unknown[]): Reply {
  return ok(result);
}

export function apiError(status: number, code: number, message: string): Reply {
  return { status, body: { success: false, errors: [{ code, message }], messages: [], result: null } };
}

let nextId = 1;
export function mockId(prefix: string): string {
  const n = (nextId++).toString(16).padStart(8, "0");
  return `${prefix}${n}`.padEnd(32, "0").slice(0, 32);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** The endpoints the Core deploy inventory and bootstrap use. */
function coreHandler(request: RecordedRequest, state: MockState): Reply | undefined {
  const { method, path } = request;
  const account = `/accounts/${state.accountId}`;
  let match: RegExpMatchArray | null;

  if (method === "GET" && (match = path.match(/^\/zones\/([^/]+)$/))) {
    const zone = state.zones.find((z) => z.id === match![1]);
    return zone ? ok(zone) : apiError(404, 1001, "Invalid zone identifier");
  }
  if (method === "GET" && path === `${account}/workers/domains`) {
    return okList(state.domains);
  }
  if (method === "PUT" && path === `${account}/workers/domains`) {
    const input = JSON.parse(request.body) as { hostname: string; service: string; environment?: string; zone_id: string };
    const zone = state.zones.find((z) => z.id === input.zone_id);
    if (!zone) return apiError(400, 100116, "zone not found");
    const existing = state.domains.find((d) => d.hostname === input.hostname);
    const domain: MockDomain = {
      id: existing?.id ?? mockId("d"),
      hostname: input.hostname,
      service: input.service,
      environment: input.environment ?? "production",
      zone_id: zone.id,
      zone_name: zone.name,
    };
    state.domains = [...state.domains.filter((d) => d.hostname !== input.hostname), domain];
    return ok(domain);
  }
  if (method === "DELETE" && (match = path.match(new RegExp(`^${account}/workers/domains/([^/]+)$`)))) {
    state.domains = state.domains.filter((d) => d.id !== match![1]);
    return ok(null);
  }
  if ((match = path.match(/^\/zones\/([^/]+)\/workers\/routes$/))) {
    const zoneId = match[1]!;
    if (!state.zones.some((z) => z.id === zoneId)) return apiError(404, 1001, "Invalid zone identifier");
    const routes = (state.routes[zoneId] ??= []);
    if (method === "GET") return okList(routes);
    if (method === "POST") {
      const input = JSON.parse(request.body) as { pattern: string; script?: string };
      if (routes.some((r) => r.pattern === input.pattern)) {
        return apiError(409, 10020, "A route with the same pattern already exists");
      }
      const route: MockRoute = { id: mockId("r"), pattern: input.pattern, ...(input.script ? { script: input.script } : {}) };
      routes.push(route);
      return ok(route);
    }
  }
  if (method === "POST" && (match = path.match(new RegExp(`^${account}/d1/database/([^/]+)/query$`)))) {
    const rows = state.d1[match[1]!];
    if (!rows) return apiError(404, 7404, "database not found");
    const { sql } = JSON.parse(request.body) as { sql: string };
    if (!/^\s*SELECT\b/i.test(sql)) return apiError(400, 7500, "mock D1 answers SELECT only");
    return ok([{ results: rows, success: true, meta: {} }]);
  }
  return undefined;
}

export type MockApi = Readonly<{
  origin: string;
  baseUrl: string;
  state: MockState;
  requests: RecordedRequest[];
  /** Requests no handler answered: a run that needed one did not do what the test assumes. */
  unhandled: RecordedRequest[];
  faults: Fault[];
  /** Called before the state answers; may change the state (a concurrent writer). */
  beforeAnswer: Array<(request: RecordedRequest, state: MockState) => void>;
  writes(): RecordedRequest[];
  close(): Promise<void>;
}>;

export async function startMockCloudflareApi(
  state: MockState,
  options: { handlers?: CustomHandler[] } = {},
): Promise<MockApi> {
  const requests: RecordedRequest[] = [];
  const unhandled: RecordedRequest[] = [];
  const faults: Fault[] = [];
  const beforeAnswer: Array<(request: RecordedRequest, state: MockState) => void> = [];
  const handlers = [...(options.handlers ?? []), coreHandler];

  const server: Server = createServer(async (incoming, response) => {
    const body = (await readBody(incoming)).toString("utf8");
    const url = new URL(incoming.url ?? "/", "http://mock");
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
    const request: RecordedRequest = {
      method: incoming.method ?? "GET",
      path,
      query: url.searchParams,
      body,
      contentType: incoming.headers["content-type"] ?? null,
      authorization: incoming.headers.authorization ?? null,
    };
    requests.push(request);
    for (const hook of beforeAnswer) hook(request, state);

    const fault = faults.find(
      (f) =>
        f.times > 0 &&
        f.method === request.method &&
        (typeof f.path === "string" ? request.path.startsWith(f.path) : f.path.test(request.path)),
    );
    let reply: Reply | undefined;
    if (fault && !fault.applyFirst) {
      fault.times -= 1;
      reply = { status: fault.status, body: fault.body ?? apiError(fault.status, 10000, "mock fault").body };
    } else {
      for (const handler of handlers) {
        reply = handler(request, state);
        if (reply) break;
      }
      if (!reply) {
        unhandled.push(request);
        reply = apiError(404, 10007, `mock has no handler for ${request.method} ${request.path}`);
      }
      if (fault?.applyFirst) {
        fault.times -= 1;
        reply = { status: fault.status, body: fault.body ?? apiError(fault.status, 10000, "mock fault after apply").body };
      }
    }
    response.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) });
    response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    baseUrl: `${origin}${API_PREFIX}`,
    state,
    requests,
    unhandled,
    faults,
    beforeAnswer,
    writes: () => requests.filter((r) => r.method !== "GET" && !/\/d1\/database\/[^/]+\/query$/.test(r.path)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const ACCOUNT = "0123456789abcdef0123456789abcdef";
export const ZONE = "fedcba9876543210fedcba9876543210";
export const ZONE_NAME = "example.com";
export const D1_ID = "2f492a71-a681-4c5d-adfa-a3429f3f4e59";
export const WORKER = "morph-test";

export function domain(hostname: string, overrides: Partial<MockDomain> = {}): MockDomain {
  return {
    id: mockId("d"),
    hostname,
    service: WORKER,
    environment: "production",
    zone_id: ZONE,
    zone_name: ZONE_NAME,
    ...overrides,
  };
}

export function row(hostname: string, cloudflareDomainId: string | null, status = "active", id = mockId("row")) {
  return {
    id,
    storefront_id: "00000000-0000-4000-8000-000000000002",
    hostname,
    status,
    cloudflare_domain_id: cloudflareDomainId,
    updated_at: "2026-11-28T00:00:00.000Z",
  };
}

export function baseState(overrides: Partial<MockState> = {}): MockState {
  return {
    accountId: ACCOUNT,
    zones: [{ id: ZONE, name: ZONE_NAME }],
    domains: [],
    routes: { [ZONE]: [] },
    d1: { [D1_ID]: [] },
    ...overrides,
  };
}
