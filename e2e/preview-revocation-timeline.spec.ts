import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
 *   notice-lost-after-renewal the same, revoked at once after each case
 *                             socket's lease was renewed: its SECOND
 *                             successful verification (the registration's is
 *                             the first), as the Durable Object reports it
 *                             (see "Renewal" below). Never on an estimate.
 *                             No renewal seen: INCOMPLETE.
 *   notice-lost-after-renewal-idle
 *                             the same, and the sockets send nothing after R:
 *                             only the lease tick can end them (the design's
 *                             worst case, R + L + tick + eps = 37 s)
 *   grant-expiry              listed separately: `expires_at` moved to now
 *                             in D1 only
 *
 * Preparation and the formal case (user decision 2026-11-22). Every sign-in a
 * case needs is made in its preparation, before the formal case starts; each
 * attempt is recorded (time, 429 or not, Retry-After, wait applied). A 429
 * waits once, for the Retry-After it names; a second 429 ends preparation and
 * the case is INCOMPLETE. Once the formal case has started, a sign-in request
 * (from the harness or any page of the case) or an auth redirect of a case
 * page to /sign-in before R makes the case INCOMPLETE: it fails with
 * "incomplete: re-login during formal case", is never retried and never
 * passes. (After R, a redirect to /sign-in is the revocation's own effect and
 * is only recorded.)
 *
 * Renewal (user decision 2026-11-22). A grant's stored `expires_at` never
 * moves; what renews is the socket lease's `V`, in the preview's Durable
 * Object. With MORPH_PREVIEW_LEASE_EVENTS=1 in what Wrangler loads, the
 * DO writes `[preview-lease-verified] {connectionId, grantId, path, sequence,
 * sentAt, settledAt}` each time a "valid" result has advanced `V`
 * (preview-socket-lease-events.ts). The dev server prints it, and the
 * run's log (M1_1C_WORKER_LOG, the runner's captured output) is read from
 * where this case started, never written.
 *
 * Which connection is the case's: a line whose grant is one of this case's
 * grants and whose path is the echo socket's, and whose first verification
 * (sequence 1, sent synchronously at registration, before the 101) was sent
 * inside that socket's open window [sent, open returned] (±5 ms rounding).
 * The two sockets are opened one after the other, so the windows barely
 * touch; a registration inside both is ambiguous, and exactly one connection
 * must fall in each window. Anything else is INCOMPLETE, never guessed.
 *
 * For each of the two connections the case waits for sequence 2, the first
 * renewal; once both are in, it revokes at once. "Verification effective"
 * is that line's settledAt (V updated), "revoke committed" is b (the D1
 * write returned). The window between them is fixed in advance at
 * VERIFY_TO_REVOKE_WINDOW_MS = 1 s for every connection; over it, the case is
 * INCOMPLETE (still measured and saved). Why 1 s: the worst case is R right
 * at the renewal, and every ms R comes later shortens what is measured (the
 * lease still lapses at V + L), so the window bounds how far the case may
 * understate the worst case. 1 s is half the design's eps (2 s), so a
 * measurement within it still says something about L + eps, and it leaves
 * room for the log path (DO console → dev server → log file → this reader,
 * polled every 20 ms), the D1 write, and the two sockets' renewals falling
 * a few hundred ms apart (they are opened one after the other).
 *
 * Also for the after-renewal cases: a prefixed lease line that does not parse,
 * read between the formal start and just after R, makes the case INCOMPLETE
 * (it could have been one of these connections'); each connection must name
 * its own surface's grant (frame: iframe, tab: tab); b - sentAt(#2) is
 * reported beside the window; and no line of sequence 3 or later for these
 * connections may have been sent at or before b (a harness error). With
 * MORPH_PREVIEW_LEASE_EVENTS off no line is written, so the connections
 * cannot be proven and both cases are INCOMPLETE, which fails them; they can
 * never pass with the switch off.
 *
 * Live at R (every case). Each socket must have an echo, or a container
 * receipt (the fixture keeps receipt times), within LIVE_BEFORE_MS = 500 ms
 * before a, and must still be open at b; otherwise a harness error. The idle
 * case stops sending just BEFORE a (so nothing it sends can follow R), and is
 * judged live just before that stop; it records the frames the page had sent
 * and the container had received at the stop and at b, and framesSentAfterR
 * is derived from them (frames sent after the stop, which must be 0).
 *
 * Verdicts, as A7 judges them. With R in [a, b] and an event at T, against a
 * limit D: pass T - a <= D; over T - b > D; uncertain otherwise. Only pass is
 * a pass; the margin (eps) only ever yields uncertain. D = 30 s
 * (§7 Q3). The design bounds (data L + eps = 32 s, close L + tick + eps =
 * 37 s) are judged the same way and asserted (below), never used in place of
 * the 30 s verdicts.
 *
 *   HTTP, per kind: pass when the first request sent at or after b is
 *   refused (401/403/410) and was itself sent within 30 s of a (t - a <= D),
 *   and none sent at or after b is served; over when one is served;
 *   uncertain otherwise. Each kind carries its own refusalDelay; the path's
 *   verdict is the worst of its kinds, and `firstRefusalAnyKind` is labelled
 *   as just that.
 *   WebSocket: data stopped (the last data frame either end received) and
 *   closed, each judged against 30 s; the path's verdict is the worse. In
 *   the idle case the data stop is the harness's own (sending stopped before
 *   a), so its data verdicts are "not applicable", never "met".
 *
 * Served after b. Any probe SENT at or after b that is served (2xx/3xx)
 * fails the case, whether or not it carries the marker. The pages' own pv-
 * requests after b are recorded with a class (preview-auth, hmr, module,
 * content, serverFn, document-or-other); a served one fails the case unless
 * its class is exempt. Exempt: preview-auth only, because
 * /__morph/preview-auth/ is Morph's own access hand-off, answered by the
 * Worker before any grant is used, and it carries no Theme byte (a marker in
 * it would still fail as a leak). Not exempt: hmr, since Vite's client and
 * modules come from the container through the same grant check as any Theme
 * byte, so serving them after b is a gate gap, not legitimate traffic.
 *
 * The trigger itself is checked (every case): a D1-only revocation must
 * change exactly this case's grant rows; grant-expiry must change them and
 * read back expires_at = a; a pushed revocation must read back revoked_at
 * inside [a, b].
 *
 * This spec reports the 30 s verdicts; "over" (recorded as "not met") and
 * "uncertain" do not fail it. The 30 s threshold stands and its guarantee is
 * unproven: a run's numbers are trial observations, never a proof of "within
 * 30 s". It fails on a harness error (a precondition that did not hold, a
 * measurement that could not be made), on an incomplete case, on any draft
 * byte served after b, and on anything served after b as above. EVERY case
 * also asserts the design's existing limits: data stopped within L + eps =
 * 32 s (idle: not applicable) and closed with 4401 within L + tick + eps =
 * 37 s, each a "pass" (T - a <= D). A failed case writes its record, marked
 * "failed" with why, before it fails.
 *
 * Logs and the timeline carry grant, preview and connection ids only: no
 * cookie, token, session id, grant secret or password.
 */

