import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import {
  expect,
  test,
  type Frame,
  type Page,
  type Response,
} from "@playwright/test";

import { decodeServerFnResult, isServerFunctionCall } from "./helpers";
import { stopPreviewServer } from "./helpers/preview-server-stop";
import {
  editHero,
  openEditor,
  savedField,
  signedInPage,
  writeDraftField,
} from "./native-acceptance";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * Auto-retry v2, the two-tab race on a real container (user, 2026-11-24:
 * proven before the M1 round 4 candidate is frozen).
 *
 * Two tabs of the same author start the same Theme's Live Preview, so both
 * starts carry the same previewId (theme-preview-session-id.ts) and meet in
 * one PreviewSandbox Durable Object and one container. Tab A's start is on
 * the server, its claim registered in the container's fence ledger and its
 * workspace not yet served, when tab B starts. Expected (A/B/A):
 * - B's preview comes up serving B's content;
 * - A's late answer is `preview-start-superseded` and lays nothing over B;
 * - nothing A does after B took over stops B's dev server;
 * - A does not mark B's workspace dirty.
 *
 * Nothing here delays A. The product has no test hook that holds a start
 * (none is added: no backdoor), so the overlap comes from what a start
 * costs: the preview is stopped first, A's start boots the container and
 * lays the whole workspace out, and B is sent while that is still running.
 * Every step waits on a condition, never a clock. The overlap is then
 * proven, not assumed: B's start was on the wire before A answered, A's
 * claim was in the ledger before B's, and A answered superseded. A run in
 * which A finished first fails, saying the race did not happen.
 *
 * A held at its retry pause (the first attempt interrupted with the
 * allow-listed "runtime connection was closing") is not reachable without
 * fault injection; see handoff/2026-11-24/autoretry-v2-impl.md
 * §two-tab E2E for the missing hook. The unit tests over the real current-
 * start record cover that interleaving.
 *
 * Evidence, all observable:
 * - each tab's start answer (success, stage, attemptId, the failure's
 *   reference) and what each tab shows;
 * - the container's own state read with `docker exec`: the fence ledger
 *   (`owner`, `committed`), the workspace marker, the content snapshot and
 *   the dev server processes; and `docker ps` for the containers;
 * - the attemptIds and reference, annotated, so this run's
 *   `[preview-observe]` lines can be matched to them in the runner's log.
 *   The spec cannot read those lines itself: the runner echoes the dev
 *   server's output and keeps none of it for the suite.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this writes the run's own D1.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "Two starts meet only in the Sandbox container's guard and fence ledger; run with MORPH_E2E_TRANSPORT=cloudflare-sandbox.",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "The M1 round 4 candidate is the full Start preview; run with MORPH_E2E_PREVIEW_RUNTIME=start.",
);

const run = promisify(execFile);

/** PREVIEW_FENCE_LEDGER_PATH and the workspace paths the start commits. */
const LEDGER_PATH = "/tmp/morph-preview-fences.json";
const MARKER_PATH = "/workspace/.morph-preview-workspace.sha256";
const CONTENT_PATH = "/workspace/.morph-preview-content.json";
/** THEME_PREVIEW_SERVER_PORT. */
const DEV_PORT = 5173;

type Claim = { seq: number; attempt: number; attemptId: string };
type Ledger = { owner: Claim | null; committed: string | null };

type ProcessRow = { pid: number; startTicks: string | null; cmd: string };

type ContainerState = {
  ledger: Ledger | null;
  ledgerReadable: boolean;
  marker: string | null;
  contentHasA: boolean;
  contentHasB: boolean;
  devServers: ProcessRow[];
  gateShells: ProcessRow[];
};

type StartAnswer = {
  success: boolean;
  error: string | null;
  message: string;
  attemptId: string | null;
};

/**
 * One shell command, with fd 3 closed: a Docker CLI that inherits the E2E
 * machine lock's descriptor leaves a helper holding the lock after the run.
 * `args` are `$0`, `$1`, … inside `script`.
 */
