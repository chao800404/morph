import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from "@playwright/test";

import { editHero, openEditor, savedField, serverFn } from "./native-acceptance";
import { themeScopeFromEditorPath, writeThemeFiles } from "./native-compat";

/**
 * M1 acceptance 1c (handoff/2026-11-21/m1-acceptance-plan.md §1c, §7 Q3/Q8):
 * the revocation timeline of a Live Preview that is already open. Test-only:
 * it measures, it changes no product code.
 *
 * Each case opens the editor (its preview frame) and a tab opened from it, on
 * one session, confirms both are serving this run's saved draft, opens one
 * relayed echo WebSocket in each, then revokes. R is not observed as one
 * instant; it lies in a window [a, b]: the revocation request sent and
 * answered (or, for a database-only change, just before the write and its
 * return). The grant's `revoked_at` (or the user row) is read back beside it.
 *
 * After R each open document keeps sending, in turn: its own document, a
 * module it loaded, `/_morph/content`, and the server-function request its
 * client navigation made (replayed, same method and payload). Every request
 * is one event {t, kind, status, reason, leaked}. The page's own requests
 * on the pv- host are recorded too ("passive"). Each socket's echoes, its
 * close (browser side) and what the container received are recorded.
 *
 * Triggers, each its own test:
 *   sign-out                  the session signs itself out (hook + push)
 *   revoke-other-session      another session of the user revokes it through
 *                             Morph's `revokeSession` (hook + push)
 *   ban, role-downgrade,      the user row changed in D1 only. Morph serves
 *   remove-user               no HTTP path for these (the admin endpoints are
 *                             in DISABLED_AUTH_PATHS and no server function
 *                             calls banUser/setRole/removeUser), so the
 *                             after-hook and its push cannot be reached from
 *                             a browser: these are notice-lost by
 *                             construction, on a fresh admin of their own.
 *   notice-lost               the grants revoked in D1 only (no push), 3 s
 *                             after the sockets opened (A7's case)
 *   notice-lost-after-renewal the same, just after the busy socket's first
 *                             mid-life lease renewal (estimated, see below)
 *   notice-lost-after-renewal-idle
 *                             the same, and the sockets send nothing after R:
 *                             only the lease tick can end them (the design's
 *                             worst case, R + L + tick + eps = 37 s)
 *   grant-expiry              listed separately: `expires_at` moved to now
 *                             in D1 only
 *
 * Verdicts, as A7 judges them. With R in [a, b] and an event at T, against a
 * limit D: pass T - a <= D; over T - b > D; uncertain otherwise. Only pass is
 * a pass; the margin (eps) only ever yields uncertain. D = 30 s
 * (§7 Q3). The design bounds (data L + eps = 32 s, close L + tick + eps =
 * 37 s) are reported beside it, never used in place of it.
 *
 *   HTTP: pass when the first request of every kind sent at or after b is
 *   refused (401/403/410) and none sent at or after b is served; over when one
 *   is served; uncertain otherwise (an error that is neither).
 *   WebSocket: data stopped (the last data frame either end received) and
 *   closed, each judged against 30 s; the path's verdict is the worse.
 *
 * This spec reports verdicts; "over" and "uncertain" do not fail it (the plan
 * says the current design cannot yet prove 30 s for notice-lost). It fails on
 * a harness error (a precondition that did not hold, a measurement that could
 * not be made) and on any draft byte served after b.
 *
 * Logs and the timeline carry grant and preview ids only: no cookie, token,
 * session id, grant secret or password.
 */

const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
const OUT = process.env.M1_1C_TIMELINE_OUT;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The pv- host fronts the Sandbox container: MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  RUNTIME !== "start",
  "The server-function probe needs the full Start preview: MORPH_E2E_PREVIEW_RUNTIME=start.",
);

const PREVIEW =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const REVOKE_SESSION = "/src/server/auth/revoke-session.serverFn.ts";
const HERO = '[data-storefront-section-id="starter-hero"]';
const ECHO = "__morph-1c-echo";
const LOG = "__morph-1c-log";
const PROBE_ROUTE = "/c1-probe";
const DEV_PORT = 5173;
const DEV_BASE = "/__morph-theme-preview__/";
// preview-socket-lease.ts / preview-socket-relay.ts
const LEASE_MS = 30_000;
const TICK_MS = 5_000;
const SLACK_MS = 2_000;
const TARGET_MS = 30_000;
const FRAME_INTERVAL_MS = 100;
const PROBE_GAP_MS = 100;
/** How long after b a socket may take to close before it counts as not closed. */
const CLOSE_WAIT_MS = 75_000;
/** Probing continues at least this long after b, and 2 s after the last close. */
const MIN_PROBE_AFTER_B_MS = 5_000;
const E2E_USER_ID =
  process.env.MORPH_E2E_USER_ID ?? "00000000-0000-4000-8000-00000000e2e1";

/** This run's draft marker: the same in every worker of one run, new per run. */
const MARKER = `1c draft ${createHash("sha256")
  .update(STATE_DIR ?? "none")
  .digest("hex")
  .slice(0, 10)}`;

type Verdict = "pass" | "uncertain" | "over";
const RANK: Record<Verdict, number> = { pass: 0, uncertain: 1, over: 2 };
const worst = (verdicts: Verdict[]): Verdict =>
  verdicts.reduce<Verdict>((w, v) => (RANK[v] > RANK[w] ? v : w), "pass");

/** The delay from R in [a, b] to T, against limit D (see above). */
function judge(t: number, a: number, b: number, limitMs: number) {
  const longestMs = t - a;
  const shortestMs = t - b;
  const verdict: Verdict =
    longestMs <= limitMs ? "pass" : shortestMs > limitMs ? "over" : "uncertain";
  return { verdict, longestMs, shortestMs, limitMs };
}

const FIXTURE = `import startEntry from "@tanstack/react-start/server-entry";

// Test-only fixture (M1 acceptance 1c). One path answers with a socket that
// echoes every frame and records, by the container's clock, what it received
// and when it closed; another returns that record.
const ECHO = ${JSON.stringify(`/${ECHO}`)};
const LOG = ${JSON.stringify(`/${LOG}`)};
const records = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.endsWith(LOG)) {
      const record = records.get(url.searchParams.get("sock") || "") ?? null;
      return new Response(JSON.stringify(record), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    if (!url.pathname.endsWith(ECHO)) return startEntry.fetch(request, env, ctx);
    if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("1c-echo: upgrade required", {
        status: 426,
        headers: { "cache-control": "no-store" },
      });
    }
    const record = {
      sock: url.searchParams.get("sock") || "anon",
      openedAt: Date.now(),
      received: 0,
      lastReceivedAt: null,
      closedAt: null,
      closeCode: null,
    };
    records.set(record.sock, record);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    server.addEventListener("message", (event) => {
      record.received += 1;
      record.lastReceivedAt = Date.now();
      try {
        server.send(event.data);
      } catch {}
    });
    server.addEventListener("close", (event) => {
      record.closedAt = Date.now();
      record.closeCode = event.code;
    });
    return new Response(null, { status: 101, webSocket: client });
  },
};
`;

