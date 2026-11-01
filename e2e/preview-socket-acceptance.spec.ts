import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import {
  expect,
  test,
  type Browser,
  type Frame,
  type Page,
} from "@playwright/test";

import { openEditor, serverFn } from "./native-acceptance";
import { themeScopeFromEditorPath, writeThemeFiles } from "./native-compat";

/**
 * #214 A7 acceptance on the P2/P3/P4 candidate: a real Theme WebSocket on the
 * container transport, relayed under its preview grant.
 *
 * A Theme-owned server entry (`src/server.js`, test-only) answers one path
 * with a WebSocketPair that echoes every frame and records, with the
 * container's clock, each frame it receives and when its side closed. The
 * record is read from inside this run's own container, so it is available
 * after the pv- host has stopped answering.
 *
 * 1. Order and content: mixed text and binary frames of several sizes, sent
 *    back to back, arrive at the container and back at the browser in the
 *    order sent, byte for byte, none lost.
 * 2. Revocation, four cases, each on its own signed-in session:
 *    frame | tab  x  pushed (sign-out, P2d) | notice lost (the grant revoked
 *    in D1 only, so no push reaches the Durable Object and only the lease
 *    can end the socket).
 *    Recorded separately for each: the window R lies in (the commit is not
 *    observed as one instant: for a push, sign-out sent to answered; for a
 *    lost notice, just before the UPDATE to its return), when the container
 *    and the browser each received the last data frame (the relay's own
 *    forwarding moment is not observed; it is no later than these), and when
 *    each side saw the socket close.
 *
 * Asserted, from the window's end: close code 4401; no data received later
 * than R + L + eps (A5: the lease ends forwarding at most L after R); the
 * close no later than R + L + one lease tick + eps (an idle socket is closed
 * by the next tick). eps is 2 s. "Within 30 s" is reported, not asserted: it
 * remains a target to verify.
 */

const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const OUT = process.env.P4_ACCEPTANCE_OUT;

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "The pv- relay fronts the Sandbox container: MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);

const PREVIEW =
  "/src/server/storefront/storefront-theme-preview-server.serverFn.ts";
const HERO = '[data-storefront-section-id="starter-hero"]';
const ECHO = "__morph-p4-echo";
const LOG = "__morph-p4-log";
const DEV_PORT = 5173;
const DEV_BASE = "/__morph-theme-preview__/";
// preview-socket-lease.ts / preview-socket-relay.ts
const LEASE_MS = 30_000;
const TICK_MS = 5_000;
const SLACK_MS = 2_000;

