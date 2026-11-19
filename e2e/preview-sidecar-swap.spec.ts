import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, previewFrame } from "./helpers";
import { MARKER, heroContentField } from "./helpers/editor-writes-paused";
import { isSidecarSwapRun, requestSidecarSwap } from "./helpers/sidecar-swap";

type SwapReady = {
  at: number;
  previewDocument: string;
  ack: boolean;
  served: string;
};
type SwapAck = { at: number; previewDocument: string; status: string };

/**
 * Records, in the editor's own window only, each ready and acknowledgement
 * a preview frame posts to it. Observation only.
 */
function recordSwapMessages() {
  if (window.top !== window) return;
  const state = { readies: [] as SwapReady[], acks: [] as SwapAck[] };
  (window as unknown as { __swapMessages: typeof state }).__swapMessages = state;
  window.addEventListener("message", (event) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return;
    const previewDocument =
      typeof data.previewDocument === "string" ? data.previewDocument : "";
    if (data.type === "morph:storefront-preview-ready") {
      const served = data.servedInstance as
        | { kind?: string; instance?: { session?: string; serial?: number } }
        | null
        | undefined;
      state.readies.push({
        at: Date.now(),
        previewDocument,
        ack:
          Array.isArray(data.capabilities) &&
          data.capabilities.includes("section-presentation-ack-v1"),
        served:
          served?.kind === "known"
            ? `known:${served.instance?.session}.${served.instance?.serial}`
            : (served?.kind ?? (served === null ? "null" : "none")),
      });
    } else if (data.type === "morph:storefront-preview-section-presentation-ack") {
      state.acks.push({
        at: Date.now(),
        previewDocument,
        status: typeof data.status === "string" ? data.status : "",
      });
    }
  });
}

const swapMessages = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __swapMessages?: { readies: SwapReady[]; acks: SwapAck[] } })
        .__swapMessages ?? { readies: [], acks: [] },
  );

/** The server function a request calls, read from its id; null for others. */
function serverFunctionName(url: string): string | null {
  const id = url.split("/_serverFn/")[1]?.split(/[/?]/)[0];
  if (!id) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { export?: string };
    return (decoded.export ?? "").replace(/_createServerFn_handler$/, "") || null;
  } catch {
    return null;
  }
}

/**
 * A numeric field of a server function's serialized body, wherever it is:
 * the body is a tree of `{ p: { k: [...keys], v: [...values] } }` nodes.
 */