const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
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
  PREVIEW_RUNTIME !== "start",
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
/** Receipt times the echo fixture keeps per socket (~200 s of frames). */
const RECEIPTS_KEPT = 2_000;
/**
 * A socket counts as live at R only with an echo or a container receipt
 * within this long before a (idle case: before sending stopped): five frame
 * intervals.
 */
const LIVE_BEFORE_MS = 500;
const PROBE_GAP_MS = 100;
/** How long after b a socket may take to close before it counts as not closed. */
const CLOSE_WAIT_MS = 75_000;
/** Probing continues at least this long after b, and 2 s after the last close. */
const MIN_PROBE_AFTER_B_MS = 5_000;
/**
 * How long, after the later socket's first echo, the after-renewal cases wait
 * for each case socket's first lease renewal (its sequence 2). A busy
 * socket's lease renews from L/2 on, so twice the lease is well past where a
 * renewal is due. Not seen by then: the case is incomplete.
 */
const RENEWAL_WAIT_MS = 2 * LEASE_MS;
/** How often the run's log is read for new lease lines. */
const LEASE_EVENT_POLL_MS = 20;
/** Fixed in advance; see "Renewal" above. */
const VERIFY_TO_REVOKE_WINDOW_MS = 1_000;
/**
 * Slack on each socket's open window: the page, this process and the DO read
 * one machine clock, in whole ms, so only rounding is allowed for.
 */
const OPEN_WINDOW_SLACK_MS = 5;
/** How long after both first echoes the registration lines may take. */
const REGISTRATION_LINE_WAIT_MS = 10_000;
const WORKER_LOG = process.env.M1_1C_WORKER_LOG;
// preview-socket-lease-events.ts
const LEASE_VERIFIED_PREFIX = "[preview-lease-verified]";
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

/** The 30 s target in words: "over" is recorded as not met, never hidden. */
const TARGET_LABEL: Record<Verdict, string> = {
  pass: "met",
  uncertain: "uncertain",
  over: "not met",
};
function judgeTarget(t: number, a: number, b: number) {
  const judged = judge(t, a, b, TARGET_MS);
  return { ...judged, target: TARGET_LABEL[judged.verdict] };
}

/** A case that could not be measured as the criteria require. */
class IncompleteCase extends Error {}