const FIXTURE = `import startEntry from "@tanstack/react-start/server-entry";

// Test-only fixture (#214 A7 acceptance). One path answers with a socket that
// echoes every frame and records, by the container's clock, what it received
// and when it closed; another returns that record.
const ECHO = ${JSON.stringify(`/${ECHO}`)};
const LOG = ${JSON.stringify(`/${LOG}`)};
const records = new Map();

function describe(data) {
  if (typeof data === "string") {
    return { kind: "text", len: data.length, head: data.slice(0, 32) };
  }
  const bytes = new Uint8Array(data);
  let sum = 0;
  for (const b of bytes) sum = (sum + b) >>> 0;
  return {
    kind: "binary",
    len: bytes.length,
    sum,
    seq: bytes.length >= 4 ? new DataView(data).getUint32(0) : null,
  };
}

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
      return new Response("p4-echo: upgrade required", {
        status: 426,
        headers: { "cache-control": "no-store" },
      });
    }
    const record = {
      sock: url.searchParams.get("sock") || "anon",
      openedAt: Date.now(),
      received: [],
      closedAt: null,
      closeCode: null,
    };
    records.set(record.sock, record);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Bytes, not Blobs: reading a Blob is asynchronous and would let a later
    // text frame overtake it inside the fixture itself.
    server.binaryType = "arraybuffer";
    server.accept();
    server.addEventListener("message", (event) => {
      record.received.push({ t: Date.now(), ...describe(event.data) });
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

type Received = {
  t: number;
  kind: "text" | "binary";
  len: number;
  head?: string;
  sum?: number;
  seq?: number | null;
};
type FixtureRecord = {
  sock: string;
  openedAt: number;
  received: Received[];
  closedAt: number | null;
  closeCode: number | null;
};

const record: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  leaseMs: LEASE_MS,
  tickMs: TICK_MS,
};
function save() {
  if (OUT) writeFileSync(OUT, JSON.stringify(record, null, 2));
}

/** One statement against this run's own D1 (as binding-acceptance-helpers). */
function d1(sql: string, ...params: unknown[]) {
  const dir = join(
    process.env.MORPH_E2E_STATE_DIR!,
    "v3/d1/miniflare-D1DatabaseObject",
  );
  const file = existsSync(dir)
    ? readdirSync(dir).find(
        (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
      )
    : undefined;
  if (!file) throw new Error("this run's local D1 file was not found");
  const db = new Database(join(dir, file), { timeout: 10_000 });
  try {
    const statement = db.prepare(sql);
    return /^\s*SELECT\b/i.test(sql)
      ? (statement.all(...params) as Array<Record<string, unknown>>)
      : statement.run(...params).changes;
  } finally {
    db.close();
  }
}

/** This run's own preview container (never a developer's `workerd-morph-…`). */
function ownPreviewContainer(): string {
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
  expect(own, "exactly one preview container of this run").toHaveLength(1);
  return own[0]!.split(" ")[0]!;
}

/** The fixture's record for one socket, read inside the container. */
function fixtureRecord(sock: string): FixtureRecord | null {
  const url = `http://127.0.0.1:${DEV_PORT}${DEV_BASE}${LOG}?sock=${sock}`;
  const script =
    "fetch(process.argv[1],{cache:'no-store'}).then(r=>r.text()).then(t=>console.log('P4LOG '+t),e=>console.log('P4LOG null'))";
  const ran = spawnSync(
    "bash",
    [
      "-c",
      'docker exec "$0" node -e "$1" "$2" 3>&-',
      ownPreviewContainer(),
      script,
      url,
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const line = (ran.stdout ?? "")
    .split("\n")
    .find((l) => l.startsWith("P4LOG "));
  return line ? (JSON.parse(line.slice(6)) as FixtureRecord | null) : null;
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

/** A new context signed in as the E2E user with a session of its own. */
async function ownSessionPage(browser: Browser): Promise<Page> {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({ baseURL });
  const signedIn = await context.request.post("/api/auth/sign-in/email", {
    headers: { origin: new URL(baseURL!).origin },
    data: {
      email: process.env.E2E_EMAIL,
      password: process.env.E2E_PASSWORD,
    },
  });
  expect(signedIn.ok(), "a sign-in for its own session").toBe(true);
  return context.newPage();
}

type Target = Page | Frame;

/** Opens the echo socket on the target's own pv- origin. */
async function openSocket(target: Target, sock: string) {
  const opened = await target.evaluate(
    async ({ path, sock }) => {
      const url = new URL(path, location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("sock", sock);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      const w = window as unknown as Record<string, unknown>;
      w.__p4ws = ws;
      w.__p4got = [] as Array<{ t: number; data: unknown }>;
      w.__p4closed = new Promise((resolve) =>
        ws.addEventListener("close", (e) =>
          resolve({ t: Date.now(), code: e.code, reason: e.reason }),
        ),
      );
      ws.addEventListener("message", (e) =>
        (w.__p4got as Array<{ t: number; data: unknown }>).push({
          t: Date.now(),
          data: e.data,
        }),
      );
      return new Promise<{ open: boolean; code?: number }>((resolve) => {
        ws.addEventListener("open", () => resolve({ open: true }));
        ws.addEventListener("close", (e) =>
          resolve({ open: false, code: e.code }),
        );
      });
    },
    { path: `${socketBase(target)}${ECHO}`, sock },
  );
  expect(opened, "the socket opens on the pv- host").toEqual({ open: true });
}

function socketBase(target: Target): string {
  const url = new URL(target.url());
  return url.pathname.startsWith(DEV_BASE) ? DEV_BASE : "/";
}

test.describe("A7: a Theme WebSocket relayed under its preview grant", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(10 * 60_000);

  test("setup: the Theme's test-only socket fixture", async ({ page }) => {
    const scope = themeScopeFromEditorPath(EDITOR_PATH!);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await serverFn(page, PREVIEW, "stopThemePreviewServer", scope).catch(
      () => {},
    );
    const saved = await writeThemeFiles(page, scope, [
      { path: "src/server.js", content: FIXTURE },
    ]);
    expect(saved.success, JSON.stringify(saved)).toBe(true);
  });

  test("mixed text and binary frames keep their order and bytes, both ways", async ({
    page,
  }) => {
    await openEditor(page);
    const frame = await previewFrame(page);
    await expect(frame.locator(HERO)).toBeVisible({ timeout: 120_000 });
    const sock = `order-${Date.now()}`;
    await openSocket(frame, sock);
    // Binary frames carry their index in the first four bytes and a pattern
    // derived from it; text frames carry the index in their prefix.
    const SIZES = [4, 7, 1024, 65_536, 262_144, 524_288];
    const TEXT = [0, 1, 300, 20_000];
    const COUNT = 240;
    const sent = await frame.evaluate(
      async ({ SIZES, TEXT, COUNT }) => {
        const ws = (window as unknown as { __p4ws: WebSocket }).__p4ws;
        const plan: Array<{
          kind: string;
          len: number;
          sum?: number;
          head?: string;
        }> = [];
        for (let i = 0; i < COUNT; i += 1) {
          if (i % 2 === 0) {
            const text = `t:${i}:` + "x".repeat(TEXT[(i / 2) % TEXT.length]!);
            ws.send(text);
            plan.push({
              kind: "text",
              len: text.length,
              head: text.slice(0, 32),
            });
          } else {
            const len = SIZES[((i - 1) / 2) % SIZES.length]!;
            const bytes = new Uint8Array(len);
            new DataView(bytes.buffer).setUint32(0, i);
            for (let j = 4; j < len; j += 1) bytes[j] = (i * 31 + j) & 0xff;
            let sum = 0;
            for (const b of bytes) sum = (sum + b) >>> 0;
            ws.send(bytes);
            plan.push({ kind: "binary", len, sum });
          }
        }
        return plan;
      },
      { SIZES, TEXT, COUNT },
    );
    const echoed = await frame.evaluate(
      async ({ COUNT }) => {
        const w = window as unknown as {
          __p4got: Array<{ t: number; data: unknown }>;
        };
        const deadline = Date.now() + 60_000;
        while (w.__p4got.length < COUNT && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return w.__p4got.map(({ data }) => {
          if (typeof data === "string") {
            return { kind: "text", len: data.length, head: data.slice(0, 32) };
          }
          const bytes = new Uint8Array(data as ArrayBuffer);
          let sum = 0;
          for (const b of bytes) sum = (sum + b) >>> 0;
          return { kind: "binary", len: bytes.length, sum };
        });
      },
      { COUNT },
    );
    const atContainer = fixtureRecord(sock);
    const containerSeen = (atContainer?.received ?? []).map((r) =>
      r.kind === "text"
        ? { kind: r.kind, len: r.len, head: r.head }
        : { kind: r.kind, len: r.len, sum: r.sum },
    );
    const firstMismatch = (got: unknown[]) =>
      sent.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(got[i]));
    record.order = {
      sent: sent.length,
      atContainer: containerSeen.length,
      echoed: echoed.length,
      firstMismatchAtContainer: firstMismatch(containerSeen),
      firstMismatchEchoed: firstMismatch(echoed),
      sizes: SIZES,
      textSizes: TEXT,
    };
    save();
    expect(
      containerSeen,
      "toward the container: order, bytes, none lost",
    ).toEqual(sent);
    expect(echoed, "toward the browser: order, bytes, none lost").toEqual(sent);
    await frame.evaluate(() =>
      (window as unknown as { __p4ws: WebSocket }).__p4ws.close(1000),
    );
  });

  for (const surface of ["frame", "tab"] as const) {
    for (const revocation of ["pushed", "notice-lost"] as const) {
      test(`${surface}, ${revocation}: the socket stops and closes 4401 within the lease`, async ({
        browser,
      }) => {
        const caseName = `${surface}-${revocation}`;
        const caseStart = new Date().toISOString();
        const page = await ownSessionPage(browser);
        try {
          await openEditor(page);
          const frame = await previewFrame(page);
          await expect(frame.locator(HERO)).toBeVisible({ timeout: 120_000 });
          let target: Target = frame;
          if (surface === "tab") {
            const framedHost = new URL(frame.url()).hostname;
            const [tab] = await Promise.all([
              page.context().waitForEvent("page"),
              page
                .getByRole("button", { name: "Open preview in new tab" })
                .click(),
            ]);
            await tab.waitForURL(
              (url) =>
                url.hostname === framedHost &&
                !url.pathname.startsWith("/__morph/preview-auth/"),
              { timeout: 90_000 },
            );
            await expect(tab.locator(HERO)).toBeVisible({ timeout: 90_000 });
            target = tab;
          }
          const sock = `${caseName}-${Date.now()}`;
          await openSocket(target, sock);
          // A frame every 100 ms, each echoed back, until the socket ends.
          await target.evaluate(() => {
            const w = window as unknown as Record<string, unknown>;
            const ws = w.__p4ws as WebSocket;
            let n = 0;
            w.__p4sent = [] as Array<{ n: number; t: number }>;
            w.__p4timer = setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN) return;
              n += 1;
              ws.send(`b:${n}`);
              (w.__p4sent as Array<{ n: number; t: number }>).push({
                n,
                t: Date.now(),
              });
            }, 100);
          });
          await page.waitForTimeout(3_000);

          const kind = surface === "frame" ? "iframe" : "tab";
          const live = d1(
            `SELECT id FROM storefront_preview_access_grants
              WHERE kind = ? AND revoked_at IS NULL AND created_at >= ?`,
            kind,
            caseStart,
          ) as Array<{ id: string }>;
          expect(live.length, `this case's live ${kind} grant`).toBeGreaterThan(
            0,
          );

          // R is not observed as one instant. The commit lies inside a
          // window: for a push, between sending the sign-out and its answer
          // (the after-hook revokes before the answer); for a lost notice,
          // between just before the UPDATE and its return. Bounds use the
          // window's end, the latest the commit can have been.
          let rWindow: { from: number; to: number };
          let revokeDetail: Record<string, unknown>;
          if (revocation === "pushed") {
            const sentAt = Date.now();
            const out = await page
              .context()
              .request.post("/api/auth/sign-out", {
                headers: { origin: new URL(page.url()).origin },
                data: {},
              });
            const answeredAt = Date.now();
            expect(out.ok(), "sign-out").toBe(true);
            const rows = d1(
              `SELECT revoked_at FROM storefront_preview_access_grants WHERE id = ?`,
              live[0]!.id,
            ) as Array<{ revoked_at: string | null }>;
            expect(
              rows[0]?.revoked_at,
              "sign-out revoked the grant",
            ).toBeTruthy();
            rWindow = { from: sentAt, to: answeredAt };
            revokeDetail = {
              // The Worker's stamp, taken before its write: not the commit.
              revokedAtStampBeforeWrite: Date.parse(rows[0]!.revoked_at!),
            };
          } else {
            const before = Date.now();
            const stamp = new Date(before).toISOString();
            const changed = d1(
              `UPDATE storefront_preview_access_grants
                  SET revoked_at = ?, updated_at = ?
                WHERE kind = ? AND revoked_at IS NULL AND created_at >= ?`,
              stamp,
              stamp,
              kind,
              caseStart,
            );
            rWindow = { from: before, to: Date.now() };
            revokeDetail = { grantsRevokedInD1Only: changed };
          }

          const closed = (await target.evaluate(() =>
            Promise.race([
              (window as unknown as { __p4closed: Promise<unknown> })
                .__p4closed,
              new Promise((r) =>
                setTimeout(() => r({ timeout: true }), 75_000),
              ),
            ]),
          )) as {
            t?: number;
            code?: number;
            reason?: string;
            timeout?: boolean;
          };
          const browserSide = (await target.evaluate(() => {
            const w = window as unknown as {
              __p4got: Array<{ t: number; data: unknown }>;
              __p4sent: Array<{ n: number; t: number }>;
              __p4timer: number;
            };
            clearInterval(w.__p4timer);
            return {
              sent: w.__p4sent.length,
              lastSentAt: w.__p4sent.at(-1)?.t ?? null,
              echoes: w.__p4got.length,
              lastEchoAt: w.__p4got.at(-1)?.t ?? null,
            };
          })) as {
            sent: number;
            lastSentAt: number | null;
            echoes: number;
            lastEchoAt: number | null;
          };
          const atContainer = fixtureRecord(sock);
          const lastReceivedAtContainer =
            atContainer?.received.at(-1)?.t ?? null;
          const after = (t: number | null | undefined) =>
            t === null || t === undefined
              ? null
              : {
                  fromWindowStart: t - rWindow.from,
                  fromWindowEnd: t - rWindow.to,
                };
          const result = {
            rWindow,
            ...revokeDetail,
            // When each endpoint received the last data frame. The relay's
            // own forwarding moment is not observed; it is no later than
            // these.
            lastDataReceivedAtContainer: lastReceivedAtContainer,
            lastEchoReceivedAtBrowser: browserSide.lastEchoAt,
            // Closes, each side on its own.
            browserClose: closed,
            containerClose: atContainer
              ? { t: atContainer.closedAt, code: atContainer.closeCode }
              : null,
            framesSent: browserSide.sent,
            framesAtContainer: atContainer?.received.length ?? null,
            echoes: browserSide.echoes,
            ms: {
              lastDataReceivedAtContainer: after(lastReceivedAtContainer),
              lastEchoReceivedAtBrowser: after(browserSide.lastEchoAt),
              browserClose: after(closed.t),
            },
            closeWithin30sOfWindowEnd:
              closed.t === undefined
                ? false
                : closed.t - rWindow.to <= LEASE_MS,
          };
          record.cases ??= {} as Record<string, unknown>;
          (record.cases as Record<string, unknown>)[caseName] = result;
          save();

          // Data: the lease ends forwarding at most L after R (A5), plus eps.
          // Close: an idle socket is closed by the next lease tick, so its
          // bound adds one tick.
          const dataBound = rWindow.to + LEASE_MS + SLACK_MS;
          const closeBound = rWindow.to + LEASE_MS + TICK_MS + SLACK_MS;
          expect(closed.timeout, "the socket closed").toBeUndefined();
          expect(closed.code, "closed as revoked").toBe(4401);
          expect(
            closed.t!,
            "closed within R + L + tick + eps",
          ).toBeLessThanOrEqual(closeBound);
          expect(atContainer, "the fixture's record was read").not.toBeNull();
          expect(
            lastReceivedAtContainer!,
            "no data received at the container after R + L + eps",
          ).toBeLessThanOrEqual(dataBound);
          expect(
            browserSide.lastEchoAt ?? 0,
            "no data received at the browser after R + L + eps",
          ).toBeLessThanOrEqual(dataBound);
        } finally {
          await page.context().close();
        }
      });
    }
  }
});
