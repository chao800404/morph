import { execFileSync } from "node:child_process";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  EDITOR_PATH,
  openContentTab,
  openEditor,
  settleSelection,
} from "./helpers";

/**
 * What the editor does with unsaved work when who is signed in changes.
 *
 * Each case edits the seeded home page's hero in Code, where the draft is
 * plain to read back from Monaco — by the marker comments it carries, since
 * saving from Code formats the source first, and checks four things the author depends
 * on: nothing is sent while writes are paused, the draft stays, saving waits
 * for the author to confirm, and what is saved is the newest draft — never
 * an older copy, never over someone else's newer save, never as another
 * account.
 *
 * Sessions: a case that signs out signs in a context of its own first, so
 * the session it ends is its own — the stored one in `e2e/.auth/user.json` is
 * shared by every other spec and is never signed out here. A case that only
 * needs the browser to stop sending a session clears its cookies instead,
 * which ends nothing on the server; putting them back is signing in again.
 * Sign-in is rate limited (five a minute), which is the other reason to use
 * it only where signing out is the point.
 */

/** Seeded by `scripts/seed-e2e.mjs`, with the same password. */
const SECOND_EMAIL = "e2e-second-admin@morph.invalid";
const MARKER = "editor-writes-paused";

const email = () => process.env.E2E_EMAIL!;
const password = () => process.env.E2E_PASSWORD!;

const STORAGE_STATE = "e2e/.auth/user.json";

async function signIn(context: BrowserContext, address: string) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  for (let attempt = 0; ; attempt += 1) {
    const response = await context.request.post("/api/auth/sign-in/email", {
      data: { email: address, password: password() },
      headers: { origin },
    });
    // Rate limited: wait for the window rather than fail on it.
    if (response.status() === 429 && attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    expect(response.ok(), `sign-in as ${address}`).toBe(true);
    return;
  }
}

async function signOut(context: BrowserContext) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const response = await context.request.post("/api/auth/sign-out", {
    data: {},
    headers: { origin },
  });
  expect(response.ok(), "sign-out").toBe(true);
}

/** An editor on a session of its own, for a case that signs out. */
async function signedInEditor(browser: Browser, address = email()) {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 950 },
  });
  await signIn(context, address);
  const page = await context.newPage();
  await openEditor(page);
  return { context, page };
}

/** An editor on the shared session, for a case that never signs out. */
async function sharedEditor(browser: Browser) {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 950 },
    storageState: STORAGE_STATE,
  });
  const page = await context.newPage();
  await openEditor(page);
  return { context, page };
}

/** Opens the hero in Code and returns its path. */
async function openHeroInCode(page: Page) {
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await openContentTab(page);
  const openInCode = page.locator('button[title$=" in Monaco Code Editor"]');
  const hero = (await openInCode.getAttribute("title"))!
    .replace(/^Open /, "")
    .replace(/ in Monaco Code Editor$/, "");
  await openInCode.click();
  await expect
    .poll(() => readSource(page, hero).catch(() => null), { timeout: 30_000 })
    .not.toBeNull();
  return hero;
}

function readSource(page: Page, path: string) {
  return page.evaluate(
    (target) =>
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(target))
        .getValue() as string,
    path,
  );
}

async function editAndSave(page: Page, path: string, next: string) {
  await page.evaluate(
    ({ target, value }) =>
      (window as any).monaco.editor
        .getModels()
        .find((model: any) => model.uri.path.endsWith(target))
        .setValue(value),
    { target: path, value: next },
  );
  await page.keyboard.press("Control+s");
}

/**
 * Whether a request is a call of the Theme file save itself.
 *
 * A server function's id is base64 JSON naming its export; reading it is how
 * the save is told apart from the preview's file sync, which carries the same
 * path in its body.
 */
function isFileSave(url: string, body: string, path: string) {
  return body.includes(path) && isServerFn(url, "saveStorefrontThemeFile");
}

