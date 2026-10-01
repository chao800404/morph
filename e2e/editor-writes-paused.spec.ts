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

/** The hero's first content field in Design. */
async function heroContentField(page: Page) {
  await page.getByRole("button", { name: "hero", exact: true }).click();
  await settleSelection(page);
  await openContentTab(page);
  const field = page
    .locator('[data-slot="inspector-content-field"] input')
    .first();
  await expect(field).toBeVisible({ timeout: 30_000 });
  return field;
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
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(hero),
      { timeout: 30_000 },
    );
    await editAndSave(page, hero, withoutMarkers(source));
    expect((await saved).ok()).toBe(true);
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

      // Back online, the author checks: the server does not hold it, so it
      // is sent — once.
      await page.unrouteAll({ behavior: "ignoreErrors" });
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
        const saved = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            isServerFn(
              response.request().url(),
              "updateStorefrontThemeSectionProps",
            ),
          { timeout: 30_000 },
        );
        await restore.fill(original);
        await restore.press("Tab");
        expect((await saved).ok()).toBe(true);
      }
      await context.close();
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
      const saved = other.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          (response.request().postData() ?? "").includes(hero),
        { timeout: 30_000 },
      );
      await editAndSave(other.page, hero, theirs);
      expect((await saved).ok()).toBe(true);

      // Signed in again: the browser has its session back.
      await context.addCookies(session);
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      await expect(pausedNotice(page)).toContainText("Signed in again");
      await pausedNotice(page)
        .getByRole("button", { name: "Save my changes" })
        .click();

      // The newer save moved the Theme on, so this tab's save is refused and
      // its edit comes back under the Theme's own conflict notice — still
      // here, unsaved, for the author to decide on.
      await expect(
        page.getByText("Remote source changes detected in this theme"),
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
