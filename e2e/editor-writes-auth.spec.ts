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
  isServerFn,
  signOut,
  signIn,
  email,
  MARKER,
} from "./helpers/editor-writes-paused";

// Split from one spec file for CI shard balance; the three files together are the
// former editor-writes-auth.spec.ts (see also editor-writes-auth-other-account
// and editor-writes-auth-late-response). Each test restores the hero itself.

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
    // Each request reads the role from the database (the session cookie
    // cache is off), so a role change counts from the next request on. No
    // cookie is cleared here: if a cached role could still answer, this
    // test would fail.
    try {
      runSql(
        `UPDATE users SET role = 'user' WHERE email = '${email().replace(/'/g, "''")}';`,
      );
      await editAndSave(page, hero, draft);
      await expect(pausedNotice(page)).toContainText(
        "Your account cannot change this Theme",
      );

      // Signed in, still not allowed: checking again keeps it paused.
      // The text is already present before checking. Wait for this check's
      // Theme read to be refused, then for its UI to settle, before granting
      // access; otherwise the in-flight check can observe the restored role.
      const deniedCheck = page
        .waitForRequest((request) =>
          isServerFn(request.url(), "getStorefrontThemeEditor"),
        )
        .then((request) => request.response());
      await pausedNotice(page)
        .getByRole("button", { name: "Check again" })
        .click();
      const deniedResponse = await deniedCheck;
      expect(deniedResponse).not.toBeNull();
      expect(await deniedResponse!.text()).toContain("ACCESS_DENIED");
      await expect(pausedNotice(page)).toHaveAttribute(
        "data-editor-writes-paused",
        "none",
      );
      await expect(
        pausedNotice(page).getByRole("button", { name: "Check again" }),
      ).toBeEnabled();
      await expect(pausedNotice(page)).toContainText(
        "Your account cannot change this Theme",
      );
      expect(await readSource(page, hero)).toContain(`${MARKER} denied`);

      runSql(
        `UPDATE users SET role = 'admin' WHERE email = '${email().replace(/'/g, "''")}';`,
      );
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
});