/** Whether a request calls the server function exported as `name`. */
function isServerFn(url: string, name: string) {
  const id = url.split("/_serverFn/")[1]?.split(/[/?]/)[0];
  if (!id) return false;
  try {
    const decoded = JSON.parse(
      Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    ) as { export?: string };
    return (decoded.export ?? "").startsWith(`${name}_`);
  } catch {
    return false;
  }
}

/**
 * The next answer to a save of `path` itself — not the preview's file sync,
 * which carries the same path. Resolves to whether it landed: a refused save
 * is answered with 200 too, and only the body tells them apart.
 */
async function nextFileSave(page: Page, path: string) {
  const response = await page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isFileSave(
        response.request().url(),
        response.request().postData() ?? "",
        path,
      ),
    { timeout: 30_000 },
  );
  expect(response.ok()).toBe(true);
  return (await response.text()).includes("Theme file saved");
}

/**
 * The next answer to a section content write: "saved", "conflict" (the
 * document moved), or "failed".
 */
async function nextContentWrite(page: Page) {
  const response = await page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFn(response.request().url(), "updateStorefrontThemeSectionProps"),
    { timeout: 30_000 },
  );
  expect(response.ok()).toBe(true);
  const body = await response.text();
  if (body.includes("Theme section props updated")) return "saved" as const;
  if (body.includes("TEMPLATE_DRAFT_CONFLICT")) return "conflict" as const;
  return "failed" as const;
}

/** The next answer to a section rename: "saved", "conflict" or "failed". */
async function nextRename(page: Page) {
  const response = await page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFn(response.request().url(), "renameStorefrontThemeSection"),
    { timeout: 30_000 },
  );
  expect(response.ok()).toBe(true);
  const body = await response.text();
  if (body.includes("Section renamed")) return "saved" as const;
  if (body.includes("TEMPLATE_DRAFT_CONFLICT")) return "conflict" as const;
  return "failed" as const;
}

/** Opens the rename dialog of a section from its row in the tree. */
async function openRename(page: Page, section: string) {
  await page
    .getByRole("button", { name: section, exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByLabel("Section name");
  await expect(input).toBeVisible();
  return input;
}

/** Counts the calls of the section content write, from now on. */
function countContentWrites(page: Page) {
  const counter = { sent: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      isServerFn(request.url(), "updateStorefrontThemeSectionProps")
    ) {
      counter.sent += 1;
    }
  });
  return counter;
}

/** Counts the calls of the file save itself for `path`, from now on. */
function countFileSaves(page: Page, path: string) {
  const counter = { sent: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      isFileSave(request.url(), request.postData() ?? "", path)
    ) {
      counter.sent += 1;
    }
  });
  return counter;
}

/** Counts the saves of `path` this page sends to the server from now on. */
function countSaves(page: Page, path: string) {
  const counter = { sent: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/_serverFn/") &&
      (request.postData() ?? "").includes(path)
    ) {
      counter.sent += 1;
    }
  });
  return counter;
}

const pausedNotice = (page: Page) =>
  page.locator("[data-editor-writes-paused]");

const unconfirmedNotice = (page: Page) =>
  page.locator("[data-editor-unconfirmed-saves]");

/** One of the hero's content fields in Design, the first by default. */
function heroContentField(page: Page, index = 0) {
  return sectionContentField(page, "hero", index);
}

/** One of a section's text content fields in Design. */
async function sectionContentField(page: Page, section: string, index = 0) {
  await page.getByRole("button", { name: section, exact: true }).click();
  await settleSelection(page);
  await openContentTab(page);
  const field = page
    .locator('[data-slot="inspector-content-field"] input')
    .nth(index);
  await expect(field).toBeVisible({ timeout: 30_000 });
  return field;
}

/** Writes a hero content field and waits for the write to land. */
function writeHeroField(page: Page, index: number, value: string) {
  return writeSectionField(page, "hero", index, value);
}

/** Writes a section's content field and waits for the write to land. */
async function writeSectionField(
  page: Page,
  section: string,
  index: number,
  value: string,
) {
  const field = await sectionContentField(page, section, index);
  if ((await field.inputValue()) === value) return;
  const answer = nextContentWrite(page);
  await field.fill(value);
  await field.press("Tab");
  expect(await answer, `the write of ${value}`).toBe("saved");
}

