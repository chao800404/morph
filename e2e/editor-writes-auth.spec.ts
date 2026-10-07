import { expect, test } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";

import {
  runSql,
  restoreHero,
  restoreHeroAfterFailure,
  pausedNotice,
  countSaves,
  editAndSave,
  readSource,
  openHeroInCode,
  sharedEditor,
  signedInEditor,
  signOut,
  signIn,
  email,
  MARKER,
  SECOND_EMAIL,
} from "./helpers/editor-writes-paused";

test.describe("unsaved work when the signed-in account changes", () => {
  test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");
  restoreHeroAfterFailure();

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
      await restoreHero(browser);
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
      await restoreHero(browser);
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
      await restoreHero(browser);
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
      await restoreHero(browser);
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
      await restoreHero(browser);
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
      await restoreHero(browser);
    }
  });
});