async function bash(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await run("bash", ["-c", `${script} 3>&-`, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** This run's preview containers (never a developer's `workerd-morph-…`). */
async function previewContainers(): Promise<string[]> {
  const listed = await bash(
    'docker ps --filter "name=^workerd-morph-e2e-" --format "{{.ID}} {{.Names}}"',
  );
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((row) => row.includes("-PreviewSandbox-") && !row.endsWith("-proxy"))
    .map((row) => row.split(" ")[0]!);
}

function parseLedger(text: string | null): Ledger | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as {
      owner?: unknown;
      committed?: unknown;
    } | null;
    if (parsed === null || typeof parsed !== "object") return null;
    const owner = parsed.owner as Partial<Claim> | undefined;
    return {
      owner:
        owner &&
        typeof owner.seq === "number" &&
        typeof owner.attempt === "number" &&
        typeof owner.attemptId === "string"
          ? { seq: owner.seq, attempt: owner.attempt, attemptId: owner.attemptId }
          : null,
      committed:
        typeof parsed.committed === "string" ? parsed.committed : null,
    };
  } catch {
    return null;
  }
}

/** The ledger's text, or null while the container has none. */
async function ledgerText(container: string): Promise<string | null> {
  return bash('docker exec "$0" cat "$1"', [container, LEDGER_PATH]).catch(
    () => null,
  );
}

/**
 * What the container holds now, read inside it with its own Node: the
 * ledger, the marker, whether the content snapshot holds either tab's
 * marker, and the dev server processes (`/proc`, with each process's start
 * time so a replaced server with a reused pid is still told apart). A gate
 * shell is a serve gate that has not exec'd into its dev server yet.
 */
const STATE_SCRIPT = `
const fs = require("fs");
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const [ledgerPath, markerPath, contentPath, a, b, port] = process.argv.slice(1);
const rows = [];
for (const name of fs.readdirSync("/proc")) {
  if (!/^\\d+$/.test(name)) continue;
  const raw = read("/proc/" + name + "/cmdline");
  if (!raw) continue;
  const cmd = raw.split("\\0").join(" ").trim();
  // Leave this probe out: its own command line (and the shell / docker exec
  // wrapper some transports put around it) carries this script's text, which
  // names the patterns matched below.
  if (cmd.includes("TWOTAB")) continue;
  const stat = read("/proc/" + name + "/stat");
  const startTicks = stat ? stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null : null;
  rows.push({ pid: Number(name), startTicks, cmd });
}
const shell = (cmd) => /^(ba)?sh /.test(cmd);
const content = read(contentPath) ?? "";
console.log("TWOTAB " + JSON.stringify({
  ledger: read(ledgerPath),
  marker: read(markerPath),
  contentHasA: content.includes(a),
  contentHasB: content.includes(b),
  devServers: rows.filter((r) => !shell(r.cmd) && r.cmd.includes("node_modules/.bin/vite") && r.cmd.includes("--port " + port)),
  gateShells: rows.filter((r) => shell(r.cmd) && r.cmd.includes("/tmp/morph-preview-fence-")),
}));
`;

async function containerState(
  container: string,
  markerA: string,
  markerB: string,
): Promise<ContainerState> {
  const out = await bash(
    'docker exec "$0" node -e "$1" "$2" "$3" "$4" "$5" "$6" "$7"',
    [
      container,
      STATE_SCRIPT,
      LEDGER_PATH,
      MARKER_PATH,
      CONTENT_PATH,
      markerA,
      markerB,
      String(DEV_PORT),
    ],
  );
  const line = out.split("\n").find((l) => l.startsWith("TWOTAB "));
  if (!line) throw new Error("the container state script printed no record");
  const raw = JSON.parse(line.slice("TWOTAB ".length)) as Omit<
    ContainerState,
    "ledger" | "ledgerReadable"
  > & { ledger: string | null };
  const ledger = parseLedger(raw.ledger);
  return {
    ...raw,
    ledger,
    ledgerReadable: ledger !== null,
    marker: raw.marker === null ? null : raw.marker.trim(),
  };
}