function serializedNumber(body: string, key: string): number | null {
  let found: number | null = null;
  const visit = (node: unknown) => {
    if (found !== null || !node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const props = record.p as { k?: unknown[]; v?: unknown[] } | undefined;
    if (props && Array.isArray(props.k) && Array.isArray(props.v)) {
      const index = props.k.indexOf(key);
      if (index >= 0) {
        const value = props.v[index] as { s?: unknown } | number | undefined;
        if (typeof value === "number") found = value;
        else if (value && typeof value.s === "number") found = value.s;
        else if (value && typeof value.s === "string" && /^\d+$/.test(value.s)) found = Number(value.s);
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  try {
    visit(JSON.parse(body));
  } catch {
    const match = new RegExp(`"${key}"\\D{0,12}(\\d+)`).exec(body);
    if (match) found = Number(match[1]);
  }
  return found;
}

/**
 * The real swap: the run's first sidecar comes from another checkout (main),
 * whose bridge cannot acknowledge and whose service reports no serving
 * bridge; mid-test the runner replaces it with this checkout's. Nothing is
 * routed or rewritten and no tab is opened: the editor stays on one page and
 * what it, the frame and Vite say is only listened to.
 *
 * Before the swap the author changes a field and leaves it, so the change is
 * a committed edit the old frame cannot acknowledge. After the swap the run
 * waits, without acting, for whatever reloads the frame; if nothing does,
 * the author presses the editor's own Reload button, and that is recorded
 * as what recovered the frame. The case is judged on what the trace shows:
 * one reload, a new frame that acknowledges, the text kept, the edit
 * written at most once.
 *
 * Its own entry, not part of any suite: `playwright.config.ts` collects this
 * file only in the runner's swap mode (`MORPH_E2E_SIDECAR_SWAP=1`, which the
 * runner sets for the suite it starts with `MORPH_E2E_SIDECAR_SWAP_FROM`), so
 * CI and every other run never list it, and it is in no shard. Run it with
 *
 *   MORPH_E2E_SIDECAR_SWAP_FROM=/abs/main/checkout \
 *     node scripts/run-editor-e2e.mjs -- e2e/preview-sidecar-swap.spec.ts
 *
 * on the runtime under test, like any other local run. If it is collected
 * outside swap mode anyway, it fails at its first line rather than skipping.
 */
test.describe("a real sidecar swap under an open editor", () => {
  test("after the old sidecar is replaced, the frame reloads once, acknowledges, and the author's edit is kept and written once", async ({
    page,
  }) => {
    test.setTimeout(480_000);
    expect(
      isSidecarSwapRun(),
      "started by the e2e runner in sidecar swap mode (MORPH_E2E_SIDECAR_SWAP_FROM)",
    ).toBe(true);
    const t0 = Date.now();
    const rel = (at: number) => `+${at - t0}ms`;
    const timeline: string[] = [];
    const note = (line: string) => {
      const entry = `${rel(Date.now())} ${line}`;
      timeline.push(entry);
      console.log(`[real swap] ${entry}`);
    };
    let swappedAt = Number.POSITIVE_INFINITY;
    const lines: Array<{ at: number; text: string; from: string }> = [];
    page.on("console", (message) => {
      const text = message.text();
      if (!text.startsWith("[preview-") && !text.includes("[vite]")) return;
      let from = "?";
      try {
        from = new URL(message.location().url).host || "?";
      } catch {
        /* No location. */
      }
      lines.push({ at: Date.now(), text, from });
      note(`console from ${from}: ${text}`);
    });
    const navigations: Array<{ at: number; url: string }> = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        note(`editor page navigated ${frame.url()}`);
        return;
      }
      navigations.push({ at: Date.now(), url: frame.url() });
      note(`frame navigated ${frame.url()}`);
    });
    const startAnswers: Array<{ at: number; ackCapability: boolean }> = [];
    let marker = "";
    const writes: Array<{
      at: number;
      name: string;
      carriesMarker: boolean;
      expectedDraftGeneration: number | null;
    }> = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const name = serverFunctionName(request.url());
      if (!name) return;
      if (/^(save|update|publish|delete|create|restore|write|reset|remove|rename|move|upload|promote|apply|set|ensure)[A-Z]/.test(name)) {
        const body = request.postData() ?? "";
        const entry = {
          at: Date.now(),
          name,
          carriesMarker: marker !== "" && body.includes(marker),
          expectedDraftGeneration: serializedNumber(body, "expectedDraftGeneration"),
        };
        writes.push(entry);
        note(`write sent ${JSON.stringify(entry)}`);
      } else if (name === "startThemePreviewServer" || name === "touchThemePreviewServer") {
        note(`${name} sent`);
      }
    });
    page.on("response", (response) => {
      const name = serverFunctionName(response.url());
      if (!name) return;
      if (name === "startThemePreviewServer" || name === "touchThemePreviewServer") {
        void response.text().then(
          (body) => {
            // The key is always in the answer; what it holds is what counts,
            // and the editor's own decision line says how it read it.
            const at = body.indexOf("servingBridge");
            const servingBridge = at < 0 ? "absent" : body.slice(at, at + 160);
            const ackCapability = body.includes("section-presentation-ack-v1");
            if (name === "startThemePreviewServer") {
              startAnswers.push({ at: Date.now(), ackCapability });
            }
            note(
              `${name} answered ${response.status()}: ack capability ${ackCapability}, servedInstance ${body.includes("servedInstance")}, servingBridge ${servingBridge}`,
            );
          },
          () => note(`${name} answered ${response.status()}, body unreadable`),
        );
      } else if (writes.some((write) => write.name === name)) {
        void response.text().then(
          (body) => note(`${name} answered ${response.status()}: ${body.slice(0, 300)}`),
          () => note(`${name} answered ${response.status()}`),
        );
      }
    });
    await page.addInitScript(recordSwapMessages);

    // The editor on the old sidecar. Not `openEditor`: with a bridge that
    // cannot acknowledge, the editor pauses edits and its section tree never
    // becomes sortable, which `openEditor` waits for.
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.locator("iframe").first()).toBeAttached({ timeout: 90_000 });
    await expect(
      previewFrame(page).locator("[data-storefront-section-id]").first(),
    ).toBeAttached({ timeout: 90_000 });
    await expect
      .poll(async () => (await swapMessages(page)).readies.length, { timeout: 120_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() => lines.filter((line) => line.text.startsWith("[preview-bridge]")).length, {
        timeout: 60_000,
      })
      .toBeGreaterThan(0)
      .catch(() => note("the editor said nothing about the old frame's bridge"));
    const before = await swapMessages(page);
    note(`before the swap: readies ${JSON.stringify(before.readies.map((r) => ({ ...r, at: rel(r.at) })))}`);
    expect(before.readies.every((ready) => !ready.ack), "the old bridge cannot acknowledge").toBe(true);
    expect(startAnswers.length).toBeGreaterThan(0);
    expect(
      startAnswers.every((answer) => !answer.ackCapability),
      "nothing the old service answered names the acknowledging capability",
    ).toBe(true);
    expect(
      lines.some((line) =>
        line.text.startsWith("[preview-bridge] frame cannot acknowledge; serving unknown"),
      ),
      "the editor read what is serving as unknown",
    ).toBe(true);

    // The author's edit, committed by leaving the field, if the old frame
    // lets the author reach one; with sections disabled it cannot be made,
    // and is not faked.
    const heroButton = page.getByRole("button", { name: "hero", exact: true });
    const heroEnabled = await heroButton.isEnabled().catch(() => false);
    note(
      `before the swap: hero section button enabled ${heroEnabled}; paused notice ${await page
        .getByText(/content edits are paused/)
        .first()
        .textContent()
        .catch(() => null)}`,
    );
    let editedBeforeSwap = false;
    let original = "";
    if (heroEnabled) {
      const field = await heroContentField(page, 0);
      original = await field.inputValue();
      marker = `${MARKER} real swap ${Date.now()}`;
      await field.fill(marker);
      await field.press("Tab");
      await expect(field).toHaveValue(marker);
      editedBeforeSwap = true;
      note(`edited and left the field; writes so far ${JSON.stringify(writes)}`);
    } else {
      note("no edit before the swap: the old frame leaves every section disabled");
    }
    const frameBefore = await page.locator("iframe").first().elementHandle();
    expect(frameBefore, "the editor shows a preview frame").not.toBeNull();
    const pausedBefore = await page
      .getByText(/Content writes are paused/)
      .first()
      .isVisible()
      .catch(() => false);
    note(`writes-paused notice before the swap: ${pausedBefore}`);

    // The runner swaps the sidecar.
    note("requesting the swap");
    const done = await requestSidecarSwap();
    swappedAt = Date.now();
    note(`swap done: ${JSON.stringify(done)}`);

    // Whatever reloads the frame, on its own.
    const newReadies = async () =>
      (await swapMessages(page)).readies.filter((ready) => ready.at > swappedAt);
    let authorReloaded = false;
    try {
      await expect.poll(async () => (await newReadies()).length, { timeout: 150_000 }).toBeGreaterThan(0);
    } catch {
      note("no new frame within 150 s of the swap; the author presses the editor's Reload button");
      const alert = page.getByTestId("preview-presentation-unconfirmable");
      const button = alert.getByRole("button");
      note(
        `alert visible ${await alert.isVisible().catch(() => false)}, button ${await button.textContent().catch(() => null)}`,
      );
      authorReloaded = true;
      note("author clicks Reload");
      await button.click();
      await expect.poll(async () => (await newReadies()).length, { timeout: 150_000 }).toBeGreaterThan(0);
    }
    await expect
      .poll(async () => (await newReadies()).some((ready) => ready.ack), { timeout: 120_000 })
      .toBe(true);
    const newDocument = (await newReadies()).find((ready) => ready.ack)!.previewDocument;
    const firstNewAt = (await newReadies())[0].at;
    // The sections come back once the new frame has reported its structure.
    await expect(page.locator("[data-editor-tree-sortable]").first()).toBeAttached({
      timeout: 60_000,
    });
    let keptText: string | null = null;
    // Acknowledgements that count for the edit: after it was made. The new
    // frame also acknowledges the content replayed into it, earlier.
    let ackAfter = firstNewAt;
    if (editedBeforeSwap) {
      // The edit continues on the new frame.
      await expect
        .poll(() => writes.filter((write) => write.carriesMarker).length, {
          timeout: 45_000,
          message: "the author's edit was written after the new frame came up",
        })
        .toBeGreaterThan(0);
      const field = await heroContentField(page, 0);
      keptText = await field.inputValue();
    } else {
      // An edit on the new frame, for its own acknowledgement.
      const field = await heroContentField(page, 0);
      original = await field.inputValue();
      marker = `${MARKER} real swap after ${Date.now()}`;
      ackAfter = Date.now();
      await field.fill(marker);
      await field.press("Tab");
      await expect(field).toHaveValue(marker);
      note("edited the field on the new frame");
      await expect
        .poll(() => writes.filter((write) => write.carriesMarker).length, {
          timeout: 45_000,
          message: "the edit made on the new frame was written",
        })
        .toBeGreaterThan(0);
    }
    await expect
      .poll(
        async () =>
          (await swapMessages(page)).acks.some(
            (ack) =>
              ack.previewDocument === newDocument &&
              ack.status === "applied" &&
              ack.at > ackAfter,
          ),
        {
          timeout: 45_000,
          message: "the new frame acknowledged the edit as applied",
        },
      )
      .toBe(true);

    const sameElement = await page
      .evaluate((element) => element === document.querySelector("iframe"), frameBefore!)
      .catch(() => false);
    const originalConnected = await frameBefore!
      .evaluate((element) => element.isConnected)
      .catch(() => false);
    const final = await swapMessages(page);
    const after = final.readies.filter((ready) => ready.at > swappedAt);
    const firstNew = after[0];
    const markerWrites = writes.filter((write) => write.carriesMarker);
    const appliedOnNew = final.acks.filter(
      (ack) => ack.previewDocument === newDocument && ack.status === "applied",
    );
    const summary = {
      swap: done,
      authorReloaded,
      firstNewReadyAt: firstNew ? rel(firstNew.at) : null,
      linesFromSwapToFirstNewReady: lines
        .filter((line) => line.at > swappedAt && (!firstNew || line.at <= firstNew.at))
        .map((line) => `${rel(line.at)} ${line.from} ${line.text}`),
      frameNavigationsAfterSwap: navigations
        .filter((navigation) => navigation.at > swappedAt)
        .map((navigation) => `${rel(navigation.at)} ${navigation.url}`),
      readies: final.readies.map((ready) => ({ ...ready, at: rel(ready.at) })),
      newDocumentsAfterSwap: [...new Set(after.map((ready) => ready.previewDocument))],
      acksOnNewDocument: appliedOnNew.map((ack) => rel(ack.at)),
      markerWrites: markerWrites.map((write) => ({ ...write, at: rel(write.at) })),
      writes: writes.map((write) => ({ ...write, at: rel(write.at) })),
      writesPausedBeforeSwap: pausedBefore,
      editedBeforeSwap,
      acksCountFrom: rel(ackAfter),
      keptText,
      sameFrameElement: sameElement,
      originalElementConnected: originalConnected,
    };
    console.log(`[real swap] summary ${JSON.stringify(summary)}`);
    test.info().annotations.push(
      { type: "real swap summary", description: JSON.stringify(summary) },
      { type: "real swap timeline", description: timeline.join("\n") },
    );

    // Judged on the trace, all of it taken before the field is put back, so
    // the restore's own write and acknowledgement cannot count: one new
    // frame, which acknowledges; the author's edit written exactly once and
    // acknowledged as applied by the new frame after it was made; the
    // author's text kept when it was made before the swap.
    expect(summary.newDocumentsAfterSwap, "the frame reloaded exactly once").toHaveLength(1);
    expect(after.some((ready) => ready.ack), "the new frame can acknowledge").toBe(true);
    expect(markerWrites.length, "the edit was written exactly once").toBe(1);
    expect(
      appliedOnNew.some((ack) => ack.at > ackAfter),
      "the new frame acknowledged the edit",
    ).toBe(true);
    if (editedBeforeSwap) expect(keptText, "the author's text was kept").toBe(marker);

    // Put the field back, as the other cases do.
    const restore = await heroContentField(page, 0);
    await restore.fill(original);
    await restore.press("Tab");
    await expect(restore).toHaveValue(original);
    // And still exactly once once the restore has gone out.
    expect(writes.filter((write) => write.carriesMarker)).toHaveLength(1);
  });
});