const FIXTURE = `import startEntry from "@tanstack/react-start/server-entry";

// Test-only fixture (M1 acceptance 1c). One path answers with a socket that
// echoes every frame and records, by the container's clock, what it received
// and when it closed; another returns that record.
const ECHO = ${JSON.stringify(`/${ECHO}`)};
const LOG = ${JSON.stringify(`/${LOG}`)};
const RECEIPTS_KEPT = ${RECEIPTS_KEPT};
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
      // The latest receipts' times, so counts at any recent instant can be
      // derived afterwards without reading the record at that instant.
      receivedAt: [],
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
      record.receivedAt.push(record.lastReceivedAt);
      if (record.receivedAt.length > RECEIPTS_KEPT) record.receivedAt.shift();
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
  /** The latest RECEIPTS_KEPT receipt times, oldest first. */
  receivedAt?: number[];
  closedAt: number | null;
  closeCode: number | null;
};

/**
 * How many frames the container had received by `at`, from its record read
 * later: exact while the kept receipts reach back to `at`, else null.
 */
function receivedBy(record: FixtureRecord | null, at: number): number | null {
  const times = record?.receivedAt;
  if (!record || !times) return null;
  const after = times.filter((x) => x > at).length;
  if (after === times.length && record.received > times.length) return null;
  return record.received - after;
}

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

/**
 * What a page's own pv- request after b was (M1; see "Served after b" in the
 * header). Only "preview-auth" is exempt.
 */
type PassiveClass =
  | "preview-auth"
  | "hmr"
  | "module"
  | "content"
  | "serverFn"
  | "document-or-other";
function classifyPassive(path: string): PassiveClass {
  if (path.startsWith("/__morph/preview-auth/")) return "preview-auth";
  if (
    /(^|\/)@(vite|id|fs|react-refresh)(\/|$)/.test(path) ||
    path.includes("/node_modules/.vite/")
  )
    return "hmr";
  if (path.startsWith("/_morph/content")) return "content";
  if (path.includes("/_serverFn/")) return "serverFn";
  if (/\.(m?[jt]sx?|css)$/.test(path) || /\/src\//.test(path)) return "module";
  return "document-or-other";
}
const PASSIVE_EXEMPT: ReadonlySet<PassiveClass> = new Set(["preview-auth"]);

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
      "grants revoked in D1 only, at once after each case socket's lease renewal (its second successful verification, the DO's [preview-lease-verified] sequence 2) was seen; the sockets keep sending",
    pushExpected: false,
    ownUser: false,
  },
  "notice-lost-after-renewal-idle": {
    mechanism:
      "grants revoked in D1 only, at once after each case socket's lease renewal (its second successful verification, the DO's [preview-lease-verified] sequence 2) was seen; the pages stop sending just before a, so the sockets send nothing after R",
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

type SignInAttempt = {
  at: number;
  status: number;
  rateLimited: boolean;
  /** The Retry-After the 429 named, in seconds, as sent; null otherwise. */
  retryAfter: string | null;
  /** The wait applied after this attempt before the next, in ms. */
  waitAppliedMs: number;
};
type Preparation = {
  trigger: Trigger;
  startedAt: number;
  endedAt: number | null;
  attempts: SignInAttempt[];
  ok: boolean;
  failure: string | null;
};

/**
 * The case's sign-in, in its preparation only. The cases sign in one after
 * another from one address, and Morph allows 5 sign-ins per 60 s there
 * (src/auth/index.ts rateLimit), so a case may meet a 429. The limit is
 * honoured, not reset: one wait, for the Retry-After it names. A second 429
 * ends the preparation and the case is incomplete.
 */
async function prepareSignIn(
  context: BrowserContext,
  credentials: { email: string; password: string },
  preparation: Preparation,
  formal: { started: boolean },
) {
  if (formal.started) {
    // Never reached by this spec's own flow; a guard, not a retry path.
    throw new IncompleteCase("incomplete: re-login during formal case (harness sign-in)");
  }
  const { baseURL } = test.info().project.use;
  const post = async () => {
    const at = Date.now();
    const response = await context.request.post("/api/auth/sign-in/email", {
      headers: { origin: new URL(baseURL!).origin },
      data: credentials,
    });
    const rateLimited = response.status() === 429;
    const headers = response.headers();
    const attempt: SignInAttempt = {
      at,
      status: response.status(),
      rateLimited,
      retryAfter: rateLimited
        ? (headers["retry-after"] ?? headers["x-retry-after"] ?? null)
        : null,
      waitAppliedMs: 0,
    };
    preparation.attempts.push(attempt);
    return { response, attempt };
  };
  let { response, attempt } = await post();
  if (attempt.rateLimited) {
    const seconds = Number(attempt.retryAfter ?? "60");
    attempt.waitAppliedMs =
      (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1_000 + 1_000;
    console.log(
      `[1c] preparation ${preparation.trigger}: sign-in 429, Retry-After=${String(attempt.retryAfter)}; waiting ${attempt.waitAppliedMs} ms once`,
    );
    await new Promise((resolve) => setTimeout(resolve, attempt.waitAppliedMs));
    ({ response, attempt } = await post());
    if (attempt.rateLimited) {
      preparation.failure =
        "incomplete: sign-in preparation rate limited again after its one Retry-After wait";
      throw new IncompleteCase(preparation.failure);
    }
  }
  if (!response.ok()) {
    preparation.failure = `incomplete: sign-in preparation answered ${response.status()}`;
    throw new IncompleteCase(preparation.failure);
  }
}

type CaseGrant = {
  id: string;
  kind: string;
  previewId: string;
  sessionId: string;
  expiresAt: string;
};

function liveGrantsOf(userId: string, since: string): CaseGrant[] {
  return d1All(
    `SELECT id, kind, preview_id, session_id, expires_at FROM storefront_preview_access_grants
      WHERE user_id = ? AND revoked_at IS NULL AND created_at >= ?`,
    userId,
    since,
  ).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    previewId: String(row.preview_id),
    sessionId: String(row.session_id),
    expiresAt: String(row.expires_at),
  }));
}

/** A colour code a terminal-aware dev server may put around a line. */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** One `[preview-lease-verified]` line, as the Durable Object wrote it. */
type LeaseLine = {
  connectionId: string;
  grantId: string;
  path: string;
  sequence: number;
  sentAt: number;
  settledAt: number;
  /** When this reader first saw the line (this process's clock). */
  seenAt: number;
};

/**
 * Reads the run's log for lease lines, from the size it had when the reader
 * was made: only this case's lines, and read-only (the runner is the log's
 * one writer). A line is taken from its prefix to its end, whatever the dev
 * server put before it; a line still being written waits for its newline.
 */
function leaseLineReader(file: string) {
  let offset = existsSync(file) ? statSync(file).size : 0;
  let partial = "";
  const lines: LeaseLine[] = [];
  const malformed: string[] = [];
  const read = () => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size <= offset) return;
    const fd = openSync(file, "r");
    try {
      const buffer = Buffer.alloc(size - offset);
      const got = readSync(fd, buffer, 0, buffer.length, offset);
      offset += got;
      partial += buffer.subarray(0, got).toString("utf8");
    } finally {
      closeSync(fd);
    }
    const parts = partial.split(/\r?\n/);
    partial = parts.pop() ?? "";
    const seenAt = Date.now();
    for (const raw of parts) {
      const at = raw.indexOf(LEASE_VERIFIED_PREFIX);
      if (at < 0) continue;
      const text = raw
        .slice(at + LEASE_VERIFIED_PREFIX.length)
        .replace(ANSI_COLOUR, "")
        .trim();
      try {
        const v = JSON.parse(text) as Record<string, unknown>;
        if (
          typeof v.connectionId !== "string" ||
          typeof v.grantId !== "string" ||
          typeof v.path !== "string" ||
          typeof v.sequence !== "number" ||
          typeof v.sentAt !== "number" ||
          typeof v.settledAt !== "number"
        ) {
          malformed.push(text.slice(0, 200));
          continue;
        }
        lines.push({
          connectionId: v.connectionId,
          grantId: v.grantId,
          path: v.path,
          sequence: v.sequence,
          sentAt: v.sentAt,
          settledAt: v.settledAt,
          seenAt,
        });
      } catch {
        malformed.push(text.slice(0, 200));
      }
    }
  };
  return { read, lines, malformed };
}

type CaseConnection = {
  surface: Surface;
  connectionId: string;
  grantId: string;
  grantKind: string | null;
  path: string;
  /** The socket's open window this connection's registration fell in. */
  openWindow: { from: number; to: number };
  registration: LeaseLine;
  /** Its sequence 2: the first renewal. */
  renewal: LeaseLine | null;
};

/**
 * Finds the case's two echo connections among the lease lines (see
 * "Renewal" in the header). Returns why when it cannot prove them.
 */
function caseConnections(
  lines: LeaseLine[],
  grants: CaseGrant[],
  windows: Record<Surface, { from: number; to: number }>,
): { connections: CaseConnection[] } | { reason: string; candidates: unknown } {
  const grantKind = new Map(grants.map((g) => [g.id, g.kind]));
  const registrations = lines.filter(
    (l) => l.sequence === 1 && grantKind.has(l.grantId) && l.path.endsWith(`/${ECHO}`),
  );
  const candidates = registrations.map((l) => ({
    connectionId: l.connectionId,
    grantId: l.grantId,
    path: l.path,
    sentAt: l.sentAt,
  }));
  const within = (l: LeaseLine, surface: Surface) =>
    l.sentAt >= windows[surface].from - OPEN_WINDOW_SLACK_MS &&
    l.sentAt <= windows[surface].to + OPEN_WINDOW_SLACK_MS;
  // A registration inside both windows could be either socket's.
  const both = registrations.filter((l) => within(l, "frame") && within(l, "tab"));
  if (both.length) {
    return {
      reason: `${both.length} echo connection(s) registered where the two sockets' open windows overlap (frame ${windows.frame.from}..${windows.frame.to}, tab ${windows.tab.from}..${windows.tab.to})`,
      candidates,
    };
  }
  const connections: CaseConnection[] = [];
  for (const surface of ["frame", "tab"] as const) {
    const w = windows[surface];
    const inWindow = registrations.filter((l) => within(l, surface));
    if (inWindow.length !== 1) {
      return {
        reason: `${inWindow.length} echo connections of this case's grants registered inside the ${surface} socket's open window (${w.from}..${w.to}); exactly 1 is required`,
        candidates,
      };
    }
    const registration = inWindow[0]!;
    connections.push({
      surface,
      connectionId: registration.connectionId,
      grantId: registration.grantId,
      grantKind: grantKind.get(registration.grantId) ?? null,
      path: registration.path,
      openWindow: w,
      registration,
      renewal: null,
    });
  }
  if (connections[0]!.connectionId === connections[1]!.connectionId) {
    return { reason: "both sockets resolved to one connection", candidates };
  }
  return { connections };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      "pass: T - a <= D; over: T - b > D; uncertain otherwise. HTTP, per kind: the first request sent at or after b refused and sent within 30 s of a, and none served. Idle case: data verdicts not applicable.",
    failsOn:
      "harness error (incl. a socket closed before b or not live within 500 ms before a / the idle stop; trigger rows or read-back wrong), incomplete case, draft byte after b, any probe sent at or after b served, a non-exempt page request after b served (exempt: preview-auth only), and in EVERY case design limits not met: data within 32 s (idle: not applicable) and 4401 close within 37 s, each a pass.",
    target:
      "TARGET 30 s reported with the same verdicts: pass = met, over = not met, uncertain = uncertain. The 30 s threshold stands; its guarantee is unproven, and these numbers are trial observations.",
    preparation:
      "Sign-ins only before the formal case; one Retry-After wait on a 429; a second 429, or any re-login after the formal case started, makes the case incomplete (failed, never retried).",
    renewal:
      `After-renewal cases: the renewal is each case socket's second successful lease verification (sequence 2 of the DO's [preview-lease-verified] line for that connection; the registration's is 1), read from the run's log; revoked at once after both are seen; none seen, or a socket that cannot be proven the case's = incomplete; verification effective (settledAt) -> revoke committed (b) over ${VERIFY_TO_REVOKE_WINDOW_MS} ms for any connection = incomplete; a malformed lease line between the formal start and just after R = incomplete; a sequence >= 3 line sent at or before b, or a socket on the other surface's grant = harness error.`,
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
  let aMark = Number.POSITIVE_INFINITY;
  let bMark = Number.POSITIVE_INFINITY;
  let tab: Page | null = null;
  let other: Page | null = null;
  const renewalCase =
    trigger === "notice-lost-after-renewal" ||
    trigger === "notice-lost-after-renewal-idle";
  const preparation: Preparation = {
    trigger,
    startedAt: Date.now(),
    endedAt: null,
    attempts: [],
    ok: false,
    failure: null,
  };
  const formal = { started: false, startedAt: null as number | null };
  /** Sign-ins, or auth redirects before R, after the formal case started. */
  const relogins: Array<Record<string, unknown>> = [];
  /** Redirects to /sign-in after R: the revocation's own effect, recorded. */
  const authRedirectsAfterR: Array<Record<string, unknown>> = [];
  let grants: CaseGrant[] = [];
  let renewal: Record<string, unknown> | null = null;
  let leaseReader: ReturnType<typeof leaseLineReader> | null = null;
  let fullySaved = false;
  /** The full record once saved, so a later failure can mark it (L4). */
  let savedResult: Record<string, unknown> | null = null;
  const watchSignInRequests = (owner: BrowserContext, label: string) =>
    owner.on("request", (request) => {
      if (!formal.started) return;
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        return;
      }
      if (!url.pathname.startsWith("/api/auth/sign-in")) return;
      relogins.push({
        t: Date.now(),
        kind: "sign-in request",
        context: label,
        method: request.method(),
        path: url.pathname,
      });
    });
  const watchAuthRedirect = (owner: Page, label: string) =>
    owner.on("framenavigated", (navigated) => {
      if (!formal.started || navigated !== owner.mainFrame()) return;
      let url: URL;
      try {
        url = new URL(navigated.url());
      } catch {
        return;
      }
      if (url.hostname.startsWith("pv-")) return;
      if (!url.pathname.startsWith("/sign-in")) return;
      const t = Date.now();
      const record = { t, kind: "auth redirect", page: label, path: url.pathname };
      if (t < aMark) relogins.push(record);
      else authRedirectsAfterR.push(record);
    });
  const incompleteRecord = (reason: string) => ({
    trigger,
    status: "incomplete",
    incompleteReason: reason,
    separate: trigger === "grant-expiry",
    mechanism: spec.mechanism,
    preparation,
    formalStartedAt: formal.startedAt,
    relogins,
    authRedirectsAfterR,
    grants: grants.map((g) => ({
      grantId: g.id,
      kind: g.kind,
      previewId: g.previewId,
      expiresAt: g.expiresAt,
    })),
    renewal,
    a: Number.isFinite(aMark) ? aMark : null,
    b: Number.isFinite(bMark) ? bMark : null,
    harnessErrors,
  });
  try {
    // Preparation: every sign-in this case needs, before the formal case.
    let userId = E2E_USER_ID;
    try {
      if (spec.ownUser) {
        const admin = await createCaseAdmin(trigger);
        userId = admin.id;
        await prepareSignIn(context, admin, preparation, formal);
      } else {
        await prepareSignIn(
          context,
          {
            email: process.env.E2E_EMAIL!,
            password: process.env.E2E_PASSWORD!,
          },
          preparation,
          formal,
        );
      }
      if (trigger === "revoke-other-session") {
        // Another session of the user, from the stored sign-in (no new
        // sign-in), ready before the formal case so the window is the
        // trigger alone.
        other = await (
          await browser.newContext({
            baseURL,
            storageState: test.info().project.use.storageState,
          })
        ).newPage();
        await other.goto("/", { waitUntil: "domcontentloaded" });
        expect(
          new URL(other.url()).pathname.startsWith("/sign-in"),
          "the other session is signed in without a new sign-in",
        ).toBe(false);
      }
      preparation.ok = true;
    } finally {
      preparation.endedAt = Date.now();
      console.log(
        `[1c] preparation ${trigger}: ok=${preparation.ok} attempts=${JSON.stringify(
          preparation.attempts.map((x) => ({
            status: x.status,
            rateLimited: x.rateLimited,
            retryAfter: x.retryAfter,
            waitAppliedMs: x.waitAppliedMs,
          })),
        )}`,
      );
    }

    // The formal case starts here: from now on any re-login makes it
    // incomplete.
    formal.started = true;
    formal.startedAt = Date.now();
    if (renewalCase) {
      if (!WORKER_LOG || !existsSync(WORKER_LOG)) {
        throw new IncompleteCase(
          `incomplete: the run's log (M1_1C_WORKER_LOG=${String(WORKER_LOG)}) cannot be read, so no lease renewal can be seen`,
        );
      }
      // From here: this case's lease lines only.
      leaseReader = leaseLineReader(WORKER_LOG);
    }
    watchSignInRequests(context, "case");
    if (other) {
      watchSignInRequests(other.context(), "other-session");
      watchAuthRedirect(other, "other-session");
    }
    await context.exposeBinding("__c1emit", (_source, event: AnyEvent) => {
      events.push(event);
    });
    await context.addInitScript(recordReadiness);
    const page = await context.newPage();
    watchAuthRedirect(page, "editor");

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
    watchAuthRedirect(tab, "tab");
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
    /** When the open came back here: after the 101, so after registration. */
    const openReturned: Record<Surface, number> = { frame: 0, tab: 0 };
    const socks: Record<Surface, string> = {
      frame: `${trigger}-frame-${Date.now()}`,
      tab: `${trigger}-tab-${Date.now()}`,
    };
    // One after the other: the tab's opens only once the frame's is open.
    for (const { surface, target } of targets) {
      openSent[surface] = await openBusySocket(target, surface, socks[surface]);
      openReturned[surface] = Date.now();
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

    grants = liveGrantsOf(userId, caseStart);
    const kinds = new Set(grants.map((g) => g.kind));
    expect(
      [...kinds].sort(),
      "this case's live iframe and tab grants",
    ).toEqual(["iframe", "tab"]);
    expect(
      new Set(grants.map((g) => g.sessionId)).size,
      "every grant of this case is on its one session",
    ).toBe(1);
    if (renewalCase) {
      // The renewal must be of the grant each socket uses: one per surface.
      expect(
        grants.map((g) => g.kind).sort(),
        "one grant per socket (iframe: the frame's, tab: the tab's)",
      ).toEqual(["iframe", "tab"]);
    }

    // The probes run from here, so R can follow its cue at once.
    for (const { surface, target } of targets) {
      await startProbeLoop(target, surface, plans.get(surface)!);
    }
    await page.waitForTimeout(500);

    // 5. When to revoke.
    if (renewalCase) {
      // Each case socket's first lease renewal, as its Durable Object
      // reported it (see "Renewal" in the header). Revoke at once once both
      // are seen. No estimate stands in for it.
      const reader = leaseReader!;
      const laterEcho = Math.max(firstEcho("frame")!, firstEcho("tab")!);
      const windows = {
        frame: { from: openSent.frame, to: openReturned.frame },
        tab: { from: openSent.tab, to: openReturned.tab },
      };
      renewal = {
        source:
          "[preview-lease-verified] lines (MORPH_PREVIEW_LEASE_EVENTS=1) read from the run's log, this case's only",
        windowMs: VERIFY_TO_REVOKE_WINDOW_MS,
        socketsOpenSentAt: openSent,
        socketsOpenReturnedAt: openReturned,
        firstEchoAt: { frame: firstEcho("frame"), tab: firstEcho("tab") },
      };
      // a. Which connections are the case's.
      let found: ReturnType<typeof caseConnections> = {
        reason: "no lease line read yet",
        candidates: [],
      };
      const registrationDeadline = laterEcho + REGISTRATION_LINE_WAIT_MS;
      while (true) {
        reader.read();
        found = caseConnections(reader.lines, grants, windows);
        if ("connections" in found || Date.now() >= registrationDeadline) break;
        await sleep(LEASE_EVENT_POLL_MS);
      }
      if (!("connections" in found)) {
        renewal.identification = found;
        renewal.malformedLines = reader.malformed;
        throw new IncompleteCase(
          `incomplete: the case's sockets could not be proven among the lease lines: ${found.reason}; not revoked`,
        );
      }
      const connections = found.connections;
      renewal.connections = connections;
      // b. Each one's sequence 2, then revoke at once.
      const deadline = laterEcho + RENEWAL_WAIT_MS;
      renewal.deadline = deadline;
      while (true) {
        reader.read();
        for (const c of connections) {
          c.renewal ??=
            reader.lines.find(
              (l) => l.connectionId === c.connectionId && l.sequence === 2,
            ) ?? null;
        }
        if (connections.every((c) => c.renewal) || Date.now() >= deadline) break;
        await sleep(LEASE_EVENT_POLL_MS);
      }
      renewal.confirmedAt = connections.every((c) => c.renewal)
        ? Date.now()
        : null;
      renewal.malformedLines = reader.malformed;
      if (renewal.confirmedAt === null) {
        throw new IncompleteCase(
          `incomplete: no lease renewal (sequence 2) seen within ${RENEWAL_WAIT_MS} ms of the sockets' first echo for ${connections
            .filter((c) => !c.renewal)
            .map((c) => `${c.surface} ${c.connectionId}`)
            .join(", ")}; not revoked`,
        );
      }
      // A prefixed line that did not parse could have been one of these
      // connections' lines: nothing about them can be ruled out (M3).
      if (reader.malformed.length) {
        throw new IncompleteCase(
          `incomplete: ${reader.malformed.length} malformed lease line(s) since the formal case started; not revoked`,
        );
      }
      // Each socket on its own surface's grant (L2).
      for (const c of connections) {
        expect(
          c.grantKind,
          `the ${c.surface} socket's lease line names the ${c.surface === "frame" ? "iframe" : "tab"} grant`,
        ).toBe(c.surface === "frame" ? "iframe" : "tab");
      }
    } else {
      await page.waitForTimeout(3_000);
    }

    // 6. R in [a, b].
    const grantIds = grants.map((g) => g.id);
    const placeholders = grantIds.map(() => "?").join(", ");
    const sessionId = grants[0]!.sessionId;
    let a = 0;
    let b = 0;
    let triggerAnswer: Record<string, unknown> = {};
    const idleCase = trigger === "notice-lost-after-renewal-idle";
    /** Frames each page had sent, read in the page. */
    const framesSent = async (stop: boolean) => {
      const sent: Record<Surface, number | null> = { frame: null, tab: null };
      for (const { surface, target } of targets) {
        sent[surface] = await target
          .evaluate((stop) => {
            const w = window as unknown as Record<string, unknown>;
            if (stop) w.__c1wsSend = false;
            return Number(w.__c1wsSent ?? 0);
          }, stop)
          .catch(() => null);
      }
      return sent;
    };
    // Idle case (M4): sending stops just BEFORE a, so nothing the page sends
    // can follow R; what it had sent then and at b is recorded.
    let idleStop: {
      at: number;
      sentAtStop: Record<Surface, number | null>;
      sentAtB?: Record<Surface, number | null>;
    } | null = null;
    if (idleCase) {
      const sentAtStop = await framesSent(true);
      idleStop = { at: Date.now(), sentAtStop };
    }
    /** Where "live just before R" is judged: a, or the idle case's stop. */
    const liveAt = () => idleStop?.at ?? a;
    switch (trigger) {
      case "sign-out": {
        a = aMark = Date.now();
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
        a = aMark = Date.now();
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
        a = aMark = Date.now();
        const changed = d1Write(statements);
        b = Date.now();
        triggerAnswer = { rowsChanged: changed };
        break;
      }
      case "grant-expiry": {
        a = aMark = Date.now();
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
        a = aMark = Date.now();
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
    if (idleStop) idleStop.sentAtB = await framesSent(false);
    // Verification effective (settledAt of sequence 2) -> revoke committed
    // (b), per connection, against the window fixed in advance.
    let renewalOverWindow: string | null = null;
    if (renewal) {
      const connections = renewal.connections as CaseConnection[];
      renewal.revokeWindow = { a, b };
      renewal.confirmToRevokeMs = a - Number(renewal.confirmedAt);
      const intervals = connections.map((c) => {
        const r = c.renewal!;
        const effectiveToCommittedMs = b - r.settledAt;
        return {
          surface: c.surface,
          connectionId: c.connectionId,
          grantId: c.grantId,
          grantKind: c.grantKind,
          registration: {
            sentAt: c.registration.sentAt,
            settledAt: c.registration.settledAt,
          },
          renewal: {
            sequence: r.sequence,
            sentAt: r.sentAt,
            settledAt: r.settledAt,
            seenAt: r.seenAt,
          },
          sinceRegistrationMs: r.sentAt - c.registration.sentAt,
          logDelayMs: r.seenAt - r.settledAt,
          effectiveToRevokeSentMs: a - r.settledAt,
          effectiveToRevokeCommittedMs: effectiveToCommittedMs,
          // From the renewal's own V (its query's send time) to b (L1).
          renewalSentToRevokeCommittedMs: b - r.sentAt,
          withinWindow: effectiveToCommittedMs <= VERIFY_TO_REVOKE_WINDOW_MS,
        };
      });
      renewal.verificationToRevoke = intervals;
      const over = intervals.filter((x) => !x.withinWindow);
      if (over.length) {
        renewalOverWindow = `incomplete: verification effective -> revoke committed over the ${VERIFY_TO_REVOKE_WINDOW_MS} ms window (${over
          .map((x) => `${x.surface} ${x.effectiveToRevokeCommittedMs} ms`)
          .join(", ")})`;
      }
      // M3, for the lines written up to R: read once more right after b.
      leaseReader!.read();
      renewal.malformedLines = leaseReader!.malformed;
      if (leaseReader!.malformed.length) {
        renewalOverWindow ??= `incomplete: ${leaseReader!.malformed.length} malformed lease line(s) between the formal start and just after R`;
      }
    }
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
    // The trigger did what it says, on exactly this case's grants (L3).
    const timeOf = (value: unknown) =>
      typeof value === "number" ? value : Date.parse(String(value));
    if (spec.pushExpected) {
      for (const grant of readBack.grants) {
        const at = timeOf(grant.revokedAt);
        if (!grant.revokedAt)
          harnessErrors.push(`grant ${String(grant.grantId)} not revoked in D1`);
        else if (!(at >= a && at <= b))
          harnessErrors.push(
            `grant ${String(grant.grantId)} revoked_at ${String(grant.revokedAt)} is not inside [a, b]`,
          );
      }
    }
    if (
      "grantsRevokedInD1Only" in triggerAnswer &&
      triggerAnswer.grantsRevokedInD1Only !== grantIds.length
    )
      harnessErrors.push(
        `the D1-only revocation changed ${String(triggerAnswer.grantsRevokedInD1Only)} rows, not ${grantIds.length}`,
      );
    if (trigger === "grant-expiry") {
      if (triggerAnswer.grantsExpired !== grantIds.length)
        harnessErrors.push(
          `the expiry changed ${String(triggerAnswer.grantsExpired)} rows, not ${grantIds.length}`,
        );
      const stamp = new Date(a).toISOString();
      for (const grant of readBack.grants) {
        if (grant.expiresAt !== stamp)
          harnessErrors.push(
            `grant ${String(grant.grantId)} reads back expires_at ${String(grant.expiresAt)}, not ${stamp}`,
          );
      }
    }
    if (readBack.grants.length !== grantIds.length)
      harnessErrors.push(
        `read back ${readBack.grants.length} grants, not ${grantIds.length}`,
      );
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
    /** Probes sent at or after b and served, marker or not (M1). */
    const servedAfterB: string[] = [];
    /** The page's own pv- requests after b that were served, classified. */
    const passiveServedAfterB: Array<Record<string, unknown>> = [];
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
        for (const p of servedAfter)
          servedAfterB.push(
            `${surface} ${kind} sent at b+${p.t - b} ms answered ${p.status}`,
          );
        const first = after[0]!;
        // M2: pass only when the first request after b is refused and was
        // itself sent within the target of a.
        const verdict: Verdict = servedAfter.length
          ? "over"
          : refused(first.status) && first.t - a <= TARGET_MS
            ? "pass"
            : "uncertain";
        kindVerdicts.push(verdict);
        // L5: this kind's own first refusal at or after a.
        const firstRefusedOfKind =
          probes
            .filter((p) => p.kind === kind && p.t >= a && refused(p.status))
            .sort((x, y) => x.t - y.t)[0] ?? null;
        byKind[kind] = {
          verdict,
          sentAfterB: after.length,
          servedAfterB: servedAfter.length,
          firstAfterB: {
            t: first.t,
            sinceAMs: first.t - a,
            status: first.status,
            reason: first.reason,
          },
          refusalDelay: firstRefusedOfKind
            ? judgeTarget(firstRefusedOfKind.answeredAt, a, b)
            : null,
        };
      }
      for (const p of probes) {
        if (p.leaked && p.t >= b)
          leaks.push(`${surface} ${p.kind} sent at b+${p.t - b} ms`);
      }
      for (const p of passive) {
        if (p.kind === "passive" && p.leaked && p.t >= b)
          leaks.push(`${surface} passive ${p.path} at b+${p.t - b} ms`);
        if (p.kind === "passive" && served(p.status) && p.t >= b) {
          const classification = classifyPassive(p.path);
          passiveServedAfterB.push({
            surface,
            path: p.path,
            status: p.status,
            resourceType: p.resourceType,
            sentAfterBMs: p.t - b,
            classification,
            exempt: PASSIVE_EXEMPT.has(classification),
          });
          if (!PASSIVE_EXEMPT.has(classification)) kindVerdicts.push("over");
        }
      }
      const refusedAfterA = probes.filter((p) => refused(p.status) && p.t >= a);
      const servedAll = probes.filter((p) => served(p.status));
      const firstRefused = refusedAfterA.sort((x, y) => x.t - y.t)[0] ?? null;
      // Draft data over fetch: the last probe answer that carried the marker.
      const draftAnswers = probes.filter((p) => p.leaked);
      const draftDataStoppedAt = draftAnswers.length
        ? Math.max(...draftAnswers.map((p) => p.answeredAt))
        : null;
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
        draftDataStoppedAt,
        closedAt: null,
        verdict: kindVerdicts.length ? worst(kindVerdicts) : "uncertain",
        byKind,
        // L5: the first refusal of ANY kind, labelled as such; each kind's
        // own is byKind[kind].refusalDelay, and the path's verdict is theirs.
        firstRefusalAnyKind: firstRefused
          ? {
              kind: firstRefused.kind,
              ...judgeTarget(firstRefused.answeredAt, a, b),
            }
          : null,
        draftDataStop:
          draftDataStoppedAt === null
            ? null
            : judgeTarget(draftDataStoppedAt, a, b),
      });

      // WebSocket.
      const record = fixtureRecord(socks[surface]);
      if (!record) harnessErrors.push(`${surface}: the fixture record was not read`);
      const echoes = events.filter(
        (e) => e.kind === "ws-echo" && e.surface === surface,
      );
      const lastEchoAt = echoes.length ? Math.max(...echoes.map((e) => e.t)) : null;
      const close = closeOf(surface);
      // H2: the socket was live just before R, and still open at b.
      const live = liveAt();
      const inLive = (t: number) => t >= live - LIVE_BEFORE_MS && t <= live;
      const echoBeforeR = echoes.some((e) => inLive(e.t));
      const receiptBeforeR = (record?.receivedAt ?? []).some(inLive);
      if (!echoBeforeR && !receiptBeforeR)
        harnessErrors.push(
          `${surface}: no echo and no container receipt within ${LIVE_BEFORE_MS} ms before ${idleStop ? "sending stopped" : "a"}`,
        );
      if (close && close.t < b)
        harnessErrors.push(
          `${surface}: the socket closed before b (b${close.t - b} ms, code ${close.status})`,
        );
      // M4: what the idle page sent, and the container had, at stop and at b.
      let idleFrames: Record<string, unknown> | undefined;
      if (idleStop) {
        const atStop = idleStop.sentAtStop[surface];
        const atB = idleStop.sentAtB?.[surface] ?? null;
        const sentAfterStop =
          atStop === null || atB === null ? null : atB - atStop;
        idleFrames = {
          stoppedAt: idleStop.at,
          stopBeforeAMs: a - idleStop.at,
          pageSentAtStop: atStop,
          pageSentAtB: atB,
          containerReceivedAtStop: receivedBy(record, idleStop.at),
          containerReceivedAtB: receivedBy(record, b),
        };
        if (sentAfterStop === null)
          harnessErrors.push(`${surface}: the frames sent at stop or at b were not read`);
        else if (sentAfterStop !== 0)
          harnessErrors.push(
            `${surface}: the idle page sent ${sentAfterStop} frame(s) after sending stopped`,
          );
        // Stopped before a, so every frame sent after R was sent after the
        // stop: none is proven by sentAfterStop being 0.
        idleFrames.framesSentAfterR = sentAfterStop;
      }
      const candidates = [lastEchoAt, record?.lastReceivedAt ?? null].filter(
        (t): t is number => typeof t === "number",
      );
      const dataStoppedAt = candidates.length ? Math.max(...candidates) : null;
      if (dataStoppedAt === null) harnessErrors.push(`${surface}: no socket data`);
      // M4: the idle case stops its own data before R, so a data-stop
      // verdict would only measure the harness: not applicable.
      const dataApplicable = !idleStop;
      const data =
        dataStoppedAt === null || !dataApplicable
          ? null
          : judgeTarget(dataStoppedAt, a, b);
      const notApplicable = {
        applicable: false,
        target: "not applicable",
        reason: "sending stopped before a; the data stop is the harness's own",
      };
      // Not closed within the wait: at least CLOSE_WAIT_MS after b.
      const closeT = close?.t ?? deadline;
      const closed = judgeTarget(closeT, a, b);
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
        liveBeforeR: { at: live, echo: echoBeforeR, containerReceipt: receiptBeforeR },
        container: record
          ? {
              received: record.received,
              lastReceivedAt: record.lastReceivedAt,
              closedAt: record.closedAt,
              closeCode: record.closeCode,
            }
          : null,
        ...(idleFrames
          ? { idleFrames, framesSentAfterR: idleFrames.framesSentAfterR }
          : {}),
        verdict: dataApplicable
          ? worst([data?.verdict ?? "pass", closed.verdict])
          : closed.verdict,
        verdicts: {
          dataWithin30s: dataApplicable ? data : notApplicable,
          closeWithin30s: closed,
          dataWithinDesignBound: !dataApplicable
            ? notApplicable
            : dataStoppedAt === null
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

    // L1: no later verification of these connections was sent by b.
    if (renewal && leaseReader) {
      leaseReader.read();
      for (const c of renewal.connections as CaseConnection[]) {
        const later = leaseReader.lines.filter(
          (l) => l.connectionId === c.connectionId && l.sequence >= 3,
        );
        (renewal as Record<string, unknown>)[`laterLines_${c.surface}`] =
          later.map((l) => ({ sequence: l.sequence, sentAt: l.sentAt, sinceBMs: l.sentAt - b }));
        for (const l of later.filter((l) => l.sentAt <= b))
          harnessErrors.push(
            `${c.surface}: lease line sequence ${l.sequence} was sent at b${l.sentAt - b} ms, before the revocation committed`,
          );
      }
    }

    // H1: the design's existing limits, asserted for EVERY case: data within
    // L + eps, closed with 4401 within L + tick + eps, each a pass
    // (T - a <= D). Unchanged limits; never the 30 s target, which stays
    // report-only. The idle case's data limit is not applicable (M4).
    const designLimits: Array<Record<string, unknown>> = [];
    for (const p of paths.filter((x) => x.kind === "ws")) {
      const v = p.verdicts as {
        dataWithinDesignBound: { verdict?: Verdict; applicable?: false } | null;
        closeWithinDesignBound: { verdict: Verdict };
      };
      designLimits.push({
        path: p.path,
        dataWithin32s:
          v.dataWithinDesignBound?.applicable === false
            ? "not applicable"
            : (v.dataWithinDesignBound?.verdict ?? null),
        closeWithin37s: v.closeWithinDesignBound.verdict,
        closeCode: p.closeCode,
      });
    }

    const measuredReLogins = relogins.length > 0;
    const result = {
      trigger,
      status: measuredReLogins || renewalOverWindow ? "incomplete" : "measured",
      incompleteReason: measuredReLogins
        ? "incomplete: re-login during formal case"
        : renewalOverWindow,
      separate: trigger === "grant-expiry",
      mechanism: spec.mechanism,
      pushExpected: spec.pushExpected,
      ownUser: spec.ownUser,
      preparation,
      formalStartedAt: formal.startedAt,
      relogins,
      authRedirectsAfterR,
      grants: grants.map((g) => ({
        grantId: g.id,
        kind: g.kind,
        previewId: g.previewId,
        expiresAt: g.expiresAt,
      })),
      a,
      b,
      windowMs: b - a,
      triggerAnswer,
      readBack,
      renewal,
      idleStop,
      designLimits,
      baseline,
      paths,
      servedAfterB,
      passiveServedAfterB,
      harnessErrors,
      leaks,
    };
    savedResult = result;
    saveCase(trigger, result);
    fullySaved = true;
    for (const p of paths) {
      const v = (p.verdicts ?? {}) as Record<
        string,
        { target?: string } | null
      >;
      const anyKind = p.firstRefusalAnyKind as
        | { kind?: string; target?: string }
        | null
        | undefined;
      console.log(
        `[1c] ${String(p.path)} verdict=${String(p.verdict)} window=${b - a}ms` +
          (p.kind === "ws"
            ? ` data=${p.dataStoppedAt === null ? "-" : Number(p.dataStoppedAt) - a}ms close=${p.closedAt === null ? "none" : Number(p.closedAt) - a}ms code=${String(p.closeCode)} target30s data=${String(v.dataWithin30s?.target)} close=${String(v.closeWithin30s?.target)}`
            : ` firstRefused(any kind: ${String(anyKind?.kind)})=${p.firstRefusedAt === null ? "-" : Number(p.firstRefusedAt) - a}ms target30s refusal(any kind)=${String(anyKind?.target)}`),
      );
    }
    if (renewal) {
      console.log(
        `[1c] ${trigger} renewal confirmedAt=a${Number(renewal.confirmedAt) - a}ms verificationToRevoke=${JSON.stringify(
          (
            renewal.verificationToRevoke as Array<Record<string, unknown>>
          ).map((x) => ({
            surface: x.surface,
            connectionId: x.connectionId,
            effectiveToRevokeCommittedMs: x.effectiveToRevokeCommittedMs,
            renewalSentToRevokeCommittedMs: x.renewalSentToRevokeCommittedMs,
            logDelayMs: x.logDelayMs,
            withinWindow: x.withinWindow,
          })),
        )}`,
      );
    }

    if (measuredReLogins) {
      throw new IncompleteCase(
        `incomplete: re-login during formal case (${JSON.stringify(relogins)})`,
      );
    }
    expect(leaks, "no draft byte is served after b").toEqual([]);
    // M1: served at all after b fails, marker or not.
    expect(servedAfterB, "no probe sent at or after b is served").toEqual([]);
    expect(
      passiveServedAfterB.filter((x) => !x.exempt),
      "no page request sent at or after b is served, except the exempt classes in the header",
    ).toEqual([]);
    if (renewalOverWindow) throw new IncompleteCase(renewalOverWindow);
    expect(harnessErrors, "the measurement was made").toEqual([]);
    for (const limit of designLimits) {
      expect(
        limit,
        "every case: data within L + eps (32 s; idle: not applicable) and a 4401 close within L + tick + eps (37 s), each a pass",
      ).toEqual({
        path: limit.path,
        dataWithin32s: idleCase ? "not applicable" : "pass",
        closeWithin37s: "pass",
        closeCode: 4401,
      });
    }
  } catch (error) {
    // A re-login seen during the formal case explains any failure after it.
    const reason =
      relogins.length > 0
        ? `incomplete: re-login during formal case (${JSON.stringify(relogins)})`
        : error instanceof IncompleteCase
          ? error.message
          : null;
    if (reason === null) {
      // L4: a failed case leaves a record of why before it fails.
      const failure = String(error instanceof Error ? error.message : error).slice(0, 2_000);
      try {
        saveCase(
          trigger,
          savedResult
            ? { ...savedResult, status: "failed", failure }
            : { ...incompleteRecord(failure), status: "failed", incompleteReason: null, failure },
        );
      } catch {}
      console.log(`[1c] ${trigger} FAILED: ${failure.split("\n")[0]}`);
      throw error;
    }
    // The full timeline, when it was already written, stays as written.
    if (!fullySaved) saveCase(trigger, incompleteRecord(reason));
    console.log(`[1c] ${trigger} INCOMPLETE: ${reason}`);
    throw new IncompleteCase(reason);
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