/** A tab's preview frame once it has come back from the access flow. */
async function previewDocument(page: Page): Promise<Frame> {
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
      { timeout: 120_000, message: "the preview frame lands on its pv- host" },
    )
    .toBe(true);
  return found!;
}

/** The document the preview's server renders now, fetched from the frame. */
function renderedDocument(frame: Frame) {
  return frame.evaluate(async () => {
    const response = await fetch(location.pathname, { cache: "no-store" });
    return { status: response.status, body: await response.text() };
  });
}

async function startAnswer(response: Response): Promise<StartAnswer> {
  const result = decodeServerFnResult(await response.text()) as {
    success?: unknown;
    error?: unknown;
    message?: unknown;
    data?: { attemptId?: unknown } | null;
  };
  return {
    success: result.success === true,
    error: typeof result.error === "string" ? result.error : null,
    message: typeof result.message === "string" ? result.message : "",
    attemptId:
      typeof result.data?.attemptId === "string" ? result.data.attemptId : null,
  };
}

/** Every start and content sync a tab sends, with when it went out and came back. */
function recordPreviewCalls(page: Page) {
  const record = {
    startsSent: [] as number[],
    startsAnswered: [] as number[],
    syncs: 0,
  };
  page.on("request", (request) => {
    if (isServerFunctionCall(request.url(), "startThemePreviewServer")) {
      record.startsSent.push(Date.now());
    } else if (
      isServerFunctionCall(request.url(), "syncThemePreviewContent")
    ) {
      record.syncs += 1;
    }
  });
  page.on("response", (response) => {
    if (isServerFunctionCall(response.url(), "startThemePreviewServer")) {
      record.startsAnswered.push(Date.now());
    }
  });
  return record;
}

const isStart = (response: Response) =>
  isServerFunctionCall(response.url(), "startThemePreviewServer");