/**
 * A route whose loader is a server function returning the home page's
 * content, so a client navigation to it makes a server-function request that
 * carries the draft.
 */
const PROBE_ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";

// Test-only (M1 acceptance 1c): a server function carrying the home draft.
const getProbePage = createServerFn().handler(() => morph.pages.get("/"));

export const Route = createFileRoute("${PROBE_ROUTE}")({
  loader: () => getProbePage(),
  component: C1Probe,
});

function C1Probe() {
  const page = Route.useLoaderData();
  return (
    <main data-c1-probe="1">
      <pre>{JSON.stringify(page)}</pre>
    </main>
  );
}
`;

type FixtureRecord = {
  sock: string;
  openedAt: number;
  received: number;
  lastReceivedAt: number | null;
  closedAt: number | null;
  closeCode: number | null;
};

type Surface = "frame" | "tab";
type HttpKind = "document" | "module" | "content" | "serverFn";
const HTTP_KINDS: readonly HttpKind[] = [
  "document",
  "module",
  "content",
  "serverFn",
];

type ProbeEvent = {
  surface: Surface;
  kind: HttpKind;
  t: number;
  answeredAt: number;
  status: number;
  reason: string | null;
  leaked: boolean;
  error: string | null;
};
type WsEvent =
  | { surface: Surface; kind: "ws-echo"; t: number }
  | {
      surface: Surface;
      kind: "ws-close";
      t: number;
      status: number;
      reason: string;
      wasClean: boolean;
    };
type PassiveEvent = {
  surface: Surface;
  kind: "passive";
  t: number;
  status: number;
  path: string;
  resourceType: string;
  leaked: boolean | null;
};
type PassiveSocketEvent = {
  surface: Surface;
  kind: "passive-ws-close";
  t: number;
  path: string;
};
type AnyEvent = ProbeEvent | WsEvent | PassiveEvent | PassiveSocketEvent;

const refused = (status: number) =>
  status === 401 || status === 403 || status === 410;
const served = (status: number) => status >= 200 && status < 400;

/** One statement, or several in one transaction, against this run's own D1. */
function d1File(): string {
  const dir = join(STATE_DIR!, "v3/d1/miniflare-D1DatabaseObject");
  const file = existsSync(dir)
    ? readdirSync(dir).find(
        (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
      )
    : undefined;
  if (!file) throw new Error("this run's local D1 file was not found");
  return join(dir, file);
}
function d1All(sql: string, ...params: unknown[]) {
  const db = new Database(d1File(), { timeout: 10_000 });
  try {
    return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}
function d1Write(statements: Array<[string, ...unknown[]]>): number {
  const db = new Database(d1File(), { timeout: 10_000 });
  try {
    let changes = 0;
    db.transaction(() => {
      for (const [sql, ...params] of statements) {
        changes += db.prepare(sql).run(...params).changes;
      }
    })();
    return changes;
  } finally {
    db.close();
  }
}

/**
 * The e2e runs' preview containers (never a developer's `workerd-morph-…`).
 * One run has several: each user's preview is its own container, and the
 * ban, role-downgrade and remove-user cases each sign in a fresh admin.
 */
function e2ePreviewContainers(): string[] {
  const listed = spawnSync(
    "bash",
    [
      "-c",
      'docker ps --filter "name=^workerd-morph-e2e-" --format "{{.ID}} {{.Names}}" 3>&-',
    ],
    { encoding: "utf8" },
  );
  const own = (listed.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (row) => row.includes("-PreviewSandbox-") && !row.endsWith("-proxy"),
    );
  expect(own, "a preview container of an e2e run is up").not.toHaveLength(0);
  return own.map((row) => row.split(" ")[0]!);
}

/**
 * The fixture's record for one socket, read inside the container that served
 * it: the one container whose fixture holds this socket's (per-case) name.
 */
function fixtureRecord(sock: string): FixtureRecord | null {
  const url = `http://127.0.0.1:${DEV_PORT}${DEV_BASE}${LOG}?sock=${sock}`;
  const script =
    "fetch(process.argv[1],{cache:'no-store'}).then(r=>r.text()).then(t=>console.log('C1LOG '+t),e=>console.log('C1LOG null'))";
  const holding: Array<{ container: string; record: FixtureRecord }> = [];
  for (const container of e2ePreviewContainers()) {
    const ran = spawnSync(
      "bash",
      ["-c", 'docker exec "$0" node -e "$1" "$2" 3>&-', container, script, url],
      { encoding: "utf8", timeout: 60_000 },
    );
    const line = (ran.stdout ?? "")
      .split("\n")
      .find((l) => l.startsWith("C1LOG "));
    const record = line
      ? (JSON.parse(line.slice(6)) as FixtureRecord | null)
      : null;
    if (record) holding.push({ container, record });
  }
  // None holding it is reported by the caller as a harness error.
  expect(
    holding.length,
    `at most one preview container holds this case's socket (${holding.map((h) => h.container).join(", ")})`,
  ).toBeLessThanOrEqual(1);
  return holding[0]?.record ?? null;
}

async function previewFrame(page: Page): Promise<Frame> {
  let found: Frame | undefined;
  await expect
    .poll(
      () => {
        found = page
          .frames()
          .find(
            (frame) =>
              new URL(frame.url() || "about:blank").hostname.startsWith(
                "pv-",
              ) &&
              !new URL(frame.url()).pathname.startsWith(
                "/__morph/preview-auth/",
              ),
          );
        return Boolean(found);
      },
      { timeout: 90_000, message: "the preview frame lands on its pv- host" },
    )
    .toBe(true);
  return found!;
}