const withoutMarkers = (source: string) =>
  source
    .split("\n")
    .filter((line) => !line.includes(MARKER))
    .join("\n");

/** Puts the hero back as it was, from a session of its own. */
async function restoreHero(browser: Browser, hero: string) {
  const { context, page } = await sharedEditor(browser);
  try {
    await openHeroInCode(page);
    const source = await readSource(page, hero);
    if (withoutMarkers(source) === source) return;
    const landed = nextFileSave(page, hero);
    await editAndSave(page, hero, withoutMarkers(source));
    expect(await landed, "the hero restored").toBe(true);
  } finally {
    await context.close();
  }
}

/** The run's own database, as `scripts/seed-e2e.mjs` reaches it. */
function runSql(command: string) {
  const env =
    (process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
      ? ["--env", "local_preview_e2e"]
      : [];
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      "--local",
      ...env,
      "--persist-to",
      process.env.MORPH_E2E_STATE_DIR!,
      "--command",
      command,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

test.describe("unsaved work when the signed-in account changes", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  test("signed out: the draft stays, nothing is sent, and the newest draft is saved on confirmation", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await signedInEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const first = `${original}\n/* ${MARKER} first */`;
    const newest = `${first}\n/* ${MARKER} newest */`;
    try {
      await signOut(context);
      await editAndSave(page, hero, first);
      await expect(pausedNotice(page)).toContainText(
        "Your sign-in has expired",
      );

      // Paused: a keyboard save sends nothing, and the edit is kept.
      const saves = countSaves(page, hero);
      await editAndSave(page, hero, newest);
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(0);
      expect(await readSource(page, hero)).toContain(`${MARKER} newest`);

      await signIn(context, email());
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");
      // Verified is not consent: still nothing sent.
      expect(saves.sent).toBe(0);

      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();
      await expect(pausedNotice(page)).toHaveCount(0, { timeout: 30_000 });

      // What was saved is the newest draft, as a fresh load reads it.
      await openEditor(page);
      await openHeroInCode(page);
      await expect
        .poll(() => readSource(page, hero))
        .toContain(`${MARKER} newest`);
      expect(await readSource(page, hero)).toContain(`${MARKER} first`);
    } finally {
      await context.close();
      await restoreHero(browser, hero);
    }
  });

  test("session lost: after the first refusal nothing more is sent", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      // As a session cookie that has expired: the browser has none to send.
      await context.clearCookies();
      await editAndSave(page, hero, `${original}\n/* ${MARKER} lost */`);
      await expect(pausedNotice(page)).toContainText(
        "Your sign-in has expired",
      );

      const saves = countSaves(page, hero);
      await editAndSave(page, hero, `${original}\n/* ${MARKER} lost again */`);
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(0);
      expect(await readSource(page, hero)).toContain(`${MARKER} lost again`);
    } finally {
      await context.close();
      await restoreHero(browser, hero);
    }
  });

  test("no permission: writes stay paused even with a session, until access returns", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const draft = `${original}\n/* ${MARKER} denied */`;
    // The session caches the role in a cookie for minutes; dropping that
    // cookie makes the next request read the role from the database.
    const forgetCachedRole = () =>
      context.clearCookies({ name: /session_data/ });
    try {
      runSql(
        `UPDATE users SET role = 'user' WHERE email = '${email().replace(/'/g, "''")}';`,
      );
      await forgetCachedRole();
      await editAndSave(page, hero, draft);
      await expect(pausedNotice(page)).toContainText(
        "Your account cannot change this Theme",
      );

      // Signed in, still not allowed: checking again keeps it paused.
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText(
        "Your account cannot change this Theme",
      );
      expect(await readSource(page, hero)).toContain(`${MARKER} denied`);

      runSql(
        `UPDATE users SET role = 'admin' WHERE email = '${email().replace(/'/g, "''")}';`,
      );
      await forgetCachedRole();
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");
      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();
      await expect(pausedNotice(page)).toHaveCount(0, { timeout: 30_000 });
    } finally {
      runSql(
        `UPDATE users SET role = 'admin' WHERE email = '${email().replace(/'/g, "''")}';`,
      );
      await context.close();
      await restoreHero(browser, hero);
    }
  });

  test("another account signed in here: the draft is never saved as that account", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await signedInEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      // Another tab of the same browser signs out and in as someone else.
      await signOut(context);
      await signIn(context, SECOND_EMAIL);
      // Coming back to the editor is when it looks.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );

      const saves = countSaves(page, hero);
      await editAndSave(page, hero, `${original}\n/* ${MARKER} other */`);
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(0);

      // Checking again as the other account changes nothing.
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      expect(saves.sent).toBe(0);
    } finally {
      await context.close();
      await restoreHero(browser, hero);
    }
  });

  test("another account signed in, editor never looked: the server refuses the save", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      // Another tab signs this browser in as someone else.
      await signIn(context, SECOND_EMAIL);
      // No focus, no visibility change: the editor has had no reason to
      // ask who is signed in. The save itself says whose it is.
      await editAndSave(page, hero, `${original}\n/* ${MARKER} unasked */`);
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      expect(await readSource(page, hero)).toContain(`${MARKER} unasked`);
    } finally {
      await context.close();
    }
    // Nothing was written as the other account.
    const check = await sharedEditor(browser);
    try {
      await openHeroInCode(check.page);
      expect(await readSource(check.page, hero)).not.toContain(MARKER);
    } finally {
      await check.context.close();
      await restoreHero(browser, hero);
    }
  });

  test("verified, then another account signs in before saving: the save is refused", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const session = await context.cookies();
    try {
      await context.clearCookies();
      await editAndSave(page, hero, `${original}\n/* ${MARKER} late */`);
      await expect(pausedNotice(page)).toContainText(
        "Your sign-in has expired",
      );
      await context.addCookies(session);
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");

      // Between checking and saving, another tab signs in as someone else.
      await signIn(context, SECOND_EMAIL);
      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();
      await expect(pausedNotice(page)).toContainText(
        "A different account is signed in",
      );
      expect(await readSource(page, hero)).toContain(`${MARKER} late`);
    } finally {
      await context.close();
    }
    const check = await sharedEditor(browser);
    try {
      await openHeroInCode(check.page);
      expect(await readSource(check.page, hero)).not.toContain(MARKER);
    } finally {
      await check.context.close();
      await restoreHero(browser, hero);
    }
  });

  test("connection lost before the save arrived: not resent on its own, checked, then sent once", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      const saves = countFileSaves(page, hero);
      // The save's request fails in the network, with no answer at all.
      // Only the save: the preview's own sync is left alone.
      await page.route("**/_serverFn/**", (route) =>
        isFileSave(
          route.request().url(),
          route.request().postData() ?? "",
          hero,
        )
          ? route.abort("internetdisconnected")
          : route.fallback(),
      );
      await editAndSave(page, hero, `${original}\n/* ${MARKER} offline */`);
      await expect.poll(() => saves.sent, { timeout: 15_000 }).toBe(1);
      // Long enough for autosave (700 ms, 250 ms behind a save in flight) to
      // have gone several times over, had it been allowed to.
      await page.waitForTimeout(5_000);

      // Not a sign-in problem, the draft is still here, and nothing went
      // again on its own.
      await expect(pausedNotice(page)).toHaveCount(0);
      await expect(unconfirmedNotice(page)).toBeVisible();
      expect(saves.sent).toBe(1);
      expect(await readSource(page, hero)).toContain(`${MARKER} offline`);

      // Back online. Switching to Design is not asking to save: it stops
      // and says why, sends nothing, and leaves the author in Code.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.getByRole("button", { name: "Design", exact: true }).click();
      await expect(
        page.getByText("It could not be confirmed whether an earlier save"),
      ).toBeVisible();
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(1);
      expect(await readSource(page, hero)).toContain(`${MARKER} offline`);

      // The author checks: the server does not hold it, so it is sent — once.
      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      expect(saves.sent).toBe(2);

      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        expect(await readSource(check.page, hero)).toContain(
          `${MARKER} offline`,
        );
      } finally {
        await check.context.close();
      }
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
      await restoreHero(browser, hero);
    }
  });

  test("the save landed and only its answer was lost: checked, not sent again", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    try {
      const saves = countFileSaves(page, hero);
      // The save reaches the server and is made; the answer is cut off on
      // its way back. Only the first one: anything after it would pass.
      let cut = false;
      await page.route("**/_serverFn/**", async (route) => {
        const request = route.request();
        if (cut || !isFileSave(request.url(), request.postData() ?? "", hero)) {
          return route.fallback();
        }
        cut = true;
        const response = await route.fetch();
        expect(response.ok(), "the save itself was made").toBe(true);
        await route.abort("connectionreset");
      });
      await editAndSave(page, hero, `${original}\n/* ${MARKER} landed */`);
      await expect.poll(() => saves.sent, { timeout: 15_000 }).toBe(1);
      await page.waitForTimeout(5_000);

      await expect(pausedNotice(page)).toHaveCount(0);
      await expect(unconfirmedNotice(page)).toBeVisible();
      expect(saves.sent).toBe(1);

      // Checking finds the save on the server: recorded as saved, and not
      // sent again — no second write, and no conflict with itself.
      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      expect(saves.sent).toBe(1);
      await expect(
        page.getByText("Remote source changes detected in this theme"),
      ).toHaveCount(0);
      expect(await readSource(page, hero)).toContain(`${MARKER} landed`);

      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        const held = await readSource(check.page, hero);
        // Applied once: the marker is there, and only once.
        expect(held.split(`${MARKER} landed`).length - 1).toBe(1);
      } finally {
        await check.context.close();
      }

      // The next save. This tab did not take the Theme's source generation
      // from the check, so it may meet the source-conflict notice once; it
      // must go through on that press and overwrite nothing.
      const before = saves.sent;
      await editAndSave(
        page,
        hero,
        `${await readSource(page, hero)}\n/* ${MARKER} next */`,
      );
      await expect.poll(() => saves.sent, { timeout: 15_000 }).toBe(before + 1);
      const sourceConflict = page.getByText(
        "Remote source changes detected in this theme",
      );
      await page.waitForTimeout(3_000);
      const metConflict = (await sourceConflict.count()) > 0;
      test.info().annotations.push({
        type: "next-save",
        description: metConflict ? "source-conflict-once" : "saved-directly",
      });
      if (metConflict) {
        await page
          .getByRole("status")
          .filter({ hasText: "Remote source changes detected" })
          .getByRole("button", { name: "Save my changes" })
          .click();
        await expect(sourceConflict).toHaveCount(0, { timeout: 30_000 });
      }
      const after = await sharedEditor(browser);
      try {
        await openHeroInCode(after.page);
        const held = await readSource(after.page, hero);
        expect(held.split(`${MARKER} landed`).length - 1).toBe(1);
        expect(held.split(`${MARKER} next`).length - 1).toBe(1);
      } finally {
        await after.context.close();
      }
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
      await restoreHero(browser, hero);
    }
  });

  test("a content write that landed with its answer lost is not sent again", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const field = await heroContentField(page);
    const original = await field.inputValue();
    const marker = `${MARKER} content ${Date.now()}`;
    try {
      const writes = countContentWrites(page);
      let cut = false;
      await page.route("**/_serverFn/**", async (route) => {
        if (
          cut ||
          !isServerFn(
            route.request().url(),
            "updateStorefrontThemeSectionProps",
          )
        ) {
          return route.fallback();
        }
        cut = true;
        const response = await route.fetch();
        expect(response.ok(), "the write itself was made").toBe(true);
        await route.abort("connectionreset");
      });
      await field.fill(marker);
      await field.press("Tab");
      await expect.poll(() => writes.sent, { timeout: 15_000 }).toBe(1);
      await page.waitForTimeout(5_000);

      // Not retried on its own, and the edit is kept.
      expect(writes.sent).toBe(1);
      await expect(unconfirmedNotice(page)).toBeVisible();
      await expect(pausedNotice(page)).toHaveCount(0);

      // Publishing is not asking to save: it cannot be started until the
      // unanswered write is checked.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await expect(
        page.getByRole("button", { name: /^Publish$/ }),
      ).toBeDisabled();
      expect(writes.sent).toBe(1);

      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
        "aria-label",
        /^(Unpublished|Published)$/,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(2_000);
      // Found on the server, so nothing was sent again, and the author is
      // not asked to resolve a conflict with their own write.
      expect(writes.sent).toBe(1);
      await expect(
        page.getByRole("button", { name: "Load latest, keep mine" }),
      ).toHaveCount(0);

      // And it is what the server holds.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await openEditor(page);
      await expect(await heroContentField(page)).toHaveValue(marker);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const restore = await heroContentField(page).catch(() => null);
      if (restore && (await restore.inputValue()) !== original) {
        const answer = nextContentWrite(page);
        await restore.fill(original);
        await restore.press("Tab");
        expect(await answer, "the field restored").toBe("saved");
      }
      await context.close();
    }
  });

  /**
   * A content write lands and its answer is cut off; meanwhile another tab
   * writes `theirs` into `other`. Checks what the author is left with: their
   * newest edit, the other tab's, and nothing dropped.
   */
  async function landedThenAnotherWriter(
    browser: Browser,
    other: { section: string; index: number },
  ) {
    const { context, page } = await sharedEditor(browser);
    let otherTab: Awaited<ReturnType<typeof sharedEditor>> | null = null;
    const originals = {
      mine: await (await heroContentField(page, 0)).inputValue(),
      theirs: await (
        await sectionContentField(page, other.section, other.index)
      ).inputValue(),
    };
    const stamp = Date.now();
    const value = (name: string) => `${MARKER} ${name} ${stamp}`;
    const writes = countContentWrites(page);
    try {
      // A write answered normally first, so this tab holds the document's
      // generation from its own writes.
      await writeHeroField(page, 0, value("first"));

      // The next write is made; its answer is cut off.
      let cut = false;
      await page.route("**/_serverFn/**", async (route) => {
        if (
          cut ||
          !isServerFn(
            route.request().url(),
            "updateStorefrontThemeSectionProps",
          )
        ) {
          return route.fallback();
        }
        cut = true;
        const response = await route.fetch();
        expect(response.ok(), "the write itself was made").toBe(true);
        await route.abort("connectionreset");
      });
      const field = await heroContentField(page, 0);
      await field.fill(value("landed"));
      await field.press("Tab");
      await expect(unconfirmedNotice(page)).toBeVisible({ timeout: 15_000 });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const afterLanded = writes.sent;

      // Meanwhile another tab, opened on the document as it is now, writes.
      otherTab = await sharedEditor(browser);
      await writeSectionField(
        otherTab.page,
        other.section,
        other.index,
        value("theirs"),
      );

      const resend = nextContentWrite(page).catch(() => "none" as const);
      await unconfirmedNotice(page)
        .getByRole("button", { name: "Check and save" })
        .click();
      await expect(unconfirmedNotice(page)).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      const afterCheck = writes.sent;
      const checkAnswer = afterCheck > afterLanded ? await resend : "none";

      return {
        page,
        value,
        resentByCheck: afterCheck - afterLanded,
        checkAnswer,
        finish: async () => {
          // Whatever the path, the author's newest edit and the other tab's
          // are both what the server holds, once each.
          const check = await sharedEditor(browser);
          try {
            await expect(await heroContentField(check.page, 0)).toHaveValue(
              value("next"),
            );
            await expect(
              await sectionContentField(check.page, other.section, other.index),
            ).toHaveValue(value("theirs"));
          } finally {
            await check.context.close();
          }
        },
        cleanup: async () => {
          await page.unrouteAll({ behavior: "ignoreErrors" });
          await otherTab?.context.close();
          await context.close();
          const restore = await sharedEditor(browser);
          try {
            await writeHeroField(restore.page, 0, originals.mine);
            await writeSectionField(
              restore.page,
              other.section,
              other.index,
              originals.theirs,
            );
          } finally {
            await restore.context.close();
          }
        },
      };
    } catch (error) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await otherTab?.context.close();
      await context.close();
      throw error;
    }
  }

  /** Edits the hero again, expects the conflict, and loads the latest. */
  async function nextEditThroughConflict(page: Page, next: string) {
    const field = await heroContentField(page, 0);
    const refused = nextContentWrite(page);
    await field.fill(next);
    await field.press("Tab");
    expect(await refused, "the next edit, sent").toBe("conflict");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Out of date",
      { timeout: 30_000 },
    );
    // Refused, and kept: the newest edit is still here.
    await expect(await heroContentField(page, 0)).toHaveValue(next);
    await loadLatestKeepMine(page);
  }

  /** Presses Load latest, keep mine, and waits for the rebased write to land. */
  async function loadLatestKeepMine(page: Page) {
    const rebased = nextContentWrite(page);
    await page.getByRole("button", { name: "Load latest, keep mine" }).click();
    expect(await rebased, "the rebased write").toBe("saved");
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      /^(Unpublished|Published)$/,
      { timeout: 30_000 },
    );
  }

  /** Edits the hero again; resolves a conflict if there is one. */
  async function nextEditThroughConflictOrSave(page: Page, next: string) {
    const field = await heroContentField(page, 0);
    const answer = nextContentWrite(page);
    await field.fill(next);
    await field.press("Tab");
    const first = await answer;
    expect(first, "the next edit, sent").not.toBe("failed");
    if (first === "conflict") await loadLatestKeepMine(page);
  }

  test("after a landed write is confirmed, the next edit meets the conflict and keeps both writers' changes", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    // The other tab writes another section: the hero write stays provable.
    const run = await landedThenAnotherWriter(browser, {
      section: "editorial-intro",
      index: 0,
    });
    try {
      // Confirmed by the check: nothing sent again.
      expect(run.resentByCheck).toBe(0);
      // This tab never took the document's generation from the check, and
      // the other tab moved it again: the next edit is refused, kept, and
      // rebased on a press.
      await nextEditThroughConflict(run.page, run.value("next"));
      await run.finish();
    } finally {
      await run.cleanup();
    }
  });

  test("a landed write that another writer changed around cannot be confirmed: sent once, refused, rebased without overwriting", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    // The other tab writes another field of the same section. A content
    // write carries the section's whole props, so the server no longer holds
    // every value this tab sent and the check cannot say it landed.
    const run = await landedThenAnotherWriter(browser, {
      section: "hero",
      index: 1,
    });
    try {
      // Sent once more, under the generation this tab holds: refused.
      expect(run.resentByCheck).toBe(1);
      expect(run.checkAnswer).toBe("conflict");
      await expect(
        run.page.locator("[data-editor-save-status]"),
      ).toHaveAttribute("aria-label", "Out of date", { timeout: 30_000 });
      await loadLatestKeepMine(run.page);
      await nextEditThroughConflictOrSave(run.page, run.value("next"));
      await run.finish();
    } finally {
      await run.cleanup();
    }
  });

  test("another tab saved the same file first: resuming does not overwrite it", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    const hero = await openHeroInCode(page);
    const original = await readSource(page, hero);
    const mine = `${original}\n/* ${MARKER} mine */`;
    const theirs = `${original}\n/* ${MARKER} theirs */`;
    const other = await sharedEditor(browser);
    const session = await context.cookies();
    try {
      await context.clearCookies();
      await editAndSave(page, hero, mine);
      await expect(pausedNotice(page)).toContainText(
        "Your sign-in has expired",
      );

      // Meanwhile the file is saved from elsewhere.
      await openHeroInCode(other.page);
      const landed = nextFileSave(other.page, hero);
      await editAndSave(other.page, hero, theirs);
      expect(await landed, "the other tab's save").toBe(true);

      // Signed in again: the browser has its session back.
      await context.addCookies(session);
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");
      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();

      // The other save moved the file on, so this tab's edit is not written
      // over it: it comes back under one of the existing conflict notices —
      // the file's own, when the file list refreshed after checking found the
      // newer version first, or the Theme's, when the save itself was refused
      // first — still here, unsaved, for the author to decide on.
      //
      // The file's notice is two spans, "Conflict:" and "Server conflict
      // (vN)…", with no space between them in the document, so it is matched
      // by the second span alone.
      await expect(
        page
          .getByText("Remote source changes detected in this theme")
          .or(page.getByText(/^Server conflict \(v\d+\)/)),
      ).toBeVisible({ timeout: 30_000 });
      const kept = await readSource(page, hero);
      expect(kept).toContain(`${MARKER} mine`);
      expect(kept).not.toContain(`${MARKER} theirs`);
      await openEditor(other.page);
      await openHeroInCode(other.page);
      await expect
        .poll(() => readSource(other.page, hero))
        .toContain(`${MARKER} theirs`);
      expect(await readSource(other.page, hero)).not.toContain(
        `${MARKER} mine`,
      );
    } finally {
      await other.context.close();
      await context.close();
      await restoreHero(browser, hero);
    }
  });
});