test.describe("two tabs start one Live Preview on the container", () => {
  test.setTimeout(15 * 60_000);

  test("the newer tab's start owns the workspace: the older tab's late answer is superseded and changes nothing the newer tab serves", async ({
    browser,
  }) => {
    const scope = themeScopeFromEditorPath(EDITOR_PATH!);
    const tag = randomUUID().slice(0, 8);
    const markerA = `two-tab A ${tag}`;
    const markerB = `two-tab B ${tag}`;
    // One browser context: two tabs of one signed-in author, so one user,
    // one storefront, one Theme, one previewId.
    const setup = await signedInPage(browser);
    const context = setup.context();
    const evidence: Record<string, unknown> = { markerA, markerB };
    const annotate = () =>
      test.info().annotations.push({
        type: "two-tab-race",
        description: JSON.stringify(evidence),
      });

    // Ledger states seen while the race runs, in order: each change once.
    const timeline: Array<{ at: number; owner: Claim | null; committed: string | null }> = [];
    let polling = false;
    let poller: Promise<void> = Promise.resolve();
    // Filled in by a poll callback, so held in an object TypeScript does not
    // narrow to its initial null.
    const seen: { claimA: Claim | null } = { claimA: null };

    try {
      // Setup: tab A's content is a draft only this run wrote.
      await openEditor(setup);
      await expect(
        (await previewDocument(setup)).locator("[data-storefront-section-id]").first(),
      ).toBeVisible({ timeout: 120_000 });
      await editHero(setup, markerA);
      await savedField(setup, scope, markerA);
      // Closed before the stop: an editor left open on a stopped preview
      // could reconnect and send a third start.
      await setup.close();

      // A page with the app loaded, for the stop and B's draft write.
      const helper = await context.newPage();
      await helper.goto("/", { waitUntil: "domcontentloaded" });
      // The next start boots the container and lays the workspace out from
      // nothing, which is what keeps A on the server while B is sent.
      await stopPreviewServer(helper, scope);
      await expect
        .poll(previewContainers, {
          timeout: 120_000,
          message: "the stopped preview's container is gone",
        })
        .toEqual([]);

      // Tab A starts.
      const tabA = await context.newPage();
      const callsA = recordPreviewCalls(tabA);
      const answeredA = tabA.waitForResponse(isStart, { timeout: 300_000 });
      await tabA.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });

      // A has a container and has registered its claim in the ledger: its
      // start has read its content, and it is in the container's hands.
      let container = "";
      await expect
        .poll(
          async () => {
            const listed = await previewContainers();
            container = listed.length === 1 ? listed[0]! : "";
            return listed.length;
          },
          { timeout: 180_000, message: "A's start boots one preview container" },
        )
        .toBe(1);
      await expect
        .poll(
          async () => {
            seen.claimA = parseLedger(await ledgerText(container))?.owner ?? null;
            return seen.claimA !== null;
          },
          {
            timeout: 180_000,
            message: "A's start registers its claim in the container's fence ledger",
          },
        )
        .toBe(true);
      const claimA = seen.claimA!;
      evidence.container = container;
      evidence.claimA = claimA;
      expect(
        callsA.startsAnswered.length,
        "A is still starting when its claim is seen; a start already answered leaves no race to observe",
      ).toBe(0);

      // From here on, every ledger state the container shows.
      polling = true;
      poller = (async () => {
        while (polling) {
          const ledger = parseLedger(await ledgerText(container));
          const entry = {
            at: Date.now(),
            owner: ledger?.owner ?? null,
            committed: ledger?.committed ?? null,
          };
          const last = timeline.at(-1);
          if (
            !last ||
            JSON.stringify([last.owner, last.committed]) !==
              JSON.stringify([entry.owner, entry.committed])
          ) {
            timeline.push(entry);
          }
        }
      })();

      // B's draft differs from A's, so what each start laid out can be told
      // apart. Written after A read its content, before B reads it.
      const current = await savedField(helper, scope, markerA);
      await writeDraftField(helper, scope, current, markerB);
      await savedField(helper, scope, markerB);

      // Tab B starts the same preview.
      const tabB = await context.newPage();
      const callsB = recordPreviewCalls(tabB);
      const readyLines: string[] = [];
      tabB.on("console", (message) => {
        if (message.text().startsWith("[preview-server] ready in")) {
          readyLines.push(message.text());
        }
      });
      const answeredB = tabB.waitForResponse(isStart, { timeout: 300_000 });
      await tabB.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });

      const answerB = await startAnswer(await answeredB);
      evidence.answerB = answerB;
      evidence.readyLinesB = readyLines;
      expect(answerB.success, `B's start answers ready (${answerB.error})`).toBe(true);
      expect(answerB.attemptId, "B's answer names its attempt").not.toBeNull();
      const atBReady = await containerState(container, markerA, markerB);
      evidence.atBReady = atBReady;

      const answerA = await startAnswer(await answeredA);
      evidence.answerA = answerA;
      const reference = /\(reference ([0-9a-f]{8})\)/.exec(answerA.message)?.[1] ?? null;
      evidence.referenceA = reference;
      evidence.order = {
        startSentA: callsA.startsSent,
        startAnsweredA: callsA.startsAnswered,
        startSentB: callsB.startsSent,
        startAnsweredB: callsB.startsAnswered,
      };

      // Both have answered; nothing of either start is still running.
      polling = false;
      await poller;
      evidence.timeline = timeline;
      const after = await containerState(container, markerA, markerB);
      evidence.afterBoth = after;
      evidence.containersAfter = await previewContainers();

      // The race happened: B was on the wire while A was, and A lost.
      expect(callsA.startsSent, "tab A sent one start").toHaveLength(1);
      expect(callsB.startsSent, "tab B sent one start").toHaveLength(1);
      expect(
        callsB.startsSent[0]!,
        "B's start went out before A's answer came back",
      ).toBeLessThan(callsA.startsAnswered[0]!);
      expect(
        answerA.error,
        "A's late answer is superseded (if A answered ready, A finished before B took over and the race did not happen)",
      ).toBe("preview-start-superseded");
      expect(answerA.success).toBe(false);
      expect(reference, "A's failure carries a reference for its server line").not.toBeNull();

      // The ledger: B took over from A and kept it.
      expect(after.ledgerReadable, "the fence ledger is readable").toBe(true);
      expect(after.ledger!.owner, "the workspace's owner is B's attempt").toMatchObject({
        attemptId: answerB.attemptId,
      });
      expect(after.ledger!.owner!.seq, "B's claim outranks A's").toBeGreaterThan(
        claimA.seq,
      );
      const firstB = timeline.findIndex(
        (entry) => entry.owner?.attemptId === answerB.attemptId,
      );
      expect(firstB, "the ledger was seen naming B as its owner").toBeGreaterThanOrEqual(0);
      const backToA = timeline
        .slice(firstB)
        .filter((entry) => entry.owner?.attemptId === claimA.attemptId);
      expect(backToA, "once B owns the workspace, A never owns it again").toEqual([]);

      // One container throughout: no restart wiped the ledger under the race.
      expect(evidence.containersAfter, "the same single preview container").toEqual([
        container,
      ]);

      // A does not mark B's workspace dirty: the marker is B's commit, and
      // the ledger vouches for it. A content sync would also mark it, so
      // none may have run for this to say anything about A.
      expect(callsA.syncs + callsB.syncs, "no content sync ran during the race").toBe(0);
      expect(after.marker, "the workspace marker").not.toBeNull();
      expect(after.marker!.startsWith("dirty"), `the marker is not dirty (${after.marker})`).toBe(
        false,
      );
      expect(after.ledger!.committed, "the ledger vouches for the marker on disk").toBe(
        after.marker,
      );

      // A's late result lays nothing over B: the snapshot is B's content.
      expect(after.contentHasB, "the workspace holds B's content").toBe(true);
      expect(after.contentHasA, "and none of A's").toBe(false);

      // A's clean-up stops nothing of B's: the one dev server running when
      // B answered is the one running now, and no gate is left waiting.
      expect(atBReady.devServers, "one dev server when B is ready").toHaveLength(1);
      expect(after.devServers, "the same dev server after A answered").toEqual(
        atBReady.devServers,
      );
      expect(after.gateShells, "no serve gate left un-exec'd").toEqual([]);

      // What each tab shows. B: its own content, from its server.
      const frameB = await previewDocument(tabB);
      await expect(
        frameB.getByText(markerB, { exact: false }).first(),
        "tab B shows B's draft",
      ).toBeVisible({ timeout: 90_000 });
      const rendered = await renderedDocument(frameB);
      expect(rendered.status, "B's server renders its page").toBe(200);
      expect(rendered.body, "B's server renders B's draft").toContain(markerB);
      expect(rendered.body, "and not A's").not.toContain(markerA);
      // A: the start failure, with its reference.
      await expect(
        tabA.getByRole("alert").filter({ hasText: `reference ${reference}` }),
        "tab A shows its start failed",
      ).toBeVisible({ timeout: 30_000 });

      // Still exactly one start each: B was not knocked into a reconnect,
      // and A did not try again on its own.
      expect(callsA.startsSent, "tab A sent no further start").toHaveLength(1);
      expect(callsB.startsSent, "tab B sent no further start").toHaveLength(1);
      const settled = await containerState(container, markerA, markerB);
      evidence.settled = settled;
      expect(settled.devServers, "B's dev server is still the one running").toEqual(
        atBReady.devServers,
      );
      expect(settled.marker, "and its marker unchanged").toBe(after.marker);
    } finally {
      polling = false;
      await poller.catch(() => {});
      evidence.timeline = timeline;
      annotate();
      await test.info().attach("two-tab-race.json", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      await context.close();
    }
  });
});