/** Installed before the editor navigates; only listens (as A7). */
function recordReadiness() {
  performance.setResourceTimingBufferSize(10_000);
  const w = window as unknown as Record<string, unknown>;
  const ready: Array<Record<string, unknown>> = [];
  w.__c1ready = ready;
  window.addEventListener("message", (event) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.type !== "morph:storefront-preview-ready") return;
    ready.push({
      t: Date.now(),
      source: event.source,
      origin: event.origin,
      previewSession: data.previewSession,
      previewDocument: data.previewDocument,
    });
  });
  window.addEventListener("morph:storefront-preview-bridge-ready", () => {
    w.__c1bridgeReadyAt ??= Date.now();
  });
}

async function documentInFrame(
  frame: Frame,
): Promise<{ previewDocument: string; previewSession: string } | null> {
  return frame
    .evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => name.includes("/morph/preview/preview-protocol"));
      if (!url) return null;
      const protocol = (await import(/* @vite-ignore */ url)) as {
        documentPreviewIdentity?: () => string;
        documentPreviewRuntimeChannel?: () => { previewSession: string } | null;
      };
      const channel = protocol.documentPreviewRuntimeChannel?.() ?? null;
      const previewDocument = protocol.documentPreviewIdentity?.() ?? null;
      return channel && previewDocument
        ? { previewDocument, previewSession: channel.previewSession }
        : null;
    })
    .catch(() => null);
}

/** The editor has the ready of the document now in the frame (as A7). */
async function frameDocumentReady(page: Page, frame: Frame) {
  const origin = new URL(frame.url()).origin;
  const iframe = await frame.frameElement();
  await expect
    .poll(
      async () => {
        const current = await documentInFrame(frame);
        if (!current) return false;
        return page.evaluate(
          ({ iframe, origin, current }) => {
            const ready = ((window as unknown as Record<string, unknown>)
              .__c1ready ?? []) as Array<Record<string, unknown>>;
            return ready.some(
              (message) =>
                message.source ===
                  (iframe as HTMLIFrameElement).contentWindow &&
                message.origin === origin &&
                message.previewSession === current.previewSession &&
                message.previewDocument === current.previewDocument,
            );
          },
          { iframe, origin, current },
        );
      },
      {
        timeout: 120_000,
        message: "the editor has the ready of the document now in the frame",
      },
    )
    .toBe(true);
}

/** A tab's own bridge-ready event (as A7). */
async function tabDocumentReady(tab: Page) {
  await expect
    .poll(
      () =>
        tab
          .evaluate(
            () =>
              ((window as unknown as Record<string, unknown>)
                .__c1bridgeReadyAt ?? null) as number | null,
          )
          .catch(() => null),
      {
        timeout: 120_000,
        message: "the tab's own bridge said its document is ready",
      },
    )
    .not.toBeNull();
}

type Probe = {
  kind: HttpKind;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

/** One probe from inside a document, on its own origin. */
function runProbeInPage(
  target: Page | Frame,
  probe: Probe,
): Promise<Omit<ProbeEvent, "surface">> {
  return target.evaluate(
    async ({ probe, marker }) => {
      // The preview's own `window.fetch` answers a same-origin
      // `/_morph/content` from the draft already in the document, without a
      // request (src/lib/storefront/compiler/theme-preview-content.ts). A
      // probe measures what the server serves, so it uses the fetch of an
      // empty same-origin frame, which nothing in the page has wrapped.
      const w = window as unknown as Record<string, unknown>;
      let holder = w.__c1fetchFrame as HTMLIFrameElement | undefined;
      if (!holder?.isConnected || !holder.contentWindow) {
        holder = document.createElement("iframe");
        holder.hidden = true;
        holder.setAttribute("data-c1-probe-fetch", "");
        document.body.appendChild(holder);
        w.__c1fetchFrame = holder;
      }
      const nativeFetch = holder.contentWindow!.fetch.bind(
        holder.contentWindow,
      );
      const t = Date.now();
      try {
        const response = await nativeFetch(
          new URL(probe.url, location.href).href,
          {
            method: probe.method,
            headers: { ...probe.headers, "x-c1-probe": probe.kind },
            body: probe.body ?? undefined,
            cache: "no-store",
            credentials: "same-origin",
            redirect: "manual",
          },
        );
        const text = await response.text();
        const refusedStatus = [401, 403, 410].includes(response.status);
        const named = /"reason":"([A-Z_]+)"/.exec(text);
        return {
          kind: probe.kind,
          t,
          answeredAt: Date.now(),
          status: response.status,
          // A refusal carries no Theme byte, only why.
          reason: refusedStatus ? (named?.[1] ?? text.slice(0, 80)) : null,
          leaked: text.includes(marker),
          error: null,
        };
      } catch (error) {
        return {
          kind: probe.kind,
          t,
          answeredAt: Date.now(),
          status: 0,
          reason: null,
          leaked: false,
          error: String(error).slice(0, 120),
        };
      }
    },
    { probe, marker: MARKER },
  );
}

/**
 * Starts the continuous probe loop inside a document: the kinds in turn, one
 * at a time, each reported through the context binding as it is answered, so
 * the record survives the document.
 */
async function startProbeLoop(
  target: Page | Frame,
  surface: Surface,
  probes: Probe[],
) {
  await target.evaluate(
    ({ probes, marker, surface, gap }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__c1stop = false;
      const emit = w.__c1emit as (event: unknown) => void;
      void (async () => {
        let i = 0;
        while (!w.__c1stop) {
          const probe = probes[i % probes.length]!;
          i += 1;
          // As runProbeInPage: an unwrapped fetch, so every probe is a request.
          let holder = w.__c1fetchFrame as HTMLIFrameElement | undefined;
          if (!holder?.isConnected || !holder.contentWindow) {
            holder = document.createElement("iframe");
            holder.hidden = true;
            holder.setAttribute("data-c1-probe-fetch", "");
            document.body.appendChild(holder);
            w.__c1fetchFrame = holder;
          }
          const nativeFetch = holder.contentWindow!.fetch.bind(
            holder.contentWindow,
          );
          const t = Date.now();
          let event: Record<string, unknown>;
          try {
            const response = await nativeFetch(
              new URL(probe.url, location.href).href,
              {
                method: probe.method,
                headers: { ...probe.headers, "x-c1-probe": probe.kind },
                body: probe.body ?? undefined,
                cache: "no-store",
                credentials: "same-origin",
                redirect: "manual",
              },
            );
            const text = await response.text();
            const refusedStatus = [401, 403, 410].includes(response.status);
            const named = /"reason":"([A-Z_]+)"/.exec(text);
            event = {
              surface,
              kind: probe.kind,
              t,
              answeredAt: Date.now(),
              status: response.status,
              reason: refusedStatus ? (named?.[1] ?? text.slice(0, 80)) : null,
              leaked: text.includes(marker),
              error: null,
            };
          } catch (error) {
            event = {
              surface,
              kind: probe.kind,
              t,
              answeredAt: Date.now(),
              status: 0,
              reason: null,
              leaked: false,
              error: String(error).slice(0, 120),
            };
          }
          try {
            emit(event);
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, gap));
        }
      })();
    },
    { probes, marker: MARKER, surface, gap: PROBE_GAP_MS },
  );
}

