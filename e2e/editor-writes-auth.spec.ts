import { expect, test, type Page } from "@playwright/test";
import { EDITOR_PATH, openEditor } from "./helpers";

import {
  queryLocalD1,
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
  SECOND_EMAIL,
} from "./helpers/editor-writes-paused";

/**
 * The editor closed to another account: the reason shown where the editor
 * was, and the editor itself out of reach. (`editAndSave` writes through
 * Monaco's API, which no closed editor can stop; what stops the save then is
 * the write gate, checked separately by counting saves.)
 */
async function expectClosedToAnotherAccount(page: Page) {
  await expect(page.locator('[data-editor-locked="different-account"]')).toBeVisible();
  await expect(page.locator("[data-editor-mode-surface]").first()).toHaveAttribute(
    "inert",
    "",
  );
}

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
      await expectClosedToAnotherAccount(page);

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
      await expectClosedToAnotherAccount(page);
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
      // Found by the refused save, it closes the editor all the same, and
      // the draft is still held in it.
      await expectClosedToAnotherAccount(page);
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
      await expectClosedToAnotherAccount(page);
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

  /**
   * The ordering behind PR #372's failure (run 41496671159), made
   * deterministic instead of waiting for a cookie to expire at the right
   * moment: a response to a request this browser sent as the editor's account
   * is held until another account has signed in, in another tab, and only
   * then delivered. Whatever Set-Cookie it carries lands after the sign-in's.
   *
   * With Better Auth's cookie cache on, that response carried the first
   * account's `session_data` and the next save ran as the first account;
   * with renewal on and the session due, it carried the first account's
   * `session_token`. Neither may change who this browser is.
   */
  for (const renewal of [false, true]) {
    test(`a response sent as this account arrives after another account signed in${renewal ? ", session due for renewal" : ""}: the browser stays the new account and the save is refused`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      const { context, page } = await sharedEditor(browser);
      const hero = await openHeroInCode(page);
      const original = await readSource(page, hero);
      const quotedEmail = email().replace(/'/g, "''");
      const stored = () =>
        queryLocalD1<{ content: string; version: number }>(
          `SELECT content, version FROM storefront_theme_files WHERE path = '${hero.replace(/'/g, "''")}' AND deleted_at IS NULL ORDER BY id`,
        );
      const sessionUser = () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/get-session");
          const body = (await response.json()) as {
            user?: { email: string };
          } | null;
          return body?.user?.email ?? null;
        });
      const order: string[] = [];
      const note = (line: string) =>
        order.push(`${new Date().toISOString()} ${line}`);
      try {
        if (renewal) {
          // Older than updateAge (1 day), still valid: a session read would
          // renew it if renewal were on.
          runSql(
            `UPDATE sessions SET expires_at = ${Date.now() + (6 * 24 - 1) * 3_600_000} WHERE user_id = (SELECT id FROM users WHERE email = '${quotedEmail}');`,
          );
        }
        // With a cookie cache on, a session read sent without the cache
        // cookie answers with a fresh one; dropped so that the held response
        // would carry it. Nothing to drop while the cache is off.
        await context.clearCookies({ name: /session_data/ });

        const PROBE = "x-morph-e2e-late-probe";
        let release!: () => Promise<void>;
        const held = new Promise<void>((resolve) => {
          void page.route("**/api/auth/get-session*", async (route) => {
            if (!route.request().headers()[PROBE]) return route.fallback();
            // Sent now, as this account; delivered later.
            const response = await route.fetch();
            const setCookies = response
              .headersArray()
              .filter(({ name }) => name.toLowerCase() === "set-cookie")
              .map(({ value }) => value.slice(0, value.indexOf("=")));
            note(
              `first account's get-session answered by the server, held; Set-Cookie: [${setCookies.join(", ")}]`,
            );
            release = () => route.fulfill({ response });
            resolve();
          });
        });
        // The browser's own session read, as useSession sends it.
        const asked = page.evaluate(async (probe) => {
          const response = await fetch("/api/auth/get-session", {
            headers: { [probe]: "1" },
          });
          const body = (await response.json()) as {
            user?: { email: string };
          } | null;
          return body?.user?.email ?? null;
        }, PROBE);
        await held;

        await signIn(context, SECOND_EMAIL);
        note("second account signed in (its Set-Cookie applied)");
        await release();
        expect(await asked).toBe(email());
        note("first account's held response delivered to the page");
        await page.unroute("**/api/auth/get-session*");
        await test.info().attach("cookie-order", {
          body: order.join("\n"),
          contentType: "text/plain",
        });

        // Who the browser is now: the second account.
        expect(await sessionUser()).toBe(SECOND_EMAIL);

        const before = stored();
        expect(before.length).toBeGreaterThan(0);
        await editAndSave(page, hero, `${original}\n/* ${MARKER} held */`);
        await expect(pausedNotice(page)).toContainText(
          "A different account is signed in",
        );
        await expectClosedToAnotherAccount(page);
        // The refused save changed nothing stored: content and version.
        expect(stored()).toEqual(before);
        expect(await readSource(page, hero)).toContain(`${MARKER} held`);
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
  }
});