test.describe("a structural edit after the page moved elsewhere", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

  test("a rename refused for a moved page keeps the name typed, and the next press applies it on the latest version", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page } = await sharedEditor(browser);
    let other: Awaited<ReturnType<typeof sharedEditor>> | null = null;
    const stamp = Date.now();
    const value = (name: string) => `${MARKER} ${name} ${stamp}`;
    const name = `Hero ${stamp}`;
    const originals = {
      mine: await (await heroContentField(page, 0)).inputValue(),
      theirs: "",
    };
    let renamed = false;
    try {
      // A write answered here, so this tab holds the page's generation.
      await writeHeroField(page, 0, value("mine"));

      // Another tab changes another section of the same page.
      other = await sharedEditor(browser);
      originals.theirs = await (
        await sectionContentField(other.page, "editorial-intro", 0)
      ).inputValue();
      await writeSectionField(
        other.page,
        "editorial-intro",
        0,
        value("theirs"),
      );

      // The rename is refused: the page moved. The dialog stays, with the
      // name typed, and says why.
      const input = await openRename(page, "hero");
      await input.fill(name);
      const refused = nextRename(page);
      await page.locator("[data-editor-rename-confirm]").click();
      expect(await refused, "the first rename").toBe("conflict");
      await expect(
        page.getByText("This page was changed elsewhere").first(),
      ).toBeVisible();
      await expect(page.getByLabel("Section name")).toHaveValue(name);

      // Pressed again: applied on the latest version.
      const applied = nextRename(page);
      await page.locator("[data-editor-rename-confirm]").click();
      expect(await applied, "the second rename").toBe("saved");
      renamed = true;
      await expect(page.getByLabel("Section name")).toHaveCount(0);

      // A fresh load holds the name and the other tab's change.
      const check = await sharedEditor(browser);
      try {
        await expect(
          check.page.getByRole("button", { name, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          await sectionContentField(check.page, "editorial-intro", 0),
        ).toHaveValue(value("theirs"));
      } finally {
        await check.context.close();
      }
    } finally {
      await other?.context.close();
      await context.close();
      const restore = await sharedEditor(browser);
      try {
        if (renamed) {
          const input = await openRename(restore.page, name);
          await input.fill("");
          const back = nextRename(restore.page);
          await restore.page.locator("[data-editor-rename-confirm]").click();
          expect(await back, "the name restored").toBe("saved");
        }
        await writeHeroField(restore.page, 0, originals.mine);
        if (originals.theirs) {
          await writeSectionField(
            restore.page,
            "editorial-intro",
            0,
            originals.theirs,
          );
        }
      } finally {
        await restore.context.close();
      }
    }
  });
});