function socketBase(target: Page | Frame): string {
  const url = new URL(target.url());
  return url.pathname.startsWith(DEV_BASE) ? DEV_BASE : "/";
}

/** Opens the echo socket and sends a frame every 100 ms while asked to. */
async function openBusySocket(
  target: Page | Frame,
  surface: Surface,
  sock: string,
) {
  const opened = await target.evaluate(
    ({ path, sock, surface, interval }) => {
      const url = new URL(path, location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("sock", sock);
      const ws = new WebSocket(url);
      const w = window as unknown as Record<string, unknown>;
      const emit = w.__c1emit as (event: unknown) => void;
      w.__c1ws = ws;
      w.__c1wsSend = true;
      w.__c1wsSent = 0;
      ws.addEventListener("message", () => {
        try {
          emit({ surface, kind: "ws-echo", t: Date.now() });
        } catch {}
      });
      ws.addEventListener("close", (e) => {
        try {
          emit({
            surface,
            kind: "ws-close",
            t: Date.now(),
            status: e.code,
            reason: e.reason,
            wasClean: e.wasClean,
          });
        } catch {}
      });
      return new Promise<{ open: boolean; code?: number; openSentAt: number }>(
        (resolve) => {
          const openSentAt = Date.now();
          ws.addEventListener("open", () => {
            let n = 0;
            w.__c1wsTimer = setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN || !w.__c1wsSend) return;
              n += 1;
              ws.send(`b:${n}`);
              w.__c1wsSent = n;
            }, interval);
            resolve({ open: true, openSentAt });
          });
          ws.addEventListener("close", (e) =>
            resolve({ open: false, code: e.code, openSentAt }),
          );
        },
      );
    },
    {
      path: `${socketBase(target)}${ECHO}`,
      sock,
      surface,
      interval: FRAME_INTERVAL_MS,
    },
  );
  expect(opened.open, `the ${surface} socket opens on the pv- host`).toBe(true);
  return opened.openSentAt;
}

type Trigger =
  | "sign-out"
  | "revoke-other-session"
  | "ban"
  | "role-downgrade"
  | "remove-user"
  | "notice-lost"
  | "notice-lost-after-renewal"
  | "notice-lost-after-renewal-idle"
  | "grant-expiry";

const MECHANISM: Record<
  Trigger,
  { mechanism: string; pushExpected: boolean; ownUser: boolean }
> = {
  "sign-out": {
    mechanism: "POST /api/auth/sign-out (session.delete after-hook, push)",
    pushExpected: true,
    ownUser: false,
  },
  "revoke-other-session": {
    mechanism:
      "revokeSession server function from another session of the user (session.delete after-hook, push)",
    pushExpected: true,
    ownUser: false,
  },
  ban: {
    mechanism:
      "users.banned = 1 in D1 only (no HTTP ban path in Morph; no hook, no push)",
    pushExpected: false,
    ownUser: true,
  },
  "role-downgrade": {
    mechanism:
      "users.role admin -> user in D1 only (no HTTP setRole path in Morph; no hook, no push)",
    pushExpected: false,
    ownUser: true,
  },
  "remove-user": {
    mechanism:
      "user, sessions and accounts deleted in D1 only (no HTTP removeUser path in Morph; no hook, no push)",
    pushExpected: false,
    ownUser: true,
  },
  "notice-lost": {
    mechanism: "grants revoked in D1 only, 3 s after the sockets opened",
    pushExpected: false,
    ownUser: false,
  },
  "notice-lost-after-renewal": {
    mechanism:
      "grants revoked in D1 only, just after the busy sockets' first mid-life lease renewal (estimated)",
    pushExpected: false,
    ownUser: false,
  },
  "notice-lost-after-renewal-idle": {
    mechanism:
      "grants revoked in D1 only, just after the first mid-life lease renewal (estimated); the sockets send nothing after R",
    pushExpected: false,
    ownUser: false,
  },
  "grant-expiry": {
    mechanism: "grants' expires_at moved to now in D1 only (listed separately)",
    pushExpected: false,
    ownUser: false,
  },
};

/** A fresh admin of this case's own, written as seed-e2e.mjs writes one. */
async function createCaseAdmin(trigger: Trigger) {
  const { hashPassword } = await import("better-auth/crypto");
  const id = randomUUID();
  const email = `e2e-1c-${trigger}-${id.slice(0, 8)}@morph.invalid`;
  const password = `${randomUUID()}${randomUUID()}`;
  const hash = await hashPassword(password);
  const now = Date.now();
  d1Write([
    [
      `INSERT INTO users (id, name, email, email_verified, role, created_at, updated_at)
       VALUES (?, 'E2E 1c', ?, 1, 'admin', ?, ?)`,
      id,
      email,
      now,
      now,
    ],
    [
      `INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
       VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      randomUUID(),
      id,
      id,
      hash,
      now,
      now,
    ],
  ]);
  return { id, email, password };
}

async function signIn(
  context: BrowserContext,
  credentials: { email: string; password: string },
) {
  const { baseURL } = test.info().project.use;
  const signedIn = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: new URL(baseURL!).origin },
    data: credentials,
  });
  expect(signedIn.ok(), "a sign-in for this case's own session").toBe(true);
}

type CaseGrant = {
  id: string;
  kind: string;
  previewId: string;
  sessionId: string;
};

function liveGrantsOf(userId: string, since: string): CaseGrant[] {
  return d1All(
    `SELECT id, kind, preview_id, session_id FROM storefront_preview_access_grants
      WHERE user_id = ? AND revoked_at IS NULL AND created_at >= ?`,
    userId,
    since,
  ).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    previewId: String(row.preview_id),
    sessionId: String(row.session_id),
  }));
}

/** Merges this case into the timeline file, which survives a worker restart. */
function saveCase(trigger: Trigger, result: Record<string, unknown>) {
  const json = JSON.stringify(result, null, 2);
  test.info().attachments.push({
    name: `timeline-${trigger}.json`,
    contentType: "application/json",
    body: Buffer.from(json),
  });
  if (!OUT) return;
  let all: { startedAt?: string; criteria?: unknown; cases: Record<string, unknown> } = {
    cases: {},
  };
  if (existsSync(OUT)) {
    try {
      all = JSON.parse(readFileSync(OUT, "utf8"));
    } catch {
      all = { cases: {} };
    }
  }
  all.startedAt ??= new Date().toISOString();
  all.criteria = {
    targetMs: TARGET_MS,
    designDataBoundMs: LEASE_MS + SLACK_MS,
    designCloseBoundMs: LEASE_MS + TICK_MS + SLACK_MS,
    leaseMs: LEASE_MS,
    tickMs: TICK_MS,
    epsMs: SLACK_MS,
    verdict:
      "pass: T - a <= D; over: T - b > D; uncertain otherwise. HTTP: first request of every kind sent at or after b refused and none served.",
  };
  all.cases[trigger] = result;
  writeFileSync(OUT, JSON.stringify(all, null, 2));
}

async function revocationTimeline(browser: Browser, trigger: Trigger) {
  const spec = MECHANISM[trigger];
  const harnessErrors: string[] = [];
  const caseStart = new Date(Date.now() - 1_000).toISOString();
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({ baseURL });
  const events: AnyEvent[] = [];
  let bMark = Number.POSITIVE_INFINITY;
  let tab: Page | null = null;
  let other: Page | null = null;
  try {
    let userId = E2E_USER_ID;
    if (spec.ownUser) {
      const admin = await createCaseAdmin(trigger);
      userId = admin.id;
      await signIn(context, admin);
    } else {
      await signIn(context, {
        email: process.env.E2E_EMAIL!,
        password: process.env.E2E_PASSWORD!,
      });
    }
    await context.exposeBinding("__c1emit", (_source, event: AnyEvent) => {
      events.push(event);
    });
    await context.addInitScript(recordReadiness);
    const page = await context.newPage();

    // The page's own requests and sockets on the pv- host. Requests this
    // harness sent carry x-c1-probe and are recorded as probes instead.
    const surfaceOf = (owner: Page | null): Surface =>
      owner && owner === tab ? "tab" : "frame";
    const pending: Promise<unknown>[] = [];
    context.on("response", (response) => {
      const request = response.request();
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        return;
      }
      if (!url.hostname.startsWith("pv-")) return;
      if (request.headers()["x-c1-probe"]) return;
      const startedAt = request.timing().startTime;
      const t = startedAt > 0 ? Math.round(startedAt) : Date.now();
      const owner = (() => {
        try {
          return request.frame().page();
        } catch {
          return null;
        }
      })();
      const event: PassiveEvent = {
        surface: surfaceOf(owner),
        kind: "passive",
        t,
        status: response.status(),
        path: url.pathname,
        resourceType: request.resourceType(),
        leaked: null,
      };
      events.push(event);
      if (t >= bMark && served(event.status)) {
        pending.push(
          response
            .text()
            .then((text) => {
              event.leaked = text.includes(MARKER);
            })
            .catch(() => {}),
        );
      }
    });
    const watchSockets = (owner: Page, surface: () => Surface) =>
      owner.on("websocket", (socket) => {
        let path = "?";
        try {
          path = new URL(socket.url()).pathname;
        } catch {}
        if (path.endsWith(ECHO)) return;
        socket.on("close", () =>
          events.push({
            surface: surface(),
            kind: "passive-ws-close",
            t: Date.now(),
            path,
          }),
        );
      });
    watchSockets(page, () => "frame");

    // Every probe must leave the document as a request; one answered inside
    // the page (a wrapped fetch) would measure the page's memory, not the
    // server.
    const probesOnNetwork = new Map<string, number>();
    context.on("request", (request) => {
      const kind = request.headers()["x-c1-probe"];
      if (kind) probesOnNetwork.set(kind, (probesOnNetwork.get(kind) ?? 0) + 1);
    });

    // Serverfn requests the tab's client navigation makes.
    let serverFnRequest: Probe | null = null;
    context.on("request", (request) => {
      if (serverFnRequest) return;
      if (!request.url().includes("/_serverFn/")) return;
      let owner: Page | null = null;
      try {
        owner = request.frame().page();
      } catch {}
      if (!tab || owner !== tab) return;
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers())) {
        if (key.startsWith("x-tsr") || key === "accept" || key === "content-type")
          headers[key] = value;
      }
      const url = new URL(request.url());
      serverFnRequest = {
        kind: "serverFn",
        url: url.pathname + url.search,
        method: request.method(),
        headers,
        body: request.postData(),
      };
    });

    // 1. An open preview, frame and tab, each finished loading.
    await openEditor(page);
    const frame = await previewFrame(page);
    await expect(frame.locator(HERO)).toBeVisible({ timeout: 120_000 });
    await frameDocumentReady(page, frame);
    const framedHost = new URL(frame.url()).hostname;
    const [opened] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Open preview in new tab" }).click(),
    ]);
    tab = opened;
    watchSockets(tab, () => "tab");
    await tab.waitForURL(
      (url) =>
        url.hostname === framedHost &&
        !url.pathname.startsWith("/__morph/preview-auth/"),
      { timeout: 90_000 },
    );
    await expect(tab.locator(HERO)).toBeVisible({ timeout: 90_000 });
    await tabDocumentReady(tab);

    // 2. A client navigation in the tab, through a server function.
    await expect
      .poll(
        () =>
          tab!
            .evaluate(() =>
              Boolean(
                (window as unknown as { __TSR_ROUTER__?: unknown })
                  .__TSR_ROUTER__,
              ),
            )
            .catch(() => false),
        { timeout: 60_000, message: "the tab's router is up" },
      )
      .toBe(true);
    await tab.evaluate((to) =>
      (
        window as unknown as {
          __TSR_ROUTER__: { navigate: (o: { to: string }) => Promise<void> };
        }
      ).__TSR_ROUTER__.navigate({ to }),
    PROBE_ROUTE);
    await expect(tab.locator("[data-c1-probe]")).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => Boolean(serverFnRequest), {
        timeout: 30_000,
        message: "the navigation made a server-function request",
      })
      .toBe(true);

    // 3. What each document probes, and that each kind is served now.
    const moduleOf = (target: Page | Frame) =>
      target.evaluate(() => {
        const names = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => new URL(name).origin === location.origin);
        return (
          names.find((name) => name.includes("preview-content-snapshot")) ??
          names.find((name) => /\/src\/morph\//.test(name)) ??
          names.find((name) => /\/src\//.test(name)) ??
          null
        );
      });
    const targets: Array<{ surface: Surface; target: Page | Frame }> = [
      { surface: "frame", target: frame },
      { surface: "tab", target: tab },
    ];
    const plans = new Map<Surface, Probe[]>();
    const baseline: Record<string, unknown> = {};
    for (const { surface, target } of targets) {
      const moduleUrl = await moduleOf(target);
      const here = new URL(target.url());
      if (!moduleUrl) harnessErrors.push(`${surface}: no module to probe`);
      const probes: Probe[] = [
        {
          kind: "document",
          url: here.pathname + here.search,
          method: "GET",
          headers: { accept: "text/html" },
          body: null,
        },
        ...(moduleUrl
          ? [
              {
                kind: "module" as const,
                url: new URL(moduleUrl).pathname + new URL(moduleUrl).search,
                method: "GET",
                headers: {},
                body: null,
              },
            ]
          : []),
        {
          kind: "content",
          url: "/_morph/content?path=%2F",
          method: "GET",
          headers: {},
          body: null,
        },
        serverFnRequest!,
      ];
      plans.set(surface, probes);
      const results: Record<string, unknown> = {};
      let markerSeen = false;
      for (const probe of probes) {
        const sentBefore = probesOnNetwork.get(probe.kind) ?? 0;
        const answer = await runProbeInPage(target, probe);
        if ((probesOnNetwork.get(probe.kind) ?? 0) <= sentBefore)
          harnessErrors.push(
            `${surface}: the ${probe.kind} probe was answered inside the document, not sent as a request`,
          );
        results[probe.kind] = {
          status: answer.status,
          hasMarker: answer.leaked,
          error: answer.error,
        };
        if (answer.leaked) markerSeen = true;
        const mustServe = probe.kind !== "content";
        if (mustServe && !served(answer.status))
          harnessErrors.push(
            `${surface}: ${probe.kind} is not served before R (${answer.status})`,
          );
        if (refused(answer.status))
          harnessErrors.push(
            `${surface}: ${probe.kind} is refused before R (${answer.status})`,
          );
      }
      if (!markerSeen)
        harnessErrors.push(
          `${surface}: no probe carries this run's draft marker before R, so a leak could not be seen`,
        );
      baseline[surface] = {
        module: moduleUrl ? new URL(moduleUrl).pathname.split("/").pop() : null,
        results,
      };
    }
    expect(harnessErrors, "the open preview serves the draft before R").toEqual(
      [],
    );

    // 4. One echo socket in each, busy.
    const openSent: Record<Surface, number> = { frame: 0, tab: 0 };
    const socks: Record<Surface, string> = {
      frame: `${trigger}-frame-${Date.now()}`,
      tab: `${trigger}-tab-${Date.now()}`,
    };
    for (const { surface, target } of targets) {
      openSent[surface] = await openBusySocket(target, surface, socks[surface]);
    }
    const firstEcho = (surface: Surface) =>
      events.find((e) => e.kind === "ws-echo" && e.surface === surface)?.t ??
      null;
    await expect
      .poll(() => Boolean(firstEcho("frame") && firstEcho("tab")), {
        timeout: 30_000,
        message: "both sockets echo (registration verified)",
      })
      .toBe(true);

    const grants = liveGrantsOf(userId, caseStart);
    const kinds = new Set(grants.map((g) => g.kind));
    expect(
      [...kinds].sort(),
      "this case's live iframe and tab grants",
    ).toEqual(["iframe", "tab"]);
    expect(
      new Set(grants.map((g) => g.sessionId)).size,
      "every grant of this case is on its one session",
    ).toBe(1);

    // 5. When to revoke.
    let renewalEstimate: Record<string, unknown> | null = null;
    if (
      trigger === "notice-lost-after-renewal" ||
      trigger === "notice-lost-after-renewal-idle"
    ) {
      // Inference: the registration verification V0 is sent after the open
      // was sent and before the first echo; a busy socket renews on its first
      // frame at or after V0 + L/2. Revoke once both renewals have been sent
      // and answered (a local D1 round trip; 500 ms allowed).
      const windows = Object.fromEntries(
        (["frame", "tab"] as const).map((s) => [
          s,
          {
            from: openSent[s] + LEASE_MS / 2,
            to: firstEcho(s)! + LEASE_MS / 2 + FRAME_INTERVAL_MS,
          },
        ]),
      );
      const revokeAt =
        Math.max(windows.frame!.to, windows.tab!.to) + 500;
      renewalEstimate = { inference: true, windows, plannedRevokeAt: revokeAt };
      while (Date.now() < revokeAt) await page.waitForTimeout(50);
    } else {
      await page.waitForTimeout(3_000);
    }

    // Prepared before R so the window is the trigger alone.
    if (trigger === "revoke-other-session") {
      other = await (
        await browser.newContext({
          baseURL,
          storageState: test.info().project.use.storageState,
        })
      ).newPage();
      await other.goto("/", { waitUntil: "domcontentloaded" });
    }
    for (const { surface, target } of targets) {
      await startProbeLoop(target, surface, plans.get(surface)!);
    }
    await page.waitForTimeout(500);

    // 6. R in [a, b].
    const grantIds = grants.map((g) => g.id);
    const placeholders = grantIds.map(() => "?").join(", ");
    const sessionId = grants[0]!.sessionId;
    let a = 0;
    let b = 0;
    let triggerAnswer: Record<string, unknown> = {};
    const stopSending = async () => {
      if (trigger !== "notice-lost-after-renewal-idle") return;
      for (const { target } of targets) {
        await target
          .evaluate(() => {
            (window as unknown as Record<string, unknown>).__c1wsSend = false;
          })
          .catch(() => {});
      }
    };
    switch (trigger) {
      case "sign-out": {
        a = Date.now();
        const out = await context.request.post("/api/auth/sign-out", {
          headers: { origin: new URL(baseURL!).origin },
          data: {},
        });
        b = Date.now();
        triggerAnswer = { status: out.status() };
        if (!out.ok()) harnessErrors.push(`sign-out answered ${out.status()}`);
        break;
      }
      case "revoke-other-session": {
        a = Date.now();
        const result = (await serverFn(other!, REVOKE_SESSION, "revokeSession", {
          id: sessionId,
        })) as { success?: boolean; message?: string };
        b = Date.now();
        triggerAnswer = { success: result?.success ?? null };
        if (!result?.success)
          harnessErrors.push(`revokeSession: ${result?.message ?? "failed"}`);
        break;
      }
      case "ban":
      case "role-downgrade":
      case "remove-user": {
        const statements: Array<[string, ...unknown[]]> =
          trigger === "ban"
            ? [
                [
                  "UPDATE users SET banned = 1, ban_reason = 'e2e 1c', updated_at = ? WHERE id = ?",
                  Date.now(),
                  userId,
                ],
              ]
            : trigger === "role-downgrade"
              ? [
                  [
                    "UPDATE users SET role = 'user', updated_at = ? WHERE id = ?",
                    Date.now(),
                    userId,
                  ],
                ]
              : [
                  ["DELETE FROM sessions WHERE user_id = ?", userId],
                  ["DELETE FROM accounts WHERE user_id = ?", userId],
                  ["DELETE FROM users WHERE id = ?", userId],
                ];
        a = Date.now();
        const changed = d1Write(statements);
        b = Date.now();
        triggerAnswer = { rowsChanged: changed };
        break;
      }
      case "grant-expiry": {
        a = Date.now();
        const stamp = new Date(a).toISOString();
        const changed = d1Write([
          [
            `UPDATE storefront_preview_access_grants SET expires_at = ?, updated_at = ?
              WHERE id IN (${placeholders})`,
            stamp,
            stamp,
            ...grantIds,
          ],
        ]);
        b = Date.now();
        triggerAnswer = { grantsExpired: changed };
        break;
      }
      default: {
        a = Date.now();
        const stamp = new Date(a).toISOString();
        const changed = d1Write([
          [
            `UPDATE storefront_preview_access_grants SET revoked_at = ?, updated_at = ?
              WHERE id IN (${placeholders})`,
            stamp,
            stamp,
            ...grantIds,
          ],
        ]);
        b = Date.now();
        triggerAnswer = { grantsRevokedInD1Only: changed };
      }
    }
    bMark = b;
    await stopSending();
    const readBackAt = Date.now();
    const readBack: {
      at: number;
      grants: Array<Record<string, unknown>>;
      user: unknown;
    } = {
      at: readBackAt,
      grants: d1All(
        `SELECT id, kind, preview_id, revoked_at, expires_at FROM storefront_preview_access_grants
          WHERE id IN (${placeholders})`,
        ...grantIds,
      ).map((row) => ({
        grantId: row.id,
        kind: row.kind,
        previewId: row.preview_id,
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
      })),
      user: spec.ownUser
        ? (d1All("SELECT role, banned FROM users WHERE id = ?", userId)[0] ??
          "deleted")
        : undefined,
    };
    if (spec.pushExpected) {
      for (const grant of readBack.grants) {
        if (!grant.revokedAt)
          harnessErrors.push(`grant ${String(grant.grantId)} not revoked in D1`);
      }
    }
    if (trigger === "ban" && (readBack.user as { banned?: number })?.banned !== 1)
      harnessErrors.push("the user row is not banned");
    if (
      trigger === "role-downgrade" &&
      (readBack.user as { role?: string })?.role !== "user"
    )
      harnessErrors.push("the user row was not downgraded");
    if (trigger === "remove-user" && readBack.user !== "deleted")
      harnessErrors.push("the user row was not removed");

    // 7. Observe until both sockets closed (or the wait ran out), and probe
    // on after.
    const closeOf = (surface: Surface) =>
      events.find(
        (e): e is Extract<WsEvent, { kind: "ws-close" }> =>
          e.kind === "ws-close" && e.surface === surface,
      ) ?? null;
    const deadline = b + CLOSE_WAIT_MS;
    while (
      Date.now() < deadline &&
      !(closeOf("frame") && closeOf("tab"))
    ) {
      await page.waitForTimeout(200);
    }
    const lastClose = Math.max(
      closeOf("frame")?.t ?? 0,
      closeOf("tab")?.t ?? 0,
    );
    const probeUntil = Math.max(b + MIN_PROBE_AFTER_B_MS, lastClose + 2_000);
    while (Date.now() < probeUntil) await page.waitForTimeout(200);
    for (const { target } of targets) {
      await target
        .evaluate(() => {
          const w = window as unknown as Record<string, unknown>;
          w.__c1stop = true;
          clearInterval(w.__c1wsTimer as number);
        })
        .catch(() => {});
    }
    await page.waitForTimeout(1_500);
    await Promise.all(pending);

    // 8. The timeline, per path.
    const paths: Array<Record<string, unknown>> = [];
    const leaks: string[] = [];
    for (const surface of ["frame", "tab"] as const) {
      const probes = events.filter(
        (e): e is ProbeEvent =>
          e.surface === surface &&
          (HTTP_KINDS as readonly string[]).includes(e.kind),
      );
      const passive = events.filter(
        (e): e is PassiveEvent | PassiveSocketEvent =>
          e.surface === surface &&
          (e.kind === "passive" || e.kind === "passive-ws-close") &&
          e.t >= a - 2_000,
      );
      const byKind: Record<string, unknown> = {};
      const kindVerdicts: Verdict[] = [];
      for (const kind of plans.get(surface)!.map((p) => p.kind)) {
        const after = probes
          .filter((p) => p.kind === kind && p.t >= b)
          .sort((x, y) => x.t - y.t);
        if (after.length === 0) {
          harnessErrors.push(`${surface} ${kind}: no request sent after b`);
          continue;
        }
        const servedAfter = after.filter((p) => served(p.status));
        const first = after[0]!;
        const verdict: Verdict = servedAfter.length
          ? "over"
          : refused(first.status)
            ? "pass"
            : "uncertain";
        kindVerdicts.push(verdict);
        byKind[kind] = {
          verdict,
          sentAfterB: after.length,
          servedAfterB: servedAfter.length,
          firstAfterB: {
            t: first.t,
            status: first.status,
            reason: first.reason,
          },
        };
      }
      for (const p of probes) {
        if (p.leaked && p.t >= b)
          leaks.push(`${surface} ${p.kind} sent at b+${p.t - b} ms`);
      }
      for (const p of passive) {
        if (p.kind === "passive" && p.leaked && p.t >= b)
          leaks.push(`${surface} passive ${p.path} at b+${p.t - b} ms`);
        if (p.kind === "passive" && served(p.status) && p.t >= b)
          kindVerdicts.push("over");
      }
      const refusedAfterA = probes.filter((p) => refused(p.status) && p.t >= a);
      const servedAll = probes.filter((p) => served(p.status));
      const firstRefused = refusedAfterA.sort((x, y) => x.t - y.t)[0] ?? null;
      const httpEvents = [
        ...probes.filter((p) => p.t >= a - 2_000),
        ...passive,
      ]
        .sort((x, y) => x.t - y.t)
        .map((e) => ({ ...e, dt: e.t - a }));
      paths.push({
        path: `${trigger}/${surface}/http`,
        kind: "http",
        trigger,
        surface,
        a,
        b,
        events: httpEvents,
        firstRefusedAt: firstRefused?.t ?? null,
        firstRefusedAnsweredAt: firstRefused?.answeredAt ?? null,
        lastServedAt: servedAll.length
          ? Math.max(...servedAll.map((p) => p.t))
          : null,
        dataStoppedAt: null,
        closedAt: null,
        verdict: kindVerdicts.length ? worst(kindVerdicts) : "uncertain",
        byKind,
        refusalDelay: firstRefused
          ? judge(firstRefused.answeredAt, a, b, TARGET_MS)
          : null,
      });

      // WebSocket.
      const record = fixtureRecord(socks[surface]);
      if (!record) harnessErrors.push(`${surface}: the fixture record was not read`);
      const echoes = events.filter(
        (e) => e.kind === "ws-echo" && e.surface === surface,
      );
      const lastEchoAt = echoes.length ? Math.max(...echoes.map((e) => e.t)) : null;
      const close = closeOf(surface);
      const candidates = [lastEchoAt, record?.lastReceivedAt ?? null].filter(
        (t): t is number => typeof t === "number",
      );
      const dataStoppedAt = candidates.length ? Math.max(...candidates) : null;
      if (dataStoppedAt === null) harnessErrors.push(`${surface}: no socket data`);
      const data =
        dataStoppedAt === null ? null : judge(dataStoppedAt, a, b, TARGET_MS);
      // Not closed within the wait: at least CLOSE_WAIT_MS after b.
      const closeT = close?.t ?? deadline;
      const closed = judge(closeT, a, b, TARGET_MS);
      paths.push({
        path: `${trigger}/${surface}/ws`,
        kind: "ws",
        trigger,
        surface,
        a,
        b,
        events: [
          ...echoes.filter((e) => e.t >= a - 1_000),
          ...(close ? [close] : []),
        ]
          .sort((x, y) => x.t - y.t)
          .map((e) => ({ ...e, dt: e.t - a })),
        firstRefusedAt: null,
        lastServedAt: null,
        dataStoppedAt,
        closedAt: close?.t ?? null,
        closeCode: close?.status ?? null,
        closeTimedOut: !close,
        container: record
          ? {
              received: record.received,
              lastReceivedAt: record.lastReceivedAt,
              closedAt: record.closedAt,
              closeCode: record.closeCode,
            }
          : null,
        framesSentAfterR:
          trigger === "notice-lost-after-renewal-idle" ? 0 : undefined,
        verdict: worst([data?.verdict ?? "pass", closed.verdict]),
        verdicts: {
          dataWithin30s: data,
          closeWithin30s: closed,
          dataWithinDesignBound:
            dataStoppedAt === null
              ? null
              : judge(dataStoppedAt, a, b, LEASE_MS + SLACK_MS),
          closeWithinDesignBound: judge(
            closeT,
            a,
            b,
            LEASE_MS + TICK_MS + SLACK_MS,
          ),
        },
      });
    }

    const result = {
      trigger,
      separate: trigger === "grant-expiry",
      mechanism: spec.mechanism,
      pushExpected: spec.pushExpected,
      ownUser: spec.ownUser,
      grants: grants.map((g) => ({
        grantId: g.id,
        kind: g.kind,
        previewId: g.previewId,
      })),
      a,
      b,
      windowMs: b - a,
      triggerAnswer,
      readBack,
      renewalEstimate,
      baseline,
      paths,
      harnessErrors,
      leaks,
    };
    saveCase(trigger, result);
    for (const p of paths) {
      console.log(
        `[1c] ${String(p.path)} verdict=${String(p.verdict)} window=${b - a}ms` +
          (p.kind === "ws"
            ? ` data=${p.dataStoppedAt === null ? "-" : Number(p.dataStoppedAt) - a}ms close=${p.closedAt === null ? "none" : Number(p.closedAt) - a}ms code=${String(p.closeCode)}`
            : ` firstRefused=${p.firstRefusedAt === null ? "-" : Number(p.firstRefusedAt) - a}ms`),
      );
    }

    expect(leaks, "no draft byte is served after b").toEqual([]);
    expect(harnessErrors, "the measurement was made").toEqual([]);
  } finally {
    await other?.context().close().catch(() => {});
    await context.close().catch(() => {});
  }
}

test.describe("1c: the revocation timeline of an open Live Preview", () => {
  test.setTimeout(8 * 60_000);

  test("setup: the Theme's test-only socket and server-function fixtures, and this run's draft", async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    const scope = themeScopeFromEditorPath(EDITOR_PATH!);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await serverFn(page, PREVIEW, "stopThemePreviewServer", scope).catch(
      () => {},
    );
    const saved = await writeThemeFiles(page, scope, [
      { path: "src/server.js", content: FIXTURE },
      { path: `src/routes${PROBE_ROUTE}.tsx`, content: PROBE_ROUTE_SOURCE },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    await openEditor(page);
    const frame = await previewFrame(page);
    await expect(frame.locator(HERO)).toBeVisible({ timeout: 120_000 });
    await editHero(page, MARKER);
    await savedField(page, scope, MARKER);
    await expect(
      frame.getByText(MARKER, { exact: false }).first(),
      "the frame shows this run's draft",
    ).toBeVisible({ timeout: 90_000 });
  });

  test("sign-out: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "sign-out");
  });

  test("revoke-other-session: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "revoke-other-session");
  });

  test("ban: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "ban");
  });

  test("role-downgrade: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "role-downgrade");
  });

  test("remove-user: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "remove-user");
  });

  test("notice-lost: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "notice-lost");
  });

  test("notice-lost-after-renewal: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "notice-lost-after-renewal");
  });

  test("notice-lost-after-renewal-idle: HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "notice-lost-after-renewal-idle");
  });

  test("grant-expiry (listed separately): HTTP and WebSocket timeline of an open frame and tab", async ({
    browser,
  }) => {
    await revocationTimeline(browser, "grant-expiry");
  });
});
